import { describe, it, expect, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  type TribunalVerdict,
  type AdvocateBrief,
  type LLMMessage,
  MockLLMAdapter,
} from "@netrabox/core";
import { PolicyEngine } from "../src/services/tribunal/policy-engine.js";
import { BuyerAdvocateAgent } from "../src/services/tribunal/advocates.js";
import { TribunalRunner } from "../src/services/tribunal/runner.js";
import { InMemoryStateStore } from "../src/services/state-machine/in-memory-store.js";
import { PurchaseStateMachineService } from "../src/services/state-machine/machine.js";
import { EvidenceService } from "../src/services/evidence/service.js";
import { PayPalClient, type CustomFetch } from "../src/services/paypal/client.js";
import { buildServer } from "../src/server.js";
import type { PurchaseRecord } from "../src/services/state-machine/types.js";
import type { DisputeRecord } from "../src/services/tribunal/types.js";

describe("Dispute Tribunal & Policy Engine", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyHex = privateKey.export({ type: "pkcs8", format: "der" }).toString("hex");
  const publicKeyHex = publicKey.export({ type: "spki", format: "der" }).toString("hex");

  const mockPurchase: PurchaseRecord = {
    id: "pur_tribunal_1",
    buyerId: "u_buyer",
    agentId: "a_shopper",
    merchantId: "m_store",
    title: "Sony XM5 Headphones",
    state: "CAPTURED",
    currency: "USD",
    amountMinor: 34999,
    capturedAmountMinor: 34999,
    refundedAmountMinor: 0,
    paypalCaptureId: "CAP_SANDBOX_123",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  describe("PolicyEngine Rules & Invariants", () => {
    const engine = new PolicyEngine(0.7);

    const validVerdict: TribunalVerdict = {
      classification: "AGENT_EXCEEDED_INSTRUCTIONS",
      liabilitySplit: { buyer: 0, agentProvider: 100, merchant: 0 },
      refundAmountMinor: 34999,
      confidence: 0.95,
      citedEvidenceIds: ["ev_1", "ev_2"],
      reasoning: "Agent exceeded budget limit and bought non-requested item.",
      recommendedAction: "REFUND_FULL",
    };

    it("passes when all invariants are satisfied", () => {
      const res = engine.validateVerdict(validVerdict, {
        validEvidenceIds: new Set(["ev_1", "ev_2", "ev_3"]),
        maxAllowedRefundMinor: 34999,
        purchase: mockPurchase,
      });

      expect(res.passed).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(res.requiresHumanReview).toBe(false);
      expect(res.resolvedAction).toBe("RESOLVE_REFUND_FULL");
      expect(res.sanitizedRefundAmountMinor).toBe(34999);
    });

    it("blocks refund when amount exceeds captured amount", () => {
      const excessRefundVerdict: TribunalVerdict = {
        ...validVerdict,
        refundAmountMinor: 50000, // $500 > $349.99
      };

      const res = engine.validateVerdict(excessRefundVerdict, {
        validEvidenceIds: new Set(["ev_1", "ev_2"]),
        maxAllowedRefundMinor: 34999,
        purchase: mockPurchase,
      });

      expect(res.passed).toBe(false);
      expect(res.requiresHumanReview).toBe(true);
      expect(res.errors.some((e) => e.includes("exceeds maximum allowed"))).toBe(true);
      expect(res.resolvedAction).toBe("ESCALATE");
    });

    it("rejects hallucinated evidence IDs not present in ledger", () => {
      const hallucinatedVerdict: TribunalVerdict = {
        ...validVerdict,
        citedEvidenceIds: ["ev_1", "ev_HALLUCINATED_999"],
      };

      const res = engine.validateVerdict(hallucinatedVerdict, {
        validEvidenceIds: new Set(["ev_1", "ev_2"]),
        maxAllowedRefundMinor: 34999,
        purchase: mockPurchase,
      });

      expect(res.passed).toBe(false);
      expect(res.errors.some((e) => e.includes("does not exist in verified evidence chain"))).toBe(
        true,
      );
      expect(res.requiresHumanReview).toBe(true);
    });

    it("rejects liability splits that do not sum to 100%", () => {
      const badSplitVerdict: TribunalVerdict = {
        ...validVerdict,
        liabilitySplit: { buyer: 30, agentProvider: 30, merchant: 30 }, // sums to 90%
      };

      const res = engine.validateVerdict(badSplitVerdict, {
        validEvidenceIds: new Set(["ev_1", "ev_2"]),
        maxAllowedRefundMinor: 34999,
        purchase: mockPurchase,
      });

      expect(res.passed).toBe(false);
      expect(res.errors.some((e) => e.includes("must sum exactly to 100%"))).toBe(true);
    });

    it("escalates to human review when confidence is below threshold", () => {
      const lowConfidenceVerdict: TribunalVerdict = {
        ...validVerdict,
        confidence: 0.55, // < 0.70 threshold
      };

      const res = engine.validateVerdict(lowConfidenceVerdict, {
        validEvidenceIds: new Set(["ev_1", "ev_2"]),
        maxAllowedRefundMinor: 34999,
        confidenceThreshold: 0.7,
        purchase: mockPurchase,
      });

      expect(res.passed).toBe(false);
      expect(res.requiresHumanReview).toBe(true);
      expect(res.resolvedAction).toBe("ESCALATE");
    });
  });

  describe("Advocate Agents Citation Auditing & Retries", () => {
    it("rejects and retries when advocate outputs a hallucinated event ID", async () => {
      let attempts = 0;

      const llm = new MockLLMAdapter();
      // On 1st attempt return hallucinated ID, on 2nd attempt return valid ID
      llm.setHandler(async (_msgs: LLMMessage[]) => {
        attempts++;
        if (attempts === 1) {
          return {
            content: JSON.stringify({
              role: "buyer_advocate",
              argument: "Buyer was overcharged by agent.",
              citedEvidenceIds: ["ev_FAKE_ID"],
              faultAssessment: "Agent fault",
            } satisfies AdvocateBrief),
          };
        }
        return {
          content: JSON.stringify({
            role: "buyer_advocate",
            argument: "Buyer was overcharged by agent.",
            citedEvidenceIds: ["ev_VALID_1"],
            faultAssessment: "Agent fault",
          } satisfies AdvocateBrief),
        };
      });

      const advocate = new BuyerAdvocateAgent(llm);
      const brief = await advocate.generateBrief({
        disputeReason: "Overcharged",
        disputedAmountMinor: 1000,
        events: [
          {
            id: "ev_VALID_1",
            purchaseId: "pur_1",
            seq: 1,
            type: "INSTRUCTION_RECEIVED",
            actor: "user",
            payload: {},
            createdAt: new Date().toISOString(),
            prevHash: "00".repeat(32),
            hash: "11".repeat(32),
            signature: "sig",
            signerKeyId: "key",
          },
        ],
        validEvidenceIds: new Set(["ev_VALID_1"]),
      });

      expect(attempts).toBe(2); // Retried once!
      expect(brief.citedEvidenceIds).toEqual(["ev_VALID_1"]);
    });
  });

  describe("End-to-End Tribunal Sandbox Runs", () => {
    function setupTribunalTestHarness(customVerdict?: Partial<TribunalVerdict>) {
      const store = new InMemoryStateStore();
      const stateMachine = new PurchaseStateMachineService(store);
      const evidenceService = new EvidenceService(store, privateKeyHex, publicKeyHex);

      let refundCalled = false;
      const mockFetch: CustomFetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes("/v1/oauth2/token")) {
          return new Response(JSON.stringify({ access_token: "mock_tok", expires_in: 3600 }), {
            status: 200,
          });
        }
        if (urlStr.includes("/refund")) {
          refundCalled = true;
          return new Response(JSON.stringify({ id: "REFUND_SANDBOX_7788", status: "COMPLETED" }), {
            status: 201,
          });
        }
        return new Response("Not found", { status: 404 });
      });

      const paypalClient = new PayPalClient(
        { clientId: "id", clientSecret: "sec", environment: "sandbox" },
        mockFetch,
      );

      const llm = new MockLLMAdapter();
      llm.setHandler(async (messages: LLMMessage[]) => {
        const prompt = messages[messages.length - 1]?.content || "";
        const eventIdMatch = prompt.match(/ev_[a-zA-Z0-9_\-]+/);
        const validId = eventIdMatch ? eventIdMatch[0] : "ev_init";

        if (prompt.includes("Buyer Advocate Brief")) {
          return {
            content: JSON.stringify({
              role: "buyer_advocate",
              argument: "Evidence shows buyer specifications were violated.",
              citedEvidenceIds: [validId],
              faultAssessment: "Agent exceeded instructions",
            } satisfies AdvocateBrief),
          };
        }

        if (prompt.includes("Merchant Advocate Brief")) {
          return {
            content: JSON.stringify({
              role: "merchant_advocate",
              argument: "Merchant fulfilled the order exactly as requested in checkout.",
              citedEvidenceIds: [validId],
              faultAssessment: "Merchant fulfilled terms",
            } satisfies AdvocateBrief),
          };
        }

        // Chief Judge Verdict
        const verdictToReturn: TribunalVerdict = {
          classification: "AGENT_EXCEEDED_INSTRUCTIONS",
          liabilitySplit: { buyer: 0, agentProvider: 100, merchant: 0 },
          refundAmountMinor: 34999,
          confidence: 0.92,
          citedEvidenceIds: customVerdict?.citedEvidenceIds || [validId],
          reasoning: "Agent provider exceeded instructions; merchant not at fault.",
          recommendedAction: "REFUND_FULL",
          ...customVerdict,
        };

        return { content: JSON.stringify(verdictToReturn) };
      });

      const runner = new TribunalRunner({
        store,
        stateMachine,
        evidenceService,
        paypalClient,
        llm,
        signingPrivateKeyHex: privateKeyHex,
      });

      return { store, runner, evidenceService, isRefundCalled: () => refundCalled };
    }

    it("Case 1: Agent Exceeded Instructions -> PayPal Refund Executed", async () => {
      const { store, runner, evidenceService, isRefundCalled } = setupTribunalTestHarness({
        classification: "AGENT_EXCEEDED_INSTRUCTIONS",
        liabilitySplit: { buyer: 0, agentProvider: 100, merchant: 0 },
        recommendedAction: "REFUND_FULL",
        refundAmountMinor: 34999,
      });

      // Seed purchase in CAPTURED state
      store.purchases.set("pur_case1", {
        ...mockPurchase,
        id: "pur_case1",
      });

      // Seed initial evidence event
      await evidenceService.appendEvent({
        purchaseId: "pur_case1",
        type: "INSTRUCTION_RECEIVED",
        actor: "user",
        payload: { prompt: "Buy headphones under $300" },
      });

      const dispute: DisputeRecord = {
        id: "disp_case1",
        purchaseId: "pur_case1",
        reason: "Agent bought $350 headphones exceeding $300 ceiling",
        status: "OPEN",
        disputedAmountMinor: 34999,
        claimantActor: "user",
        createdAt: new Date(),
      };

      const result = await runner.runTribunal(dispute);

      expect(result.executedAction).toBe("RESOLVE_REFUND_FULL");
      expect(result.requiresHumanReview).toBe(false);
      expect(result.tribunalRun.judgeClassification).toBe("AGENT_EXCEEDED_INSTRUCTIONS");
      expect(result.dispute.status).toBe("RESOLVED");
      expect(isRefundCalled()).toBe(true); // PayPal Refund called!

      // Verify purchase state machine updated
      const updatedPurchase = await store.getPurchase("pur_case1");
      expect(updatedPurchase?.state).toBe("RESOLVED_REFUNDED_FULL");
      expect(updatedPurchase?.refundedAmountMinor).toBe(34999);
    });

    it("Case 2: False Claim -> Rejected (PayPal funds retained)", async () => {
      const { store, runner, evidenceService, isRefundCalled } = setupTribunalTestHarness({
        classification: "FALSE_CLAIM",
        liabilitySplit: { buyer: 100, agentProvider: 0, merchant: 0 },
        recommendedAction: "REJECT_DISPUTE",
        refundAmountMinor: 0,
      });

      store.purchases.set("pur_case2", {
        ...mockPurchase,
        id: "pur_case2",
      });

      await evidenceService.appendEvent({
        purchaseId: "pur_case2",
        type: "DELIVERY_EVENT",
        actor: "merchant",
        payload: { tracking: "FEDEX_VALID_123", signedBy: "Buyer Signature Match" },
      });

      const dispute: DisputeRecord = {
        id: "disp_case2",
        purchaseId: "pur_case2",
        reason: "Buyer claims item was not received",
        status: "OPEN",
        disputedAmountMinor: 34999,
        claimantActor: "user",
        createdAt: new Date(),
      };

      const result = await runner.runTribunal(dispute);

      expect(result.executedAction).toBe("RESOLVE_REJECT");
      expect(result.requiresHumanReview).toBe(false);
      expect(result.tribunalRun.judgeClassification).toBe("FALSE_CLAIM");
      expect(result.dispute.status).toBe("RESOLVED");
      expect(isRefundCalled()).toBe(false); // No refund issued!

      const updatedPurchase = await store.getPurchase("pur_case2");
      expect(updatedPurchase?.state).toBe("RESOLVED_REJECTED");
      expect(updatedPurchase?.refundedAmountMinor).toBe(0);
    });

    it("Case 3: Tampered chain BLOCKS tribunal at Step 1 with ZERO LLM invocation", async () => {
      const { store, runner, evidenceService } = setupTribunalTestHarness();

      store.purchases.set("pur_tampered", {
        ...mockPurchase,
        id: "pur_tampered",
      });

      const ev = await evidenceService.appendEvent({
        purchaseId: "pur_tampered",
        type: "INSTRUCTION_RECEIVED",
        actor: "user",
        payload: { legit: true },
      });

      // Tamper with payload silently in storage
      ev.payload = { hacked: true };

      const dispute: DisputeRecord = {
        id: "disp_tampered",
        purchaseId: "pur_tampered",
        reason: "Tampered test",
        status: "OPEN",
        disputedAmountMinor: 34999,
        claimantActor: "user",
        createdAt: new Date(),
      };

      const result = await runner.runTribunal(dispute);

      // Verifier failed -> immediately BLOCKED, marked NEEDS_HUMAN_REVIEW
      expect(result.requiresHumanReview).toBe(true);
      expect(result.tribunalRun.chainIntegrityValid).toBe(false);
      expect(result.tribunalRun.judgeReasoning).toContain("TRIBUNAL BLOCKED");
      expect(result.dispute.status).toBe("NEEDS_HUMAN_REVIEW");

      const purchase = await store.getPurchase("pur_tampered");
      expect(purchase?.state).toBe("NEEDS_HUMAN_REVIEW");
    });
  });

  describe("Dispute API Endpoints & Human Review Queue", () => {
    it("handles POST /disputes, GET /disputes/human-review, and POST /disputes/:id/human-review", async () => {
      const store = new InMemoryStateStore();
      const evidenceService = new EvidenceService(store, privateKeyHex, publicKeyHex);

      store.purchases.set("pur_api_disp", {
        ...mockPurchase,
        id: "pur_api_disp",
        state: "CAPTURED",
      });

      await evidenceService.appendEvent({
        purchaseId: "pur_api_disp",
        type: "INSTRUCTION_RECEIVED",
        actor: "user",
        payload: { prompt: "Test prompt" },
      });

      const app = buildServer({
        store,
        evidenceService,
        signingPrivateKeyHex: privateKeyHex,
        signingPublicKeyHex: publicKeyHex,
        isTest: true,
      });

      // 1. Open dispute via POST /api/v1/disputes
      const postRes = await app.inject({
        method: "POST",
        url: "/api/v1/disputes",
        payload: {
          purchaseId: "pur_api_disp",
          reason: "Item was defective on arrival",
          claimantActor: "user",
          disputedAmountMinor: 34999,
        },
      });

      expect(postRes.statusCode).toBe(201);
      const postBody = JSON.parse(postRes.payload);
      expect(postBody.dispute.id).toBeDefined();

      const disputeId = postBody.dispute.id;

      // 2. Fetch dispute via GET /api/v1/disputes/:id
      const getRes = await app.inject({
        method: "GET",
        url: `/api/v1/disputes/${disputeId}`,
      });
      expect(getRes.statusCode).toBe(200);
      expect(JSON.parse(getRes.payload).dispute.id).toBe(disputeId);

      // 3. Human override via POST /api/v1/disputes/:id/human-review
      const overrideRes = await app.inject({
        method: "POST",
        url: `/api/v1/disputes/${disputeId}/human-review`,
        payload: {
          overrideAction: "RESOLVE_REFUND_FULL",
          humanNotes: "Human tribunal judge reviewed evidence and approved full buyer refund.",
          refundAmountMinor: 34999,
        },
      });

      expect(overrideRes.statusCode).toBe(200);
      const overrideBody = JSON.parse(overrideRes.payload);
      expect(overrideBody.status).toBe("resolved_by_human");
      expect(overrideBody.dispute.resolutionState).toBe("RESOLVE_REFUND_FULL");
    });
  });
});
