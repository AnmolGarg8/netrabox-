import { randomUUID } from "node:crypto";
import {
  PolicyEngine,
  type CheckSettlementRequest,
  type SettlementActionKind,
  type SettlementActionRecord,
  type SettlementActionStatus,
  type SettlementRequestedBy,
  generateSettlementIdempotencyKey,
  computeEventHash,
  signHash,
  GENESIS_PREV_HASH,
  type EvidenceEvent,
  type EvidenceEventBody,
  type EvidenceEventType,
  getNextPurchaseState,
  getPublicKeyFromPrivate,
} from "@netrabox/core";
import type { IStateStore } from "../state-machine/machine.js";
import type { PayPalClient } from "../paypal/client.js";
import { PayPalError } from "../paypal/errors.js";
import type {
  PayPalCaptureResponse,
  PayPalVoidResponse,
  PayPalRefundResponse,
} from "../paypal/types.js";
import type { PurchaseRecord } from "../state-machine/types.js";

type MutatingPayPalResponse = PayPalCaptureResponse | PayPalVoidResponse | PayPalRefundResponse;

export class SettlementPolicyViolationError extends Error {
  public readonly errors: string[];
  constructor(errors: string[]) {
    super(`Settlement policy check failed: ${errors.join("; ")}`);
    this.name = "SettlementPolicyViolationError";
    this.errors = errors;
  }
}

export interface ExecuteSettlementParams {
  purchaseId: string;
  kind: SettlementActionKind;
  amountMinor: number;
  currency?: string;
  requestedBy: SettlementRequestedBy;
  reason?: string | null;
  verdictId?: string | null;
  reviewerId?: string | null;
  disputeId?: string | null;
  sequence?: number;
  finalCapture?: boolean;
}

export interface ExecuteSettlementResult {
  settlementAction: SettlementActionRecord;
  status: SettlementActionStatus;
  idempotentReplay?: boolean;
  purchase?: PurchaseRecord;
  error?: string;
}

export class SettlementService {
  private store: IStateStore;
  private paypalClient: PayPalClient;
  private policyEngine: PolicyEngine;
  private signingPrivateKeyHex: string;
  private signerKeyId: string;

  constructor(
    store: IStateStore,
    paypalClient: PayPalClient,
    policyEngine: PolicyEngine,
    signingPrivateKeyHex: string,
  ) {
    this.store = store;
    this.paypalClient = paypalClient;
    this.policyEngine = policyEngine;
    this.signingPrivateKeyHex = signingPrivateKeyHex;
    try {
      const pubHex = getPublicKeyFromPrivate(signingPrivateKeyHex);
      this.signerKeyId = `key_system_${pubHex.slice(0, 12)}`;
    } catch {
      this.signerKeyId = "key_system_settlement";
    }
  }

  /**
   * Helper to build and sign a hash-chained evidence event
   */
  private async createSignedEvent(
    purchaseId: string,
    type: EvidenceEventType,
    payload: Record<string, unknown>,
  ): Promise<EvidenceEvent> {
    const lastEvent = await this.store.getLastEvidenceEvent(purchaseId);
    const seq = lastEvent ? lastEvent.seq + 1 : 1;
    const prevHash = lastEvent ? lastEvent.hash : GENESIS_PREV_HASH;
    const eventId = `ev_${randomUUID()}`;
    const createdAt = new Date().toISOString();

    const body: EvidenceEventBody = {
      id: eventId,
      purchaseId,
      seq,
      type,
      actor: "system",
      payload,
      createdAt,
      prevHash,
      signerKeyId: this.signerKeyId,
    };

    const hash = computeEventHash(body);
    const signature = signHash(hash, this.signingPrivateKeyHex);

    return {
      ...body,
      hash,
      signature,
    };
  }

