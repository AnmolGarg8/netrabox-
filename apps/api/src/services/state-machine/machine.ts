import { randomUUID } from "node:crypto";
import {
  getNextPurchaseState,
  canTransition,
  StateTransitionError,
  computeEventHash,
  signHash,
  GENESIS_PREV_HASH,
  type EvidenceEvent,
  type EvidenceEventBody,
  type SettlementActionRecord,
  type PurchaseState,
} from "@netrabox/core";
import type { PurchaseRecord, TransitionContext, TransitionResult } from "./types.js";
import { mapActionToEvidenceType } from "./mapper.js";

export interface IStateStore {
  getPurchase(purchaseId: string): Promise<PurchaseRecord | null>;
  listPurchases?(query?: { state?: string }): Promise<PurchaseRecord[]>;
  getDb?(): unknown;
  getLastEvidenceEvent(purchaseId: string): Promise<EvidenceEvent | null>;
  getEvidenceEvents(purchaseId: string): Promise<EvidenceEvent[]>;
  applyAtomicTransition(
    purchaseId: string,
    nextState: PurchaseRecord["state"],
    patch: Partial<PurchaseRecord>,
    event: EvidenceEvent,
  ): Promise<PurchaseRecord>;
  tamperEvidenceEvent?(
    purchaseId: string,
    targetSeq: number,
    tamperedPayload: Record<string, unknown>,
  ): Promise<boolean>;

  // Settlement Actions & Reconciliation Store Invariants
  getSettlementAction(id: string): Promise<SettlementActionRecord | null>;
  getSettlementActionByIdempotencyKey(key: string): Promise<SettlementActionRecord | null>;
  createSettlementAction(action: SettlementActionRecord): Promise<SettlementActionRecord>;
  updateSettlementAction(
    id: string,
    patch: Partial<SettlementActionRecord>,
  ): Promise<SettlementActionRecord>;
  getUnreconciledSettlementActions(olderThanMs?: number): Promise<SettlementActionRecord[]>;
  recordSettlementPendingWithEvidence(params: {
    action: SettlementActionRecord;
    evidenceEvent: EvidenceEvent;
  }): Promise<{ existing: boolean; action: SettlementActionRecord }>;
  applyAtomicSettlementSuccess(params: {
    actionId: string;
    purchaseId: string;
    nextState: PurchaseState;
    patch: Partial<PurchaseRecord>;
    evidenceEvents: EvidenceEvent[];
    actionPatch: Partial<SettlementActionRecord>;
  }): Promise<void>;
  recordSettlementFailureWithEvidence(
    actionId: string,
    patch: Partial<SettlementActionRecord>,
    failedEvent: EvidenceEvent,
  ): Promise<SettlementActionRecord>;
}

export class PurchaseStateMachineService {
  private store: IStateStore;

  constructor(store: IStateStore) {
    this.store = store;
  }

  /**
   * Executes a state transition atomically along with an Ed25519-signed, SHA-256 hash-chained evidence event.
   */
  public async transition(context: TransitionContext): Promise<TransitionResult> {
    const purchase = await this.store.getPurchase(context.purchaseId);
    if (!purchase) {
      throw new Error(`Purchase '${context.purchaseId}' not found.`);
    }

    if (!canTransition(purchase.state, context.action)) {
      throw new StateTransitionError(purchase.state, context.action);
    }

    const nextState = getNextPurchaseState(purchase.state, context.action);

    // Retrieve previous event in chain to link hashes
    const lastEvent = await this.store.getLastEvidenceEvent(context.purchaseId);
    const nextSeq = lastEvent ? lastEvent.seq + 1 : 1;
    const prevHash = lastEvent ? lastEvent.hash : GENESIS_PREV_HASH;

    const eventId = `ev_${randomUUID()}`;
    const eventType = mapActionToEvidenceType(context.action);
    const createdAt = new Date().toISOString();

    const body: EvidenceEventBody = {
      id: eventId,
      purchaseId: context.purchaseId,
      seq: nextSeq,
      type: eventType,
      actor: context.actor,
      payload: {
        ...context.payload,
        transition: {
          from: purchase.state,
          to: nextState,
          action: context.action,
        },
      },
      createdAt,
      prevHash,
      signerKeyId: context.signerKeyId || "netrabox_system_key",
    };

    // SHA-256 hash chaining
    const hash = computeEventHash(body);

    // Ed25519 cryptographic signature over hash
    const signature = signHash(hash, context.signingPrivateKeyHex);

    const fullEvent: EvidenceEvent = {
      ...body,
      hash,
      signature,
    };

    const patch: Partial<PurchaseRecord> = {
      state: nextState,
      updatedAt: new Date(),
      ...(context.patch || {}),
    };

    const updatedPurchase = await this.store.applyAtomicTransition(
      context.purchaseId,
      nextState,
      patch,
      fullEvent,
    );

    return {
      purchase: updatedPurchase,
      evidenceEvent: fullEvent,
    };
  }
}
