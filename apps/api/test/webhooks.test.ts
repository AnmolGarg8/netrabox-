import { describe, it, expect, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { buildServer } from "../src/server.js";
import { PayPalClient, type CustomFetch } from "../src/services/paypal/client.js";
import { InMemoryStateStore } from "../src/services/state-machine/in-memory-store.js";
import type { PurchaseRecord } from "../src/services/state-machine/types.js";

describe("PayPal Webhook Route", () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const privateKeyHex = privateKey.export({ type: "pkcs8", format: "der" }).toString("hex");

  function setupTestApp(isVerified = true) {
    const store = new InMemoryStateStore();

    const purchase: PurchaseRecord = {
      id: "pur_wh_test",
      buyerId: "user_1",
      agentId: "agent_1",
      merchantId: "merch_1",
      title: "Webhook Test Purchase",
      state: "DELIVERED",
      currency: "USD",
      amountMinor: 10000,
      capturedAmountMinor: 0,
      refundedAmountMinor: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    store.purchases.set("pur_wh_test", purchase);

    const mockFetch: CustomFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/v1/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "mock_tok", expires_in: 3600 }), {
          status: 200,
        });
      }
      if (urlStr.includes("/verify-webhook-signature")) {
        return new Response(
          JSON.stringify({ verification_status: isVerified ? "SUCCESS" : "FAILURE" }),
          { status: 200 },
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const paypalClient = new PayPalClient(
      {
        clientId: "id",
        clientSecret: "sec",
        environment: "sandbox",
        webhookId: "wh_123",
      },
      mockFetch,
    );

    const app = buildServer({
      store,
      paypalClient,
      signingPrivateKeyHex: privateKeyHex,
      isTest: true,
    });

    return { app, store };
  }

  const validHeaders = {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/cert.pem",
    "paypal-transmission-id": "trans_999",
    "paypal-transmission-sig": "sig_999",
    "paypal-transmission-time": "2026-11-04T12:00:00Z",
  };

  it("returns 400 when required signature headers are missing", async () => {
    const { app } = setupTestApp(true);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/paypal",
      payload: { id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED" },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error).toContain("Missing required PayPal signature verification headers");
  });

  it("returns 400 when signature verification fails", async () => {
    const { app } = setupTestApp(false); // Fails verification!
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/paypal",
      headers: validHeaders,
      payload: {
        id: "WH-1",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: { id: "CAP-1", custom_id: "pur_wh_test" },
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error).toContain("verification failed");
  });

  it("processes verified webhook and updates state machine atomically", async () => {
    const { app, store } = setupTestApp(true);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/paypal",
      headers: validHeaders,
      payload: {
        id: "WH-101",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: {
          id: "CAP-101",
          custom_id: "pur_wh_test",
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe("processed");

    // Check purchase transitioned to CAPTURED
    const purchase = await store.getPurchase("pur_wh_test");
    expect(purchase?.state).toBe("CAPTURED");

    // Check evidence was written
    const events = store.events.get("pur_wh_test")!;
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("PAYPAL_CAPTURED");
  });

  it("ignores duplicate webhook events idempotently", async () => {
    const { app } = setupTestApp(true);

    // First call
    const res1 = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/paypal",
      headers: validHeaders,
      payload: {
        id: "WH-DUPE-1",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: { id: "CAP-1", custom_id: "pur_wh_test" },
      },
    });
    expect(res1.statusCode).toBe(200);
    expect(JSON.parse(res1.payload).status).toBe("processed");

    // Duplicate call with same event id
    const res2 = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/paypal",
      headers: validHeaders,
      payload: {
        id: "WH-DUPE-1",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: { id: "CAP-1", custom_id: "pur_wh_test" },
      },
    });
    expect(res2.statusCode).toBe(200);
    expect(JSON.parse(res2.payload).status).toBe("ignored_duplicate");
  });
});
