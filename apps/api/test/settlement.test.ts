import { describe, it, expect, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  SettlementService,
  SettlementPolicyViolationError,
} from "../src/services/settlement/service.js";
import { PolicyEngine } from "@netrabox/core";
import { InMemoryStateStore } from "../src/services/state-machine/in-memory-store.js";
import { PayPalClient, type CustomFetch } from "../src/services/paypal/client.js";
import { classifyPayPalError } from "../src/services/paypal/errors.js";
import type { PurchaseRecord } from "../src/services/state-machine/types.js";

describe("SettlementService & Single Money-Movement Architecture", () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const signingPrivateKeyHex = privateKey.export({ type: "pkcs8", format: "der" }).toString("hex");

  function createTestFixture(customFetch?: CustomFetch) {
    const store = new InMemoryStateStore();
    const policyEngine = new PolicyEngine(0.7);

    const paypalClient = new PayPalClient(
      {
        clientId: "mock_client_id",
        clientSecret: "mock_client_secret",
        environment: "sandbox",
        webhookId: "wh_test_123",
      },
      customFetch ||
        (vi.fn(async (url: string | URL | Request) => {
          const u = url.toString();
          if (u.includes("/v1/oauth2/token")) {
            return new Response(JSON.stringify({ access_token: "mock_token", expires_in: 3600 }), {
              status: 200,
            });
          }
          if (u.includes("/capture")) {
            return new Response(JSON.stringify({ id: "CAP_TEST_100", status: "COMPLETED" }), {
              status: 201,
            });
          }
          if (u.includes("/void")) {
            return new Response(JSON.stringify({ id: "VOID_TEST_100", status: "COMPLETED" }), {
              status: 200,
            });
          }
          if (u.includes("/refund")) {
            return new Response(JSON.stringify({ id: "REF_TEST_100", status: "COMPLETED" }), {
              status: 201,
            });
          }
          return new Response("Not found", { status: 404 });
        }) as any),
    );

    const settlementService = new SettlementService(
      store,
      paypalClient,
      policyEngine,
      signingPrivateKeyHex,
    );

    return { store, paypalClient, policyEngine, settlementService };
  }

  function createPurchase(
    store: InMemoryStateStore,
    overrides: Partial<PurchaseRecord> = {},
  ): PurchaseRecord {
    const record: PurchaseRecord = {
      id: "pur_test_1",
      buyerId: "u_1",
      agentId: "a_1",
      merchantId: "m_1",
      title: "Test Purchase Unit",
      state: "DELIVERED",
      currency: "USD",
      amountMinor: 35000, // $350.00
      capturedAmountMinor: 0,
      refundedAmountMinor: 0,
      paypalOrderId: "ORD_123",
      paypalAuthorizationId: "AUTH_123",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
    store.purchases.set(record.id, record);
    return record;
  }

  it("blocks illegal state transitions deterministically before calling PayPal", async () => {
    const { store, settlementService } = createTestFixture();
    createPurchase(store, { state: "DRAFT" }); // DRAFT cannot capture or refund

    await expect(
      settlementService.execute({
        purchaseId: "pur_test_1",
        kind: "CAPTURE",
        amountMinor: 35000,
        currency: "USD",
        requestedBy: "merchant",
      }),
    ).rejects.toThrow(SettlementPolicyViolationError);

    // Verify 0 settlement actions were recorded
    expect(store.settlementActions.size).toBe(0);
  });

  it("blocks refund amounts exceeding captured funds before calling PayPal", async () => {
    const { store, settlementService } = createTestFixture();
    createPurchase(store, {
      state: "DISPUTED",
      capturedAmountMinor: 10000, // $100.00 captured
      refundedAmountMinor: 0,
      paypalCaptureId: "CAP_123",
    });

    await expect(
      settlementService.execute({
        purchaseId: "pur_test_1",
        kind: "REFUND_FULL",
        amountMinor: 15000, // Attempting $150.00 refund
        currency: "USD",
        requestedBy: "policy",
        verdictId: "vrd_1",
      }),
    ).rejects.toThrow(/exceeds remaining captured balance/);

    expect(store.settlementActions.size).toBe(0);
  });

  it("enforces reviewerId and reason on human overrides and successfully settles on PayPal", async () => {
    const { store, settlementService } = createTestFixture();
    createPurchase(store, {
      state: "NEEDS_HUMAN_REVIEW",
      capturedAmountMinor: 20000,
      refundedAmountMinor: 0,
      paypalCaptureId: "CAP_999",
    });

    // 1. Missing reviewerId or reason throws
    await expect(
      settlementService.execute({
        purchaseId: "pur_test_1",
        kind: "REFUND_FULL",
        amountMinor: 20000,
        currency: "USD",
        requestedBy: "human",
        reviewerId: "",
        reason: "",
      }),
    ).rejects.toThrow(/requires a valid non-empty reviewerId/);

    // 2. Valid human override succeeds
    const result = await settlementService.execute({
      purchaseId: "pur_test_1",
      kind: "REFUND_FULL",
      amountMinor: 20000,
      currency: "USD",
      requestedBy: "human",
      reviewerId: "admin_judge_alice",
      reason: "Buyer demonstrated package empty upon arrival",
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.settlementAction.reviewerId).toBe("admin_judge_alice");
    expect(result.settlementAction.reason).toContain("Buyer demonstrated package empty");
    expect(result.purchase?.state).toBe("RESOLVED_REFUNDED_FULL");
  });

  it("is idempotent: duplicate requests with same idempotency key make only 1 PayPal call", async () => {
    let paypalCalls = 0;
    const mockFetch: CustomFetch = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "mock_token", expires_in: 3600 }), {
          status: 200,
        });
      }
      if (u.includes("/capture")) {
        paypalCalls++;
        return new Response(JSON.stringify({ id: "CAP_IDEMPOTENT_1", status: "COMPLETED" }), {
          status: 201,
        });
      }
      return new Response("Not found", { status: 404 });
    });

    const { store, settlementService } = createTestFixture(mockFetch);
    createPurchase(store, { state: "DELIVERED" });

    // Call 1
    const res1 = await settlementService.execute({
      purchaseId: "pur_test_1",
      kind: "CAPTURE",
      amountMinor: 35000,
      currency: "USD",
      requestedBy: "merchant",
    });
    expect(res1.status).toBe("SUCCEEDED");
    expect(paypalCalls).toBe(1);

    // Call 2 with identical parameters
    const res2 = await settlementService.execute({
      purchaseId: "pur_test_1",
      kind: "CAPTURE",
      amountMinor: 35000,
      currency: "USD",
      requestedBy: "merchant",
    });

    expect(res2.idempotentReplay).toBe(true);
    expect(paypalCalls).toBe(1); // No second PayPal call!
  });

  it("definitive PayPal 4xx error marks FAILED, appends SETTLEMENT_FAILED, and leaves state unchanged", async () => {
    const mockFetch: CustomFetch = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "mock_token", expires_in: 3600 }), {
          status: 200,
        });
      }
      if (u.includes("/capture")) {
        return new Response(
          JSON.stringify({
            name: "AUTHORIZATION_ALREADY_CAPTURED",
            message: "The authorization has already been captured.",
            debug_id: "dbg_err_422",
          }),
          { status: 422 },
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const { store, settlementService } = createTestFixture(mockFetch);
    createPurchase(store, { state: "DELIVERED" });

    const result = await settlementService.execute({
      purchaseId: "pur_test_1",
      kind: "CAPTURE",
      amountMinor: 35000,
      currency: "USD",
      requestedBy: "merchant",
    });

    expect(result.status).toBe("FAILED");
    expect(result.settlementAction.status).toBe("FAILED");
    expect(result.settlementAction.errorMessage).toContain("already been captured");

    // State remains DELIVERED
    const purchase = await store.getPurchase("pur_test_1");
    expect(purchase?.state).toBe("DELIVERED");

    // Evidence event SETTLEMENT_FAILED recorded
    const events = await store.getEvidenceEvents("pur_test_1");
    const failedEvent = events.find((e) => e.type === "SETTLEMENT_FAILED");
    expect(failedEvent).toBeDefined();
    expect(failedEvent?.payload.paypalStatus).toBe(422);
  });

  it("failure injection: PayPal succeeds but DB transaction fails -> NEEDS_RECONCILE -> reconciler finalizes once", async () => {
    let captureCalls = 0;
    const mockFetch: CustomFetch = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "mock_token", expires_in: 3600 }), {
          status: 200,
        });
      }
      if (u.includes("/capture")) {
        captureCalls++;
        return new Response(JSON.stringify({ id: "CAP_INJECTED_99", status: "COMPLETED" }), {
          status: 201,
        });
      }
      return new Response("Not found", { status: 404 });
    });

    const { store, settlementService } = createTestFixture(mockFetch);
    createPurchase(store, { state: "DELIVERED" });

    // Inject DB failure during applyAtomicSettlementSuccess
    const originalApply = store.applyAtomicSettlementSuccess.bind(store);
    let injectedFailureHappened = false;
    store.applyAtomicSettlementSuccess = vi.fn(async (params) => {
      if (!injectedFailureHappened) {
        injectedFailureHappened = true;
        throw new Error("Simulated Postgres Deadlock / Connection Reset Error");
      }
      return await originalApply(params);
    });

    // Execute settlement: PayPal succeeds, but DB commit fails
    const initialResult = await settlementService.execute({
      purchaseId: "pur_test_1",
      kind: "CAPTURE",
      amountMinor: 35000,
      currency: "USD",
      requestedBy: "merchant",
    });

    expect(initialResult.status).toBe("NEEDS_RECONCILE");
    expect(captureCalls).toBe(1);

    // Purchase is still DELIVERED before reconciliation
    let purchase = await store.getPurchase("pur_test_1");
    expect(purchase?.state).toBe("DELIVERED");

    // Now run reconciler (with olderThanMs: 0 for instant test execution)
    const reconcileReport = await settlementService.reconcile(0);
    expect(reconcileReport.reconciled).toBe(1);
    expect(reconcileReport.actions[0].status).toBe("SUCCEEDED");

    // Purchase successfully transitioned to CAPTURED
    purchase = await store.getPurchase("pur_test_1");
    expect(purchase?.state).toBe("CAPTURED");
    expect(purchase?.capturedAmountMinor).toBe(35000);

    // Running reconcile again does nothing (already finalized)
    const secondReconcile = await settlementService.reconcile(0);
    expect(secondReconcile.reconciled).toBe(0);
  });

  it("PayPalClient.request throws when mutating POST is made without an idempotency key (exemption for webhook verification)", async () => {
    const mockFetch: CustomFetch = vi.fn(async () => new Response("{}", { status: 200 }));
    const client = new PayPalClient(
      {
        clientId: "cid",
        clientSecret: "csec",
        environment: "sandbox",
      },
      mockFetch,
    );

    // 1. Direct POST without idempotency key throws invariant violation
    await expect(
      (client as any)["request"]("/v2/checkout/orders", {
        method: "POST",
        body: { test: true },
        // idempotencyKey omitted!
      }),
    ).rejects.toThrow(/requires an idempotency key \(PayPal-Request-Id\)/);

    // 2. Webhook verification call with method POST is explicitly exempt
    await expect(
      (client as any)["request"]("/v1/notifications/verify-webhook-signature", {
        method: "POST",
        body: { webhook_id: "wh_1" },
        // idempotencyKey omitted!
      }),
    ).resolves.toBeDefined();
  });
});
