import type { PurchaseTransitionAction, EvidenceEventType } from "@netrabox/core";

export function mapActionToEvidenceType(action: PurchaseTransitionAction): EvidenceEventType {
  switch (action) {
    case "PASS_INTENT_CHECK":
    case "FAIL_INTENT_CHECK":
      return "INTENT_CHECK_RESULT";
    case "REQUEST_APPROVAL":
      return "CART_PROPOSED";
    case "APPROVE_AND_AUTHORIZE":
      return "PAYPAL_AUTHORIZED";
    case "REJECT_APPROVAL":
      return "USER_APPROVAL";
    case "RECORD_DELIVERY":
      return "DELIVERY_EVENT";
    case "VOID_ORDER":
    case "RESOLVE_VOID":
      return "PAYPAL_VOIDED";
    case "CAPTURE_PAYMENT":
    case "CAPTURE_PARTIAL":
    case "RESOLVE_CAPTURE":
      return "PAYPAL_CAPTURED";
    case "RESOLVE_REFUND_FULL":
    case "RESOLVE_REFUND_PARTIAL":
      return "PAYPAL_REFUNDED";
    case "OPEN_DISPUTE":
      return "DISPUTE_OPENED";
    case "RESOLVE_REJECT":
    case "ESCALATE":
      return "TRIBUNAL_VERDICT";
    default:
      return "ACTION_EXECUTED";
  }
}
