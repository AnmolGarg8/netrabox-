import type {
  PurchaseState,
  PurchaseTransitionAction,
  EvidenceActor,
  EvidenceEvent,
} from "@netrabox/core";

export interface PurchaseRecord {
  id: string;
  buyerId: string;
  agentId: string;
  merchantId: string;
  title: string;
  state: PurchaseState;
  currency: string;
  amountMinor: number;
  capturedAmountMinor: number;
  refundedAmountMinor: number;
  paypalOrderId?: string | null;
  paypalAuthorizationId?: string | null;
  paypalCaptureId?: string | null;
  intentCheckPassed?: boolean | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TransitionContext {
  purchaseId: string;
  action: PurchaseTransitionAction;
  actor: EvidenceActor;
  payload: Record<string, unknown>;
  signerKeyId?: string;
  signingPrivateKeyHex: string;
  // Optional balance/field mutations associated with this transition
  patch?: {
    capturedAmountMinor?: number;
    refundedAmountMinor?: number;
    paypalOrderId?: string;
    paypalAuthorizationId?: string;
    paypalCaptureId?: string;
    intentCheckPassed?: boolean;
    metadata?: Record<string, unknown>;
  };
}

export interface TransitionResult {
  purchase: PurchaseRecord;
  evidenceEvent: EvidenceEvent;
}
