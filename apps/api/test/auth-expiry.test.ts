import { describe, it, expect, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { AuthExpiryMonitorJob } from "../src/services/jobs/auth-expiry.js";
import { SettlementService } from "../src/services/settlement/service.js";
import { PolicyEngine } from "@netrabox/core";
import { InMemoryStateStore } from "../src/services/state-machine/in-memory-store.js";
import { PayPalClient, type CustomFetch } from "../src/services/paypal/client.js";
import type { PurchaseRecord } from "../src/services/state-machine/types.js";

describe("AuthExpiryMonitorJob", () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const privateKeyHex = privateKey.export({ type: "pkcs8", format: "der" }).toString("hex");

  it("flags purchases within configurable warning window and auto-voids if configured", async () => {
    const store = new InMemoryStateStore();
    const policyEngine = new PolicyEngine(0.7);

    // Mock void API response
    let voidCalledWithAuthId = "";
    const mockFetch: CustomFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/v1/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "mock_tok", expires_in: 3600 }), {
          status: 200,
        });
      }
      if (urlStr.includes("/void")) {
        voidCalledWithAuthId = urlStr;
        return new Response(JSON.stringify({ id: "AUTH_OLD", status: "VOIDED" }), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    });

    const paypalClient = new PayPalClient(
      { clientId: "id", clientSecret: "sec", environment: "sandbox" },
      mockFetch,
    );

    const settlementService = new SettlementService(
      store,
      paypalClient,
      policyEngine,
      privateKeyHex,
    );

    const now = Date.now();
    const twentyEightDaysAgo = new Date(now - 28 * 24 * 60 * 60 * 1000); // 28 days old -> 1 day left until 29d cutoff!
    const oneDayAgo = new Date(now - 1 * 24 * 60 * 60 * 1000); // Fresh auth -> 28 days left

    const nearExpiryPurchase: PurchaseRecord = {
      id: "pur_near_expiry",
      buyerId: "u1",
      agentId: "a1",
      merchantId: "m1",
      title: "Old Auth Purchase",
      state: "AUTHORIZED",
      currency: "USD",
      amountMinor: 20000,
      capturedAmountMinor: 0,
      refundedAmountMinor: 0,
      paypalAuthorizationId: "AUTH_OLD_99",
      createdAt: twentyEightDaysAgo,
      updatedAt: twentyEightDaysAgo,
    };

    const freshPurchase: PurchaseRecord = {
      id: "pur_fresh",
      buyerId: "u2",
      agentId: "a2",
      merchantId: "m2",
      title: "Fresh Auth Purchase",
      state: "AUTHORIZED",
      currency: "USD",
      amountMinor: 10000,
      capturedAmountMinor: 0,
      refundedAmountMinor: 0,
      paypalAuthorizationId: "AUTH_FRESH_11",
      createdAt: oneDayAgo,
      updatedAt: oneDayAgo,
    };

    store.purchases.set("pur_near_expiry", nearExpiryPurchase);
    store.purchases.set("pur_fresh", freshPurchase);

    const job = new AuthExpiryMonitorJob(settlementService, {
      warningThresholdHours: 48,
      autoVoidCloseToExpiry: true,
      maxValidityDays: 29,
      signingPrivateKeyHex: privateKeyHex,
    });

    const report = await job.scanAuthorizations([nearExpiryPurchase, freshPurchase]);

    expect(report.scannedCount).toBe(2);
    expect(report.flaggedCount).toBe(1);
    expect(report.flaggedPurchaseIds).toContain("pur_near_expiry");
    expect(report.voidedCount).toBe(1);
    expect(report.voidedPurchaseIds).toContain("pur_near_expiry");
    expect(voidCalledWithAuthId).toContain("AUTH_OLD_99");

    // Purchase should be transitioned to VOIDED
    const updatedPurchase = await store.getPurchase("pur_near_expiry");
    expect(updatedPurchase?.state).toBe("VOIDED");
  });
});
