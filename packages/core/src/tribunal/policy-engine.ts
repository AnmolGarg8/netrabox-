import type { TribunalVerdict } from "../schemas/index.js";
import type { PurchaseTransitionAction } from "../state-machine/index.js";

export interface PolicyEnginePurchaseInfo {
  id: string;
  amountMinor: number;
  capturedAmountMinor: number;
  currency: string;
  refundedAmountMinor?: number;
}

export interface PolicyEngineContext {
  validEvidenceIds: Set<string>;
  maxAllowedRefundMinor: number;
  confidenceThreshold?: number; // default: 0.70
  purchase: PolicyEnginePurchaseInfo;
}

export interface PolicyEngineValidationResult {
  passed: boolean;
  errors: string[];
  requiresHumanReview: boolean;
  resolvedAction: PurchaseTransitionAction;
  sanitizedRefundAmountMinor: number;
}

export class PolicyEngine {
  private defaultConfidenceThreshold: number;

  constructor(defaultConfidenceThreshold = 0.7) {
    this.defaultConfidenceThreshold = defaultConfidenceThreshold;
  }

  /**
   * Deterministically validates an LLM Tribunal Verdict against mathematical and cryptographic invariants
   */
  public validateVerdict(
    verdict: TribunalVerdict,
    context: PolicyEngineContext,
  ): PolicyEngineValidationResult {
    const errors: string[] = [];
    let requiresHumanReview = false;
    const threshold = context.confidenceThreshold ?? this.defaultConfidenceThreshold;

    // Invariant 1: All cited evidence event IDs must genuinely exist in the verified ledger
    for (const citedId of verdict.citedEvidenceIds) {
      if (!context.validEvidenceIds.has(citedId)) {
        errors.push(`Cited evidence ID '${citedId}' does not exist in verified evidence chain`);
      }
    }

    // Invariant 2: Liability split percentages must sum exactly to 100%
    const totalSplit =
      verdict.liabilitySplit.buyer +
      verdict.liabilitySplit.agentProvider +
      verdict.liabilitySplit.merchant;

    if (totalSplit !== 100) {
      errors.push(`Liability split sums to ${totalSplit}%, must sum exactly to 100%`);
    }

    // Invariant 3: Refund amount must not exceed captured/authorized funds
    if (verdict.refundAmountMinor > context.maxAllowedRefundMinor) {
      errors.push(
        `Refund amount ($${(verdict.refundAmountMinor / 100).toFixed(2)}) exceeds maximum allowed ($${(
          context.maxAllowedRefundMinor / 100
        ).toFixed(2)})`,
      );
    }

    // Invariant 4: Confidence threshold check
    if (verdict.confidence < threshold) {
      requiresHumanReview = true;
      errors.push(
        `Judge confidence ${verdict.confidence.toFixed(2)} is below minimum threshold ${threshold.toFixed(2)}; escalating to human review`,
      );
    }

    // Invariant 5: Escalate recommendation triggers human review
    if (verdict.recommendedAction === "ESCALATE_HUMAN") {
      requiresHumanReview = true;
    }

    // Determine state transition action
    let resolvedAction: PurchaseTransitionAction = "ESCALATE";
    let sanitizedRefundMinor = verdict.refundAmountMinor;

    if (errors.length === 0 && !requiresHumanReview) {
      switch (verdict.recommendedAction) {
        case "REFUND_FULL":
          if (context.purchase.capturedAmountMinor > 0) {
            resolvedAction = "RESOLVE_REFUND_FULL";
            sanitizedRefundMinor = context.purchase.capturedAmountMinor;
          } else {
            resolvedAction = "RESOLVE_VOID";
            sanitizedRefundMinor = 0;
          }
          break;

        case "REFUND_PARTIAL":
          resolvedAction = "RESOLVE_REFUND_PARTIAL";
          sanitizedRefundMinor = Math.min(
            verdict.refundAmountMinor,
            context.purchase.capturedAmountMinor,
          );
          break;

        case "VOID":
          resolvedAction = "RESOLVE_VOID";
          sanitizedRefundMinor = 0;
          break;

        case "CAPTURE":
        case "PARTIAL_CAPTURE":
          resolvedAction = "RESOLVE_CAPTURE";
          sanitizedRefundMinor = 0;
          break;

        case "REJECT_DISPUTE":
          resolvedAction = "RESOLVE_REJECT";
          sanitizedRefundMinor = 0;
          break;

        case "ESCALATE_HUMAN":
        default:
          resolvedAction = "ESCALATE";
          break;
      }
    } else {
      resolvedAction = "ESCALATE";
    }

    const passed = errors.length === 0 && !requiresHumanReview;

    return {
      passed,
      errors,
      requiresHumanReview: requiresHumanReview || !passed,
      resolvedAction,
      sanitizedRefundAmountMinor: sanitizedRefundMinor,
    };
  }
}
