import type { TribunalVerdict, AdvocateBrief, EvidenceActor } from "@netrabox/core";

export interface DisputeRecord {
  id: string;
  purchaseId: string;
  reason: string;
  status: "OPEN" | "TRIAGE" | "IN_TRIBUNAL" | "RESOLVED" | "NEEDS_HUMAN_REVIEW";
  resolutionState?: string | null;
  disputedAmountMinor: number;
  claimantActor: EvidenceActor;
  createdAt: Date;
  resolvedAt?: Date | null;
}

export interface TribunalRunRecord {
  id: string;
  disputeId: string;
  purchaseId: string;
  chainIntegrityValid: boolean;
  integrityFailureReason?: string | null;
  buyerAdvocateArgument?: string | null;
  buyerCitedEvidenceIds?: string[];
  merchantAdvocateArgument?: string | null;
  merchantCitedEvidenceIds?: string[];
  judgeClassification?: string | null;
  liabilityBuyer?: number | null;
  liabilityAgentProvider?: number | null;
  liabilityMerchant?: number | null;
  recommendedAction?: string | null;
  recommendedRefundMinor?: number | null;
  confidence?: string | null;
  judgeReasoning?: string | null;
  executedAction?: string | null;
  executedActionId?: string | null;
  policyEnginePassed: boolean;
  policyEngineErrors?: string[];
  createdAt: Date;
}

export interface TribunalExecutionResult {
  dispute: DisputeRecord;
  tribunalRun: TribunalRunRecord;
  buyerBrief?: AdvocateBrief;
  merchantBrief?: AdvocateBrief;
  verdict?: TribunalVerdict;
  executedAction: string;
  requiresHumanReview: boolean;
}
