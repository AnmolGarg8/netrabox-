import type {
  TribunalVerdict,
  SettlementActionKind,
  SettlementRequestedBy,
} from "../schemas/index.js";
import {
  type PurchaseTransitionAction,
  canTransition,
  type PurchaseState,
} from "../state-machine/index.js";

export interface PolicyEnginePurchaseInfo {
  id: string;
  state?: PurchaseState;
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

export interface CheckSettlementRequest {
  kind: SettlementActionKind;
  amountMinor: number;
  currency: string;
  purchase: {
    id: string;
    state: PurchaseState;
    amountMinor: number;
    capturedAmountMinor: number;
    refundedAmountMinor: number;
    currency: string;
  };
  requestedBy: SettlementRequestedBy;
  reviewerId?: string | null;
  reason?: string | null;
  verdictId?: string | null;
  disputeId?: string | null;
}

export interface CheckSettlementResult {
  passed: boolean;
  errors: string[];
  resolvedAction: PurchaseTransitionAction;
}

export class PolicyEngine {
  private defaultConfidenceThreshold: number;

  constructor(defaultConfidenceThreshold = 0.7) {
    this.defaultConfidenceThreshold = defaultConfidenceThreshold;
  }

  /**
   * Evaluates a money movement settlement request against financial invariants,
   * authorization/capture balances, state machine rules, and authorization policies.
   */
  public checkSettlement(request: CheckSettlementRequest): CheckSettlementResult {
    const errors: string[] = [];
    const { kind, amountMinor, currency, purchase, requestedBy, reviewerId, reason, verdictId } =
      request;

    // 1. Amount verification (amount > 0 unless VOID)
    if (kind === "VOID") {
      if (amountMinor < 0) {
        errors.push("Void settlement amount cannot be negative");
      }
    } else {
      if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
        errors.push(
          `Settlement amount must be a positive integer minor units (received: ${amountMinor})`,
        );
      }
    }

    // 2. Currency verification
    if (currency.toUpperCase() !== purchase.currency.toUpperCase()) {
      errors.push(
        `Currency mismatch: request currency '${currency}' does not match purchase currency '${purchase.currency}'`,
      );
    }

    // 3. Balance verification for Captures: capture <= authorized - already captured
    if (kind === "CAPTURE" || kind === "PARTIAL_CAPTURE") {
      const remainingAuthorized = purchase.amountMinor - (purchase.capturedAmountMinor || 0);
      if (amountMinor > remainingAuthorized) {
        errors.push(
          `Capture amount ($${(amountMinor / 100).toFixed(2)}) exceeds remaining authorized balance ($${(
            remainingAuthorized / 100
          ).toFixed(2)})`,
        );
      }
    }

    // 4. Balance verification for Refunds: refund <= captured - already refunded
    if (kind === "REFUND_FULL" || kind === "REFUND_PARTIAL") {
      const alreadyCaptured = purchase.capturedAmountMinor || 0;
      const alreadyRefunded = purchase.refundedAmountMinor || 0;
      const remainingCaptured = alreadyCaptured - alreadyRefunded;

      if (alreadyCaptured <= 0) {
        errors.push("Cannot issue refund: purchase has zero captured funds");
      } else if (amountMinor > remainingCaptured) {
        errors.push(
          `Refund amount ($${(amountMinor / 100).toFixed(2)}) exceeds remaining captured balance ($${(
            remainingCaptured / 100
          ).toFixed(2)})`,
        );
      }
    }

    // 5. Map settlement kind to state machine transition action
    let resolvedAction: PurchaseTransitionAction;
    switch (kind) {
      case "CAPTURE":
        resolvedAction =
          purchase.state === "DISPUTED" || purchase.state === "NEEDS_HUMAN_REVIEW"
            ? "RESOLVE_CAPTURE"
            : "CAPTURE_PAYMENT";
        break;
      case "PARTIAL_CAPTURE":
        resolvedAction =
          purchase.state === "DISPUTED" || purchase.state === "NEEDS_HUMAN_REVIEW"
            ? "RESOLVE_CAPTURE"
            : "CAPTURE_PARTIAL";
        break;
      case "VOID":
        resolvedAction =
          purchase.state === "DISPUTED" || purchase.state === "NEEDS_HUMAN_REVIEW"
            ? "RESOLVE_VOID"
            : "VOID_ORDER";
        break;
      case "REFUND_FULL":
        resolvedAction = "RESOLVE_REFUND_FULL";
        break;
      case "REFUND_PARTIAL":
        resolvedAction = "RESOLVE_REFUND_PARTIAL";
        break;
      default:
        resolvedAction = "ESCALATE";
        errors.push(`Unknown settlement kind: ${String(kind)}`);
    }

    // 6. Verify transition legality from current state
    if (!canTransition(purchase.state, resolvedAction)) {
      errors.push(
        `Action '${resolvedAction}' (from ${kind}) is an illegal state transition from current state '${purchase.state}'`,
      );
    }

    // 7. Human override requires reviewerId and reason
    if (requestedBy === "human") {
      if (!reviewerId || typeof reviewerId !== "string" || reviewerId.trim().length === 0) {
        errors.push("Human override settlement requires a valid non-empty reviewerId");
      }
      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        errors.push(
          "Human override settlement requires a non-empty reason explaining the decision",
        );
      }
    }

    // 8. Dispute-driven actions require a validated verdict id
    if (requestedBy === "policy") {
      if (!verdictId || typeof verdictId !== "string" || verdictId.trim().length === 0) {
        errors.push("Dispute-driven policy settlement requires a validated verdictId");
      }
    }

    return {
      passed: errors.length === 0,
      errors,
      resolvedAction,
    };
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
