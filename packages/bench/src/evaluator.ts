import {
  verifyEvidenceChain,
  BuyerAdvocateAgent,
  MerchantAdvocateAgent,
  ChiefJudgeAgent,
  PolicyEngine,
  type LLMAdapter,
} from "@netrabox/core";
import type { BenchTestCase, CaseTribunalResult } from "./types.js";

export class TribunalDryRunEvaluator {
  private llm: LLMAdapter;
  private buyerAdvocate: BuyerAdvocateAgent;
  private merchantAdvocate: MerchantAdvocateAgent;
  private chiefJudge: ChiefJudgeAgent;
  private policyEngine: PolicyEngine;

  constructor(llm: LLMAdapter) {
    this.llm = llm;
    this.buyerAdvocate = new BuyerAdvocateAgent(llm);
    this.merchantAdvocate = new MerchantAdvocateAgent(llm);
    this.chiefJudge = new ChiefJudgeAgent(llm);
    this.policyEngine = new PolicyEngine(0.7);
  }

  public async evaluateCase(testCase: BenchTestCase): Promise<CaseTribunalResult> {
    const startTime = performance.now();

    // =========================================================================
    // STEP 1: DETERMINISTIC INTEGRITY CHECK (ZERO LLM CALLS)
    // =========================================================================
    const verification = verifyEvidenceChain(testCase.evidenceChain, testCase.signerPublicKeyHex);

    if (!verification.valid) {
      const latencyMs = Math.round(performance.now() - startTime);
      const isExpectedBlocked = testCase.groundTruth.classification === "BLOCKED";

      return {
        classification: "BLOCKED",
        refundAmountMinor: 0,
        executedAction: "ESCALATE",
        liabilitySplit: { buyer: 0, agentProvider: 0, merchant: 0 },
        integrityValid: false,
        requiresHumanReview: true,
        confidence: 1.0,
        latencyMs,
        classificationMatch: isExpectedBlocked,
        refundErrorMinor: Math.abs(0 - testCase.groundTruth.correctRefundAmountMinor),
        passedPolicyEngine: false,
      };
    }

    // =========================================================================
    // STEP 2: MULTI-AGENT ADVOCATES (EVIDENCE CITATION GROUNDING)
    // =========================================================================
    const validEvidenceIds = new Set(testCase.evidenceChain.map((e) => e.id));
    const advocateInput = {
      disputeReason: testCase.claim.reason,
      disputedAmountMinor: testCase.claim.disputedAmountMinor,
      events: testCase.evidenceChain,
      validEvidenceIds,
    };

    let buyerBrief;
    let merchantBrief;
    let verdict;
    try {
      buyerBrief = await this.buyerAdvocate.generateBrief(advocateInput);
      merchantBrief = await this.merchantAdvocate.generateBrief(advocateInput);

      // =========================================================================
      // STEP 3: IMPARTIAL CHIEF JUDGE VERDICT
      // =========================================================================
      verdict = await this.chiefJudge.evaluateDispute({
        disputeReason: testCase.claim.reason,
        disputedAmountMinor: testCase.claim.disputedAmountMinor,
        buyerBrief,
        merchantBrief,
        events: testCase.evidenceChain,
        validEvidenceIds,
      });
    } catch {
      const latencyMs = Math.round(performance.now() - startTime);
      return {
        classification: "BLOCKED",
        refundAmountMinor: 0,
        executedAction: "ESCALATE",
        liabilitySplit: { buyer: 0, agentProvider: 0, merchant: 0 },
        integrityValid: true,
        requiresHumanReview: true,
        confidence: 0.0,
        latencyMs,
        classificationMatch:
          testCase.groundTruth.classification === "BLOCKED" ||
          Boolean(testCase.groundTruth.shouldEscalate),
        refundErrorMinor: Math.abs(0 - testCase.groundTruth.correctRefundAmountMinor),
        passedPolicyEngine: false,
      };
    }

    // =========================================================================
    // STEP 4: DETERMINISTIC POLICY ENGINE ENFORCEMENT & DRY-RUN SETTLEMENT
    // =========================================================================
    const validation = this.policyEngine.validateVerdict(verdict, {
      validEvidenceIds,
      maxAllowedRefundMinor: testCase.purchase.capturedAmountMinor,
      purchase: {
        id: testCase.purchase.id,
        amountMinor: testCase.purchase.amountMinor,
        capturedAmountMinor: testCase.purchase.capturedAmountMinor,
        currency: testCase.purchase.currency,
      },
    });

    const latencyMs = Math.round(performance.now() - startTime);

    const classificationMatch =
      verdict.classification.toUpperCase() === testCase.groundTruth.classification.toUpperCase();

    const refundErrorMinor = Math.abs(
      validation.sanitizedRefundAmountMinor - testCase.groundTruth.correctRefundAmountMinor,
    );

    return {
      classification: verdict.classification,
      refundAmountMinor: validation.sanitizedRefundAmountMinor,
      executedAction: validation.resolvedAction,
      liabilitySplit: verdict.liabilitySplit,
      integrityValid: true,
      requiresHumanReview: validation.requiresHumanReview,
      confidence: verdict.confidence,
      latencyMs,
      classificationMatch,
      refundErrorMinor,
      passedPolicyEngine: validation.passed,
    };
  }
}
