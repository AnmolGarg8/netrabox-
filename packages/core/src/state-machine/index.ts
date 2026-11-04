import type { PurchaseState } from "../schemas/purchase.js";

export type PurchaseTransitionAction =
  | "PASS_INTENT_CHECK"
  | "FAIL_INTENT_CHECK"
  | "REQUEST_APPROVAL"
  | "APPROVE_AND_AUTHORIZE"
  | "REJECT_APPROVAL"
  | "RECORD_DELIVERY"
  | "VOID_ORDER"
  | "CAPTURE_PAYMENT"
  | "CAPTURE_PARTIAL"
  | "OPEN_DISPUTE"
  | "RESOLVE_CAPTURE"
  | "RESOLVE_VOID"
  | "RESOLVE_REFUND_FULL"
  | "RESOLVE_REFUND_PARTIAL"
  | "RESOLVE_REJECT"
  | "ESCALATE";

export interface TransitionRule {
  from: PurchaseState;
  action: PurchaseTransitionAction;
  to: PurchaseState;
}

export const PURCHASE_TRANSITIONS: TransitionRule[] = [
  { from: "DRAFT", action: "PASS_INTENT_CHECK", to: "INTENT_CHECKED" },
  { from: "DRAFT", action: "FAIL_INTENT_CHECK", to: "VOIDED" },
  { from: "INTENT_CHECKED", action: "REQUEST_APPROVAL", to: "AWAITING_BUYER_APPROVAL" },
  { from: "AWAITING_BUYER_APPROVAL", action: "APPROVE_AND_AUTHORIZE", to: "AUTHORIZED" },
  { from: "AWAITING_BUYER_APPROVAL", action: "REJECT_APPROVAL", to: "VOIDED" },
  { from: "AUTHORIZED", action: "RECORD_DELIVERY", to: "DELIVERED" },
  { from: "AUTHORIZED", action: "VOID_ORDER", to: "VOIDED" },
  { from: "AUTHORIZED", action: "OPEN_DISPUTE", to: "DISPUTED" },
  { from: "DELIVERED", action: "CAPTURE_PAYMENT", to: "CAPTURED" },
  { from: "DELIVERED", action: "CAPTURE_PARTIAL", to: "PARTIALLY_CAPTURED" },
  { from: "DELIVERED", action: "OPEN_DISPUTE", to: "DISPUTED" },
  { from: "CAPTURED", action: "OPEN_DISPUTE", to: "DISPUTED" },
  { from: "PARTIALLY_CAPTURED", action: "OPEN_DISPUTE", to: "DISPUTED" },
  { from: "DISPUTED", action: "RESOLVE_CAPTURE", to: "RESOLVED_CAPTURED" },
  { from: "DISPUTED", action: "RESOLVE_VOID", to: "RESOLVED_VOIDED" },
  { from: "DISPUTED", action: "RESOLVE_REFUND_FULL", to: "RESOLVED_REFUNDED_FULL" },
  { from: "DISPUTED", action: "RESOLVE_REFUND_PARTIAL", to: "RESOLVED_REFUNDED_PARTIAL" },
  { from: "DISPUTED", action: "RESOLVE_REJECT", to: "RESOLVED_REJECTED" },
  { from: "DISPUTED", action: "ESCALATE", to: "NEEDS_HUMAN_REVIEW" },
  { from: "NEEDS_HUMAN_REVIEW", action: "RESOLVE_CAPTURE", to: "RESOLVED_CAPTURED" },
  { from: "NEEDS_HUMAN_REVIEW", action: "RESOLVE_VOID", to: "RESOLVED_VOIDED" },
  { from: "NEEDS_HUMAN_REVIEW", action: "RESOLVE_REFUND_FULL", to: "RESOLVED_REFUNDED_FULL" },
  { from: "NEEDS_HUMAN_REVIEW", action: "RESOLVE_REFUND_PARTIAL", to: "RESOLVED_REFUNDED_PARTIAL" },
  { from: "NEEDS_HUMAN_REVIEW", action: "RESOLVE_REJECT", to: "RESOLVED_REJECTED" },
];

export class StateTransitionError extends Error {
  constructor(currentState: PurchaseState, action: PurchaseTransitionAction) {
    super(
      `Illegal state transition: cannot perform action '${action}' from state '${currentState}'`,
    );
    this.name = "StateTransitionError";
  }
}

export function getNextPurchaseState(
  currentState: PurchaseState,
  action: PurchaseTransitionAction,
): PurchaseState {
  const match = PURCHASE_TRANSITIONS.find(
    (rule) => rule.from === currentState && rule.action === action,
  );
  if (!match) {
    throw new StateTransitionError(currentState, action);
  }
  return match.to;
}

export function canTransition(
  currentState: PurchaseState,
  action: PurchaseTransitionAction,
): boolean {
  return PURCHASE_TRANSITIONS.some((rule) => rule.from === currentState && rule.action === action);
}