  /**
   * ONLY sanctioned code path to execute mutating financial actions against PayPal rails.
   * Gated deterministically by PolicyEngine, idempotency ledger, and atomic state transitions.
   */
  public async execute(params: ExecuteSettlementParams): Promise<ExecuteSettlementResult> {
    const purchase = await this.store.getPurchase(params.purchaseId);
    if (!purchase) {
      throw new Error(`Purchase '${params.purchaseId}' not found.`);
    }

    const currency = (params.currency || purchase.currency || "USD").toUpperCase();

    // Check existing idempotency key before re-evaluating transitions (Idempotency Invariant)
    const sequence = params.sequence ?? 1;
    const idempotencyKey = generateSettlementIdempotencyKey(
      params.purchaseId,
      params.kind,
      params.amountMinor,
      sequence,
    );

    const existingAction = await this.store.getSettlementActionByIdempotencyKey(idempotencyKey);
    if (existingAction) {
      return {
        settlementAction: existingAction,
        status: existingAction.status,
        idempotentReplay: true,
      };
    }

    // 1. PolicyEngine.checkSettlement: deterministic invariant verification
    const checkRequest: CheckSettlementRequest = {
      kind: params.kind,
      amountMinor: params.amountMinor,
      currency,
      purchase: {
        id: purchase.id,
        state: purchase.state,
        amountMinor: purchase.amountMinor,
        capturedAmountMinor: purchase.capturedAmountMinor,
        refundedAmountMinor: purchase.refundedAmountMinor,
        currency: purchase.currency,
      },
      requestedBy: params.requestedBy,
      reviewerId: params.reviewerId,
      reason: params.reason,
      verdictId: params.verdictId,
      disputeId: params.disputeId,
    };

    const checkResult = this.policyEngine.checkSettlement(checkRequest);
    if (!checkResult.passed) {
      throw new SettlementPolicyViolationError(checkResult.errors);
    }

    // 2. Prepare action record
    const actionRecord: SettlementActionRecord = {
      id: `set_act_${randomUUID()}`,
      purchaseId: params.purchaseId,
      disputeId: params.disputeId ?? null,
      kind: params.kind,
      amountMinor: params.amountMinor,
      currency,
      idempotencyKey,
      status: "PENDING",
      requestedBy: params.requestedBy,
      verdictId: params.verdictId ?? null,
      reviewerId: params.reviewerId ?? null,
      reason: params.reason ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // 3. Atomically record PENDING state and append SETTLEMENT_REQUESTED evidence
    const requestedEvent = await this.createSignedEvent(params.purchaseId, "SETTLEMENT_REQUESTED", {
      settlementActionId: actionRecord.id,
      kind: params.kind,
      amountMinor: params.amountMinor,
      currency,
      idempotencyKey,
      requestedBy: params.requestedBy,
      reason: params.reason,
      verdictId: params.verdictId,
      reviewerId: params.reviewerId,
    });

    const pendingResult = await this.store.recordSettlementPendingWithEvidence({
      action: actionRecord,
      evidenceEvent: requestedEvent,
    });

    // If already exists with this idempotency key, return existing and do not call PayPal again
    if (pendingResult.existing) {
      return {
        settlementAction: pendingResult.action,
        status: pendingResult.action.status,
        idempotentReplay: true,
      };
    }

    const activeAction = pendingResult.action;

    // 4. Call PayPal with the same idempotency key
    let paypalResponse: MutatingPayPalResponse | null = null;
    try {
      if (params.kind === "CAPTURE" || params.kind === "PARTIAL_CAPTURE") {
        if (!purchase.paypalAuthorizationId) {
          throw new Error("Missing paypalAuthorizationId on purchase for capture");
        }
        paypalResponse = await this.paypalClient.captureAuthorization(
          purchase.paypalAuthorizationId,
          params.purchaseId,
          {
            amountMinor: params.amountMinor,
            currency,
            finalCapture: params.finalCapture ?? params.kind === "CAPTURE",
            idempotencyKey,
          },
        );
      } else if (params.kind === "VOID") {
        if (!purchase.paypalAuthorizationId) {
          throw new Error("Missing paypalAuthorizationId on purchase for void");
        }
        paypalResponse = await this.paypalClient.voidAuthorization(
          purchase.paypalAuthorizationId,
          params.purchaseId,
          {
            idempotencyKey,
          },
        );
      } else if (params.kind === "REFUND_FULL" || params.kind === "REFUND_PARTIAL") {
        if (!purchase.paypalCaptureId) {
          throw new Error("Missing paypalCaptureId on purchase for refund");
        }
        paypalResponse = await this.paypalClient.refundCapture(
          purchase.paypalCaptureId,
          params.purchaseId,
          {
            amountMinor: params.amountMinor,
            currency,
            note: params.reason || undefined,
            idempotencyKey,
          },
        );
      } else {
        throw new Error(`Unsupported settlement kind: ${String(params.kind)}`);
      }
    } catch (err: unknown) {
      // (e) On definitive PayPal error (4xx client failure), mark FAILED and leave state unchanged
      if (err instanceof PayPalError && err.status >= 400 && err.status < 500 && !err.isRetryable) {
        const failedEvent = await this.createSignedEvent(params.purchaseId, "SETTLEMENT_FAILED", {
          settlementActionId: activeAction.id,
          kind: params.kind,
          amountMinor: params.amountMinor,
          currency,
          error: err.message,
          paypalStatus: err.status,
          paypalErrorName: err.paypalErrorName,
          debugId: err.debug_id,
        });

        const failedAction = await this.store.recordSettlementFailureWithEvidence(
          activeAction.id,
          {
            status: "FAILED",
            errorMessage: err.message,
            paypalDebugId: err.debug_id,
          },
          failedEvent,
        );

        return {
          settlementAction: failedAction,
          status: "FAILED",
          error: err.message,
        };
      }

      // (f) On a timeout, 5xx, or network error: mark NEEDS_RECONCILE
      const reconcileAction = await this.store.updateSettlementAction(activeAction.id, {
        status: "NEEDS_RECONCILE",
        errorMessage: err instanceof Error ? err.message : String(err),
        paypalDebugId: err instanceof PayPalError ? err.debug_id : undefined,
      });

      return {
        settlementAction: reconcileAction,
        status: "NEEDS_RECONCILE",
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // (d) On success: in one atomic transaction, mark SUCCEEDED, transition state machine, and append evidence
    const nextState = getNextPurchaseState(purchase.state, checkResult.resolvedAction);

    // Build evidence events
    const paypalEvidenceType =
      params.kind === "CAPTURE" || params.kind === "PARTIAL_CAPTURE"
        ? "PAYPAL_CAPTURED"
        : params.kind === "VOID"
          ? "PAYPAL_VOIDED"
          : "PAYPAL_REFUNDED";

    const paypalEvidencePayload: Record<string, unknown> = {
      settlementActionId: activeAction.id,
      amountMinor: params.amountMinor,
      currency,
      paypalResponse,
    };

    if (params.kind === "CAPTURE" || params.kind === "PARTIAL_CAPTURE") {
      paypalEvidencePayload.paypalCaptureId = paypalResponse?.id;
      paypalEvidencePayload.finalCapture = params.finalCapture ?? params.kind === "CAPTURE";
      paypalEvidencePayload.isPartial = params.kind === "PARTIAL_CAPTURE";
    } else if (params.kind === "VOID") {
      paypalEvidencePayload.paypalAuthorizationId = purchase.paypalAuthorizationId;
    } else {
      paypalEvidencePayload.paypalRefundId = paypalResponse?.id;
      paypalEvidencePayload.isPartial = params.kind === "REFUND_PARTIAL";
    }

    const paypalEvent = await this.createSignedEvent(
      params.purchaseId,
      paypalEvidenceType,
      paypalEvidencePayload,
    );

    // Temporary link to create next event in chain
    const actionExecutedEvent = await this.createSignedEventWithPrev(
      params.purchaseId,
      "ACTION_EXECUTED",
      {
        action: checkResult.resolvedAction,
        settlementActionId: activeAction.id,
        transactionId: paypalResponse?.id,
        amountMinor: params.amountMinor,
        executedAt: new Date().toISOString(),
      },
      paypalEvent,
    );

    const purchasePatch: Partial<PurchaseRecord> = {};
    if (params.kind === "CAPTURE" || params.kind === "PARTIAL_CAPTURE") {
      purchasePatch.capturedAmountMinor = (purchase.capturedAmountMinor || 0) + params.amountMinor;
      if (paypalResponse?.id) {
        purchasePatch.paypalCaptureId = paypalResponse.id;
      }
    } else if (params.kind === "REFUND_FULL" || params.kind === "REFUND_PARTIAL") {
      purchasePatch.refundedAmountMinor = (purchase.refundedAmountMinor || 0) + params.amountMinor;
    }

    const actionPatch: Partial<SettlementActionRecord> = {
      paypalCaptureId:
        params.kind === "CAPTURE" || params.kind === "PARTIAL_CAPTURE"
          ? paypalResponse?.id
          : undefined,
      paypalRefundId:
        params.kind === "REFUND_FULL" || params.kind === "REFUND_PARTIAL"
          ? paypalResponse?.id
          : undefined,
      paypalAuthorizationId: purchase.paypalAuthorizationId || undefined,
      paypalDebugId: (paypalResponse as unknown as { debug_id?: string })?.debug_id || undefined,
    };

    try {
      await this.store.applyAtomicSettlementSuccess({
        actionId: activeAction.id,
        purchaseId: params.purchaseId,
        nextState,
        patch: purchasePatch,
        evidenceEvents: [paypalEvent, actionExecutedEvent],
        actionPatch,
      });
    } catch (dbErr) {
      // (f) Failure after PayPal succeeded -> mark NEEDS_RECONCILE
      const reconcileAction = await this.store.updateSettlementAction(activeAction.id, {
        status: "NEEDS_RECONCILE",
        errorMessage: `DB transition failed after PayPal success: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
        paypalCaptureId: actionPatch.paypalCaptureId,
        paypalRefundId: actionPatch.paypalRefundId,
      });

      return {
        settlementAction: reconcileAction,
        status: "NEEDS_RECONCILE",
        error: `Database failure: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
      };
    }

    const updatedAction = await this.store.getSettlementAction(activeAction.id);
    const updatedPurchase = await this.store.getPurchase(params.purchaseId);

    return {
      settlementAction: updatedAction || activeAction,
      status: "SUCCEEDED",
      purchase: updatedPurchase || undefined,
    };
  }

  /**
   * Helper to sign an event directly chained from an unsaved event
   */
  private async createSignedEventWithPrev(
    purchaseId: string,
    type: EvidenceEventType,
    payload: Record<string, unknown>,
    prevEvent: EvidenceEvent,
  ): Promise<EvidenceEvent> {
    const seq = prevEvent.seq + 1;
    const prevHash = prevEvent.hash;
    const eventId = `ev_${randomUUID()}`;
    const createdAt = new Date().toISOString();

    const body: EvidenceEventBody = {
      id: eventId,
      purchaseId,
      seq,
      type,
      actor: "system",
      payload,
      createdAt,
      prevHash,
      signerKeyId: this.signerKeyId,
    };

    const hash = computeEventHash(body);
    const signature = signHash(hash, this.signingPrivateKeyHex);

    return {
      ...body,
      hash,
      signature,
    };
  }

  /**
   * Reconciles pending or stranded settlement actions.
   * Asks PayPal for real state with the same idempotency key, then finalizes state and evidence.
   */
  public async reconcile(
    olderThanMs = 30000,
  ): Promise<{ reconciled: number; actions: SettlementActionRecord[] }> {
    const actions = await this.store.getUnreconciledSettlementActions(olderThanMs);
    let count = 0;
    const finalized: SettlementActionRecord[] = [];

    for (const action of actions) {
      try {
        const purchase = await this.store.getPurchase(action.purchaseId);
        if (!purchase) continue;

        // If the action already succeeded in PayPal (or was pending with an idempotency key),
        // query PayPal by re-executing with the exact same idempotency key or fetching status.
        let paypalResponse: MutatingPayPalResponse | null = null;
        if (action.kind === "CAPTURE" || action.kind === "PARTIAL_CAPTURE") {
          paypalResponse = await this.paypalClient.captureAuthorization(
            purchase.paypalAuthorizationId!,
            action.purchaseId,
            {
              amountMinor: action.amountMinor,
              currency: action.currency,
              finalCapture: action.kind === "CAPTURE",
              idempotencyKey: action.idempotencyKey,
            },
          );
        } else if (action.kind === "VOID") {
          paypalResponse = await this.paypalClient.voidAuthorization(
            purchase.paypalAuthorizationId!,
            action.purchaseId,
            {
              idempotencyKey: action.idempotencyKey,
            },
          );
        } else if (action.kind === "REFUND_FULL" || action.kind === "REFUND_PARTIAL") {
          paypalResponse = await this.paypalClient.refundCapture(
            purchase.paypalCaptureId!,
            action.purchaseId,
            {
              amountMinor: action.amountMinor,
              currency: action.currency,
              idempotencyKey: action.idempotencyKey,
            },
          );
        }

        // PayPal call completed/deduplicated: finalize atomic transition
        const checkResult = this.policyEngine.checkSettlement({
          kind: action.kind,
          amountMinor: action.amountMinor,
          currency: action.currency,
          purchase: {
            id: purchase.id,
            state: purchase.state,
            amountMinor: purchase.amountMinor,
            capturedAmountMinor: purchase.capturedAmountMinor,
            refundedAmountMinor: purchase.refundedAmountMinor,
            currency: purchase.currency,
          },
          requestedBy: action.requestedBy,
          reviewerId: action.reviewerId,
          reason: action.reason,
          verdictId: action.verdictId,
          disputeId: action.disputeId,
        });

        // Determine next state
        const nextState = checkResult.passed
          ? getNextPurchaseState(purchase.state, checkResult.resolvedAction)
          : purchase.state;

        const paypalEvidenceType =
          action.kind === "CAPTURE" || action.kind === "PARTIAL_CAPTURE"
            ? "PAYPAL_CAPTURED"
            : action.kind === "VOID"
              ? "PAYPAL_VOIDED"
              : "PAYPAL_REFUNDED";

        const ev1 = await this.createSignedEvent(action.purchaseId, paypalEvidenceType, {
          settlementActionId: action.id,
          reconciled: true,
          amountMinor: action.amountMinor,
          paypalResponse,
        });

        const ev2 = await this.createSignedEventWithPrev(
          action.purchaseId,
          "ACTION_EXECUTED",
          {
            action: checkResult.resolvedAction,
            settlementActionId: action.id,
            reconciled: true,
            transactionId: paypalResponse?.id,
            amountMinor: action.amountMinor,
          },
          ev1,
        );

        const purchasePatch: Partial<PurchaseRecord> = {};
        if (action.kind === "CAPTURE" || action.kind === "PARTIAL_CAPTURE") {
          purchasePatch.capturedAmountMinor =
            (purchase.capturedAmountMinor || 0) + action.amountMinor;
          if (paypalResponse?.id) purchasePatch.paypalCaptureId = paypalResponse.id;
        } else if (action.kind === "REFUND_FULL" || action.kind === "REFUND_PARTIAL") {
          purchasePatch.refundedAmountMinor =
            (purchase.refundedAmountMinor || 0) + action.amountMinor;
        }

        await this.store.applyAtomicSettlementSuccess({
          actionId: action.id,
          purchaseId: action.purchaseId,
          nextState,
          patch: purchasePatch,
          evidenceEvents: [ev1, ev2],
          actionPatch: {
            paypalCaptureId: paypalResponse?.id,
            paypalRefundId: action.kind.includes("REFUND") ? paypalResponse?.id : undefined,
          },
        });

        const updated = await this.store.getSettlementAction(action.id);
        if (updated) finalized.push(updated);
        count++;
      } catch (err: unknown) {
        if (
          err instanceof PayPalError &&
          err.status >= 400 &&
          err.status < 500 &&
          !err.isRetryable
        ) {
          const failedAction = await this.store.updateSettlementAction(action.id, {
            status: "FAILED",
            errorMessage: err.message,
            paypalDebugId: err.debug_id,
          });
          finalized.push(failedAction);
          count++;
        }
      }
    }

    return { reconciled: count, actions: finalized };
  }
}
