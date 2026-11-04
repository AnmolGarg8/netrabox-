import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { verifyEvidenceChain, verifyHashSignature, StateTransitionError } from "@netrabox/core";
import { PurchaseStateMachineService } from "../src/services/state-machine/machine.js";
import { InMemoryStateStore } from "../src/services/state-machine/in-memory-store.js";
import type { PurchaseRecord } from "../src/services/state-machine/types.js";

describe("Purchase State Machine & Atomic Evidence Ledger", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyHex = privateKey.export({ type: "pkcs8", format: "der" }).toString("hex");
  const publicKeyHex = publicKey.export({ type: "spki", format: "der" }).toString("hex");

  function createTestStore(): { store: InMemoryStateStore; service: PurchaseStateMachineService } {
    const store = new InMemoryStateStore();
    const service = new PurchaseStateMachineService(store);

    const initialPurchase: PurchaseRecord = {
      id: "pur_sm_01",
      buyerId: "user_01",
      agentId: "agent_01",
      merchantId: "merch_01",
      title: "Test Headphones",
      state: "DRAFT",
      currency: "USD",
      amountMinor: 34999,
      capturedAmountMinor: 0,
      refundedAmountMinor: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    store.purchases.set("pur_sm_01", initialPurchase);

    return { store, service };
  }

  it("advances through legal state lifecycle and maintains unbroken hash chain", async () => {
    const { store, service } = createTestStore();

    // 1. DRAFT -> INTENT_CHECKED
    const t1 = await service.transition({
      purchaseId: "pur_sm_01",
      action: "PASS_INTENT_CHECK",
      actor: "agent",
      payload: { score: 0.98 },
      signingPrivateKeyHex: privateKeyHex,
    });
    expect(t1.purchase.state).toBe("INTENT_CHECKED");
    expect(t1.evidenceEvent.seq).toBe(1);
    expect(t1.evidenceEvent.type).toBe("INTENT_CHECK_RESULT");

    // 2. INTENT_CHECKED -> AWAITING_BUYER_APPROVAL
    const t2 = await service.transition({
      purchaseId: "pur_sm_01",
      action: "REQUEST_APPROVAL",
      actor: "agent",
      payload: { cartTotal: 34999 },
      signingPrivateKeyHex: privateKeyHex,
    });
    expect(t2.purchase.state).toBe("AWAITING_BUYER_APPROVAL");
    expect(t2.evidenceEvent.seq).toBe(2);
    expect(t2.evidenceEvent.prevHash).toBe(t1.evidenceEvent.hash);

    // 3. AWAITING_BUYER_APPROVAL -> AUTHORIZED
    const t3 = await service.transition({
      purchaseId: "pur_sm_01",
      action: "APPROVE_AND_AUTHORIZE",
      actor: "user",
      payload: { authId: "AUTH_77" },
      signingPrivateKeyHex: privateKeyHex,
      patch: { paypalAuthorizationId: "AUTH_77" },
    });
    expect(t3.purchase.state).toBe("AUTHORIZED");
    expect(t3.purchase.paypalAuthorizationId).toBe("AUTH_77");
    expect(t3.evidenceEvent.seq).toBe(3);

    // 4. AUTHORIZED -> DELIVERED
    const t4 = await service.transition({
      purchaseId: "pur_sm_01",
      action: "RECORD_DELIVERY",
      actor: "merchant",
      payload: { tracking: "TRACK_123" },
      signingPrivateKeyHex: privateKeyHex,
    });
    expect(t4.purchase.state).toBe("DELIVERED");

    // 5. DELIVERED -> CAPTURED
    const t5 = await service.transition({
      purchaseId: "pur_sm_01",
      action: "CAPTURE_PAYMENT",
      actor: "system",
      payload: { captureId: "CAP_99" },
      signingPrivateKeyHex: privateKeyHex,
      patch: { capturedAmountMinor: 34999 },
    });
    expect(t5.purchase.state).toBe("CAPTURED");

    // Verify cryptographic integrity across all events
    const allEvents = store.events.get("pur_sm_01")!;
    expect(allEvents.length).toBe(5);

    const chainOutcome = verifyEvidenceChain(allEvents);
    expect(chainOutcome.valid).toBe(true);
    expect(chainOutcome.totalEvents).toBe(5);

    // Verify Ed25519 signatures
    for (const event of allEvents) {
      const isSigValid = verifyHashSignature(event.hash, event.signature, publicKeyHex);
      expect(isSigValid).toBe(true);
    }
  });

  it("throws StateTransitionError on illegal state transition and leaves state untouched", async () => {
    const { store, service } = createTestStore();

    // In DRAFT state, attempting to CAPTURE_PAYMENT must throw
    await expect(
      service.transition({
        purchaseId: "pur_sm_01",
        action: "CAPTURE_PAYMENT",
        actor: "system",
        payload: {},
        signingPrivateKeyHex: privateKeyHex,
      }),
    ).rejects.toThrow(StateTransitionError);

    // Assert state remained unchanged
    const purchase = await store.getPurchase("pur_sm_01");
    expect(purchase?.state).toBe("DRAFT");
    expect(store.events.get("pur_sm_01")).toBeUndefined();
  });
});
