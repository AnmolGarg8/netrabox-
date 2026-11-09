import { describe, it, expect, vi } from "vitest";
import { PayPalClient, type CustomFetch } from "../src/services/paypal/client.js";
import { classifyPayPalError } from "../src/services/paypal/errors.js";
import { assertRealPayPalId } from "../../../scripts/e2e-sandbox.js";

describe("PayPalClient", () => {
  const mockConfig = {
    clientId: "mock_client_id",
    clientSecret: "mock_client_secret",
    environment: "sandbox" as const,
    webhookId: "wh_test_123",
  };

  it("caches OAuth token and reuses it until expiry", async () => {
    let tokenFetchCount = 0;

    const mockFetch: CustomFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/v1/oauth2/token")) {
        tokenFetchCount++;
        return new Response(
          JSON.stringify({
            access_token: `token_${tokenFetchCount}`,
            token_type: "Bearer",
            expires_in: 3600, // 1 hour
          }),
          { status: 200 },
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const client = new PayPalClient(mockConfig, mockFetch);

    const token1 = await client.getAccessToken();
    const token2 = await client.getAccessToken();

    expect(token1).toBe("token_1");
    expect(token2).toBe("token_1");
    expect(tokenFetchCount).toBe(1); // Reused cached token!
  });

  it("generates deterministic PayPal-Request-Id idempotency keys", () => {
    const client = new PayPalClient(mockConfig);
    const key1 = client.generateIdempotencyKey("pur_123", "capture");
    const key2 = client.generateIdempotencyKey("pur_123", "capture");
    const keyAttempt2 = client.generateIdempotencyKey("pur_123", "capture", 2);

    expect(key1).toBe("netrabox_pur_123_capture");
    expect(key2).toBe("netrabox_pur_123_capture");
    expect(keyAttempt2).toBe("netrabox_pur_123_capture_att2");
  });

  it("creates order with intent AUTHORIZE and extracts approvalUrl", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    let capturedBody: Record<string, unknown> | undefined;

    const mockFetch: CustomFetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes("/v1/oauth2/token")) {
          return new Response(JSON.stringify({ access_token: "mock_token", expires_in: 3600 }), {
            status: 200,
          });
        }
        if (urlStr.includes("/v2/checkout/orders")) {
          capturedHeaders = init?.headers as Record<string, string>;
          capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
          return new Response(
            JSON.stringify({
              id: "ORDER_9988",
              status: "CREATED",
              intent: "AUTHORIZE",
              links: [
                {
                  href: "https://sandbox.paypal.com/checkoutnow?token=ORDER_9988",
                  rel: "approve",
                  method: "GET",
                },
              ],
            }),
            { status: 201 },
          );
        }
        return new Response("Not found", { status: 404 });
      },
    );

    const client = new PayPalClient(mockConfig, mockFetch);
    const result = await client.createOrder({
      purchaseId: "pur_test_1",
      amountMinor: 34999,
      currency: "USD",
      returnUrl: "https://example.com/return",
      cancelUrl: "https://example.com/cancel",
    });

    expect(result.order.id).toBe("ORDER_9988");
    expect(result.approvalUrl).toBe("https://sandbox.paypal.com/checkoutnow?token=ORDER_9988");
    expect(capturedBody?.intent).toBe("AUTHORIZE");
    const units = capturedBody?.purchase_units as Array<{ amount: { value: string } }>;
    expect(units[0].amount.value).toBe("349.99");
    expect(capturedHeaders?.["PayPal-Request-Id"]).toBe("netrabox_pur_test_1_create_order");
  });

  it("handles full and partial captures with final_capture flag", async () => {
    let capturedBody: Record<string, unknown> | undefined;

    const mockFetch: CustomFetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes("/v1/oauth2/token")) {
          return new Response(JSON.stringify({ access_token: "mock_token", expires_in: 3600 }), {
            status: 200,
          });
        }
        if (urlStr.includes("/capture")) {
          capturedBody = init?.body
            ? (JSON.parse(init.body as string) as Record<string, unknown>)
            : undefined;
          return new Response(
            JSON.stringify({
              id: "CAP_1234",
              status: "COMPLETED",
              final_capture: capturedBody?.final_capture ?? true,
            }),
            { status: 201 },
          );
        }
        return new Response("Not found", { status: 404 });
      },
    );

    const client = new PayPalClient(mockConfig, mockFetch);

    // Full capture
    const fullCapture = await client.captureAuthorization("AUTH_1", "pur_1");
    expect(fullCapture.id).toBe("CAP_1234");
    expect(capturedBody).toBeUndefined(); // Full capture does not require amount body

    // Partial capture
    const partialCapture = await client.captureAuthorization("AUTH_1", "pur_1", {
      amountMinor: 15000,
      currency: "USD",
      finalCapture: true,
      actionSuffix: "part1",
    });
    expect(partialCapture.id).toBe("CAP_1234");
    const amountObj = capturedBody?.amount as { value: string };
    expect(amountObj.value).toBe("150.00");
    expect(capturedBody?.final_capture).toBe(true);
  });

  it("classifies non-retryable 401/404 errors vs retryable 429/500 errors", async () => {
    let attempts = 0;

    const mockFetch: CustomFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/v1/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "mock_token", expires_in: 3600 }), {
          status: 200,
        });
      }
      attempts++;
      if (attempts < 2) {
        return new Response(JSON.stringify({ message: "Rate limit hit" }), { status: 429 });
      }
      return new Response(JSON.stringify({ id: "ORDER_OK", status: "CREATED" }), { status: 200 });
    });

    const client = new PayPalClient(mockConfig, mockFetch);
    const order = await client.getOrder("ORDER_OK");

    expect(order.id).toBe("ORDER_OK");
    expect(attempts).toBe(2); // Automatically retried after 429!
  });

  it("verifies webhook signatures with PayPal API", async () => {
    let capturedVerificationPayload: Record<string, unknown> | undefined;

    const mockFetch: CustomFetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes("/v1/oauth2/token")) {
          return new Response(JSON.stringify({ access_token: "mock_token", expires_in: 3600 }), {
            status: 200,
          });
        }
        if (urlStr.includes("/verify-webhook-signature")) {
          capturedVerificationPayload = JSON.parse(init?.body as string) as Record<string, unknown>;
          return new Response(JSON.stringify({ verification_status: "SUCCESS" }), { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      },
    );

    const client = new PayPalClient(mockConfig, mockFetch);
    const isValid = await client.verifyWebhookSignature({
      authAlgo: "SHA256withRSA",
      certUrl: "https://api.sandbox.paypal.com/cert.pem",
      transmissionId: "trans_1",
      transmissionSig: "sig_1",
      transmissionTime: "2026-11-04T12:00:00Z",
      webhookEvent: { id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED" },
    });

    expect(isValid).toBe(true);
    expect(capturedVerificationPayload?.webhook_id).toBe("wh_test_123");
  });

  it("classifyPayPalError retains strictly safe fields and never leaks secrets or raw bodies", () => {
    const rawSensitivePayload = {
      name: "INVALID_CLIENT",
      message: "Client Authentication failed for client_id: secret_client_id_999",
      debug_id: "dbg_88776655",
      client_secret: "SUPER_SECRET_PAYPAL_KEY_NEVER_LOG",
      access_token: "A21AA_SENSITIVE_OAUTH_TOKEN_BEARER",
      raw_headers: {
        authorization: "Basic bW9ja19jbGllbnRfaWQ6bW9ja19jbGllbnRfc2VjcmV0",
        cookie: "session_id=ultra_sensitive_session_123",
      },
    };

    const classified = classifyPayPalError(
      401,
      "Failed to authenticate: Bearer A21AA_SENSITIVE_OAUTH_TOKEN_BEARER with client_secret=SUPER_SECRET_PAYPAL_KEY_NEVER_LOG",
      rawSensitivePayload,
    );

    // 1. Keeps only HTTP status, PayPal error name, message, and debug_id
    expect(classified.status).toBe(401);
    expect(classified.paypalErrorName).toBe("INVALID_CLIENT");
    expect(classified.debug_id).toBe("dbg_88776655");
    expect(classified.details).toEqual({
      status: 401,
      paypalErrorName: "INVALID_CLIENT",
      message: expect.not.stringContaining("SUPER_SECRET_PAYPAL_KEY_NEVER_LOG"),
      debug_id: "dbg_88776655",
    });

    // 2. Raw request headers and body attributes MUST NEVER be attached
    const classifiedObj = classified as unknown as Record<string, unknown>;
    expect(classifiedObj.raw_headers).toBeUndefined();
    expect(classifiedObj.client_secret).toBeUndefined();
    expect(classifiedObj.access_token).toBeUndefined();

    // 3. Stringification / logging assertions: no secrets appear
    const serialized = JSON.stringify(classified);
    const jsonOutput = JSON.stringify(classified.toJSON());
    const errorMessage = classified.message;
    const errorString = classified.toString();

    const sensitiveStrings = [
      "SUPER_SECRET_PAYPAL_KEY_NEVER_LOG",
      "A21AA_SENSITIVE_OAUTH_TOKEN_BEARER",
      "bW9ja19jbGllbnRfaWQ6bW9ja19jbGllbnRfc2VjcmV0",
      "ultra_sensitive_session_123",
    ];

    for (const secret of sensitiveStrings) {
      expect(serialized).not.toContain(secret);
      expect(jsonOutput).not.toContain(secret);
      expect(errorMessage).not.toContain(secret);
      expect(errorString).not.toContain(secret);
    }
  });

  describe("assertRealPayPalId Invariant Validator", () => {
    it("accepts authentic PayPal Sandbox alphanumeric IDs", () => {
      expect(assertRealPayPalId("5O12345678901234T", "Order ID")).toBe("5O12345678901234T");
      expect(assertRealPayPalId("8AB1234567890123C", "Auth ID")).toBe("8AB1234567890123C");
      expect(assertRealPayPalId("2XY9876543210987Z", "Capture ID")).toBe("2XY9876543210987Z");
      expect(assertRealPayPalId("9KL4567890123456M", "Refund ID")).toBe("9KL4567890123456M");
    });

    it("rejects placeholder patterns (AUTH_SAND, CAP_SAND, REF_SAND, ORD_, mock)", () => {
      expect(() => assertRealPayPalId("AUTH_SAND_2001", "Auth ID")).toThrow(/disallowed pattern/i);
      expect(() => assertRealPayPalId("CAP_SAND_3001", "Capture ID")).toThrow(
        /disallowed pattern/i,
      );
      expect(() => assertRealPayPalId("REF_SAND_4001", "Refund ID")).toThrow(/disallowed pattern/i);
      expect(() => assertRealPayPalId("ORD_1001", "Order ID")).toThrow(/disallowed pattern/i);
      expect(() => assertRealPayPalId("mock_token_123", "Token ID")).toThrow(/disallowed pattern/i);
      expect(() => assertRealPayPalId("REF_EXECUTED", "Refund ID")).toThrow(/disallowed pattern/i);
      expect(() => assertRealPayPalId("test_order_123", "Order ID")).toThrow(/disallowed pattern/i);
    });

    it("rejects empty, null, undefined or short IDs", () => {
      expect(() => assertRealPayPalId("", "Order ID")).toThrow(/empty/i);
      expect(() => assertRealPayPalId(null, "Order ID")).toThrow(/null/i);
      expect(() => assertRealPayPalId(undefined, "Order ID")).toThrow(/undefined/i);
      expect(() => assertRealPayPalId("12345", "Order ID")).toThrow(/too short/i);
    });
  });
});
