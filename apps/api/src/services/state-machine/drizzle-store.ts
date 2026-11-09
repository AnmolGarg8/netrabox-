import { eq, desc, asc, and, or, lt } from "drizzle-orm";
import {
  type EvidenceEvent,
  type SettlementActionRecord,
  type PurchaseState,
} from "@netrabox/core";
import { purchases, evidenceEvents, settlementActions } from "@netrabox/core/schemas";
import { db as defaultDb, type DbType } from "@netrabox/core/db";
import type { IStateStore } from "./machine.js";
import type { PurchaseRecord } from "./types.js";

export class DrizzleStateStore implements IStateStore {
  private db: DbType;

  constructor(customDb?: DbType) {
    this.db = customDb || defaultDb;
  }

  public getDb(): DbType {
    return this.db;
  }

  async listPurchases(filter?: { state?: PurchaseState }): Promise<PurchaseRecord[]> {
    if (filter?.state) {
      const rows = await this.db.select().from(purchases).where(eq(purchases.state, filter.state));
      return rows as unknown as PurchaseRecord[];
    }
    const rows = await this.db.select().from(purchases);
    return rows as unknown as PurchaseRecord[];
  }

  async getPurchase(purchaseId: string): Promise<PurchaseRecord | null> {
    const rows = await this.db.select().from(purchases).where(eq(purchases.id, purchaseId)).limit(1);
    if (!rows || rows.length === 0) return null;
    return rows[0] as unknown as PurchaseRecord;
  }

  async getLastEvidenceEvent(purchaseId: string): Promise<EvidenceEvent | null> {
    const rows = await this.db
      .select()
      .from(evidenceEvents)
      .where(eq(evidenceEvents.purchaseId, purchaseId))
      .orderBy(desc(evidenceEvents.seq))
      .limit(1);

    if (!rows || rows.length === 0) return null;
    const r = rows[0] as any;
    return {
      ...r,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    } as unknown as EvidenceEvent;
  }

  async getEvidenceEvents(purchaseId: string): Promise<EvidenceEvent[]> {
    const rows = await this.db
      .select()
      .from(evidenceEvents)
      .where(eq(evidenceEvents.purchaseId, purchaseId))
      .orderBy(asc(evidenceEvents.seq));

    return rows.map((r: any) => ({
      ...r,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    })) as unknown as EvidenceEvent[];
  }

  async tamperEvidenceEvent(
    purchaseId: string,
    targetSeq: number,
    tamperedPayload: Record<string, unknown>,
  ): Promise<boolean> {
    const updated = await this.db
      .update(evidenceEvents)
      .set({ payload: tamperedPayload })
      .where(and(eq(evidenceEvents.purchaseId, purchaseId), eq(evidenceEvents.seq, targetSeq)))
      .returning();

    return updated.length > 0;
  }

  async applyAtomicTransition(
    purchaseId: string,
    _nextState: PurchaseRecord["state"],
    patch: Partial<PurchaseRecord>,
    event: EvidenceEvent,
  ): Promise<PurchaseRecord> {
    return await this.db.transaction(async (tx: any) => {
      // 1. Ensure purchase record exists / update or insert FIRST so FK is satisfied
      const existing = await tx
        .select()
        .from(purchases)
        .where(eq(purchases.id, purchaseId))
        .limit(1);

      let resultRecord: PurchaseRecord;

      if (!existing || existing.length === 0) {
        const inserted = await tx
          .insert(purchases)
          .values({
            id: purchaseId,
            buyerId: (patch.buyerId as string) || "usr_unknown",
            agentId: (patch.agentId as string) || "agent_unknown",
            merchantId: (patch.merchantId as string) || "merch_unknown",
            title: (patch.title as string) || `Purchase ${purchaseId}`,
            state: patch.state || _nextState || "DRAFT",
            currency: patch.currency || "USD",
            amountMinor: patch.amountMinor ?? 0,
            capturedAmountMinor: patch.capturedAmountMinor ?? 0,
            refundedAmountMinor: patch.refundedAmountMinor ?? 0,
            paypalOrderId: patch.paypalOrderId || null,
            paypalAuthorizationId: patch.paypalAuthorizationId || null,
            paypalCaptureId: patch.paypalCaptureId || null,
            intentCheckPassed: patch.intentCheckPassed ?? false,
            metadata: patch.metadata || {},
            createdAt: patch.createdAt ? new Date(patch.createdAt) : new Date(),
            updatedAt: new Date(),
          })
          .returning();
        resultRecord = inserted[0] as unknown as PurchaseRecord;
      } else {
        const updatedRows = await tx
          .update(purchases)
          .set({
            ...patch,
            state: _nextState || patch.state || existing[0].state,
            updatedAt: new Date(),
          })
          .where(eq(purchases.id, purchaseId))
          .returning();
        resultRecord = updatedRows[0] as unknown as PurchaseRecord;
      }

      // 2. Insert evidence event in the transaction
      await tx.insert(evidenceEvents).values({
        id: event.id,
        purchaseId: event.purchaseId,
        seq: event.seq,
        type: event.type,
        actor: event.actor,
        payload: event.payload,
        prevHash: event.prevHash,
        hash: event.hash,
        signature: event.signature,
        signerKeyId: event.signerKeyId,
        createdAt: new Date(event.createdAt),
      });

      return resultRecord;
    });
  }

  async getSettlementAction(id: string): Promise<SettlementActionRecord | null> {
    const rows = await this.db
      .select()
      .from(settlementActions)
      .where(eq(settlementActions.id, id))
      .limit(1);
    if (!rows || rows.length === 0) return null;
    return rows[0] as unknown as SettlementActionRecord;
  }

