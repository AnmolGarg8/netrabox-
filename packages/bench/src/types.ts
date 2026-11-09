import type {
  TribunalClassification,
  EvidenceEvent,
  PurchaseTransitionAction,
} from "@netrabox/core";

export type AdversarialType =
  | "tampered"
  | "reordered"
  | "forged_signature"
  | "injection_merchant"
  | "injection_buyer"
  | "false_rogue_agent"
  | "contradictory"
  | "replayed_request"
  | "injection_advocate"
  | "unicode_overlong";

export interface BenchPurchase {
  id: string;
  buyerId: string;
  agentId: string;
  merchantId: string;
  title: string;
  currency: string;
  amountMinor: number;
  capturedAmountMinor: number;
}

export interface BenchClaim {
  reason: string;
  disputedAmountMinor: number;
  claimantActor: "user" | "merchant" | "agent";
}

export interface BenchGroundTruth {
  classification: TribunalClassification | "BLOCKED";
  acceptableLiabilitySplit: {
    buyer: [number, number];
    agentProvider: [number, number];
    merchant: [number, number];
  };
  correctRefundAmountMinor: number;
  expectedAction: PurchaseTransitionAction;
  expectedIntegrityValid: boolean;
  shouldEscalate: boolean;
  notes: string;
}

export interface BenchTestCase {
  id: string;
  split: "dev" | "test";
  title: string;
  category: TribunalClassification | "TAMPERED_CHAIN";
  isAdversarial: boolean;
  adversarialType?: AdversarialType;
  claim: BenchClaim;
  purchase: BenchPurchase;
  evidenceChain: EvidenceEvent[];
  signerPublicKeyHex: string;
  plainTextSummary: string;
  groundTruth: BenchGroundTruth;
}

export interface CaseTribunalResult {
  classification: string;
  refundAmountMinor: number;
  executedAction: string;
  liabilitySplit: { buyer: number; agentProvider: number; merchant: number };
  integrityValid: boolean;
  requiresHumanReview: boolean;
  confidence: number;
  latencyMs: number;
  classificationMatch: boolean;
  refundErrorMinor: number;
  passedPolicyEngine: boolean;
}

export interface CaseBaselineResult {
  classification: string;
  refundAmountMinor: number;
  liabilitySplit: { buyer: number; agentProvider: number; merchant: number };
  latencyMs: number;
  classificationMatch: boolean;
  refundErrorMinor: number;
  tamperBlind: boolean;
  injectionFooled: boolean;
}

export interface CaseEvaluationResult {
  caseId: string;
  split: "dev" | "test";
  title: string;
  groundTruth: {
    classification: string;
    correctRefundAmountMinor: number;
    expectedAction: string;
    isAdversarial: boolean;
    adversarialType?: string;
  };
  tribunal: CaseTribunalResult;
  baseline: CaseBaselineResult;
}

export interface EvaluationMetricsGroup {
  classificationAccuracy: number;
  wilsonInterval?: { lower: number; upper: number; point: number };
  macroF1: number;
  meanRefundErrorMinor: number;
  tamperDetectionRate: number;
  injectionResistanceRate: number;
  humanReviewRate: number;
  avgLatencyMs: number;
  estimatedCostPerCase: number;
  policyViolations: number;
}

export interface BenchSummaryMetrics {
  suiteName: string;
  runAt: string;
  splitReported: "test" | "dev" | "all";
  totalEvaluatedCases: number;
  tribunal: EvaluationMetricsGroup;
  baseline: EvaluationMetricsGroup;
  caseBreakdown: CaseEvaluationResult[];
}