  async getSettlementActionByIdempotencyKey(key: string): Promise<SettlementActionRecord | null> {
    const rows = await this.db
      .select()
      .from(settlementActions)
      .where(eq(settlementActions.idempotencyKey, key))
      .limit(1);
    if (!rows || rows.length === 0) return null;
    return rows[0] as unknown as SettlementActionRecord;
  }

  async createSettlementAction(action: SettlementActionRecord): Promise<SettlementActionRecord> {
    const rows = await this.db
      .insert(settlementActions)
      .values({
        ...action,
        createdAt: new Date(action.createdAt),
        updatedAt: new Date(action.updatedAt),
      })
      .returning();
    return rows[0] as unknown as SettlementActionRecord;
  }

  async updateSettlementAction(
    id: string,
    patch: Partial<SettlementActionRecord>,
  ): Promise<SettlementActionRecord> {
    const { createdAt: _ca, updatedAt: _ua, ...cleanPatch } = patch;
    const rows = await this.db
      .update(settlementActions)
      .set({
        ...cleanPatch,
        updatedAt: new Date(),
      })
      .where(eq(settlementActions.id, id))
      .returning();
    return rows[0] as unknown as SettlementActionRecord;
  }

  async getUnreconciledSettlementActions(olderThanMs = 30000): Promise<SettlementActionRecord[]> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const rows = await this.db
      .select()
      .from(settlementActions)
      .where(
        and(
          or(
            eq(settlementActions.status, "PENDING"),
            eq(settlementActions.status, "NEEDS_RECONCILE"),
          ),
          lt(settlementActions.createdAt, cutoff),
        ),
      );
    return rows as unknown as SettlementActionRecord[];
  }

  async recordSettlementPendingWithEvidence(params: {
    action: SettlementActionRecord;
    evidenceEvent: EvidenceEvent;
  }): Promise<{ existing: boolean; action: SettlementActionRecord }> {
    return await this.db.transaction(async (tx: any) => {
      const existing = await tx
        .select()
        .from(settlementActions)
        .where(eq(settlementActions.idempotencyKey, params.action.idempotencyKey))
        .limit(1);

      if (existing && existing.length > 0) {
        return { existing: true, action: existing[0] as unknown as SettlementActionRecord };
      }

      await tx.insert(settlementActions).values({
        ...params.action,
        createdAt: new Date(params.action.createdAt),
        updatedAt: new Date(params.action.updatedAt),
      });

      await tx.insert(evidenceEvents).values({
        id: params.evidenceEvent.id,
        purchaseId: params.evidenceEvent.purchaseId,
        seq: params.evidenceEvent.seq,
        type: params.evidenceEvent.type,
        actor: params.evidenceEvent.actor,
        payload: params.evidenceEvent.payload,
        prevHash: params.evidenceEvent.prevHash,
        hash: params.evidenceEvent.hash,
        signature: params.evidenceEvent.signature,
        signerKeyId: params.evidenceEvent.signerKeyId,
        createdAt: new Date(params.evidenceEvent.createdAt),
      });

      return { existing: false, action: params.action };
    });
  }

  async applyAtomicSettlementSuccess(params: {
    actionId: string;
    purchaseId: string;
    nextState: PurchaseState;
    patch: Partial<PurchaseRecord>;
    evidenceEvents: EvidenceEvent[];
    actionPatch: Partial<SettlementActionRecord>;
  }): Promise<void> {
    await this.db.transaction(async (tx: any) => {
      // 1. Update settlement action to SUCCEEDED
      const {
        createdAt: _ca,
        updatedAt: _ua,
        status: _st,
        ...cleanActionPatch
      } = params.actionPatch;
      await tx
        .update(settlementActions)
        .set({
          ...cleanActionPatch,
          status: "SUCCEEDED",
          updatedAt: new Date(),
        })
        .where(eq(settlementActions.id, params.actionId));

      // 2. Update purchase record
      await tx
        .update(purchases)
        .set({
          ...params.patch,
          state: params.nextState,
          updatedAt: new Date(),
        })
        .where(eq(purchases.id, params.purchaseId));

      // 3. Insert evidence events
      for (const ev of params.evidenceEvents) {
        await tx.insert(evidenceEvents).values({
          id: ev.id,
          purchaseId: ev.purchaseId,
          seq: ev.seq,
          type: ev.type,
          actor: ev.actor,
          payload: ev.payload,
          prevHash: ev.prevHash,
          hash: ev.hash,
          signature: ev.signature,
          signerKeyId: ev.signerKeyId,
          createdAt: new Date(ev.createdAt),
        });
      }
    });
  }

  async recordSettlementFailureWithEvidence(
    actionId: string,
    patch: Partial<SettlementActionRecord>,
    failedEvent: EvidenceEvent,
  ): Promise<SettlementActionRecord> {
    return await this.db.transaction(async (tx: any) => {
      const { createdAt: _ca, updatedAt: _ua, ...cleanPatch } = patch;
      const rows = await tx
        .update(settlementActions)
        .set({
          ...cleanPatch,
          updatedAt: new Date(),
        })
        .where(eq(settlementActions.id, actionId))
        .returning();

      await tx.insert(evidenceEvents).values({
        id: failedEvent.id,
        purchaseId: failedEvent.purchaseId,
        seq: failedEvent.seq,
        type: failedEvent.type,
        actor: failedEvent.actor,
        payload: failedEvent.payload,
        prevHash: failedEvent.prevHash,
        hash: failedEvent.hash,
        signature: failedEvent.signature,
        signerKeyId: failedEvent.signerKeyId,
        createdAt: new Date(failedEvent.createdAt),
      });

      return rows[0] as unknown as SettlementActionRecord;
    });
  }
}
