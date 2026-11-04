import { eq, desc, asc, and } from "drizzle-orm";
import { type EvidenceEvent } from "@netrabox/core";
import { purchases, evidenceEvents } from "@netrabox/core/schemas";
import { db } from "@netrabox/core/db";
import type { IStateStore } from "./machine.js";
import type { PurchaseRecord } from "./types.js";

export class DrizzleStateStore implements IStateStore {
  async getPurchase(purchaseId: string): Promise<PurchaseRecord | null> {
    const rows = await db.select().from(purchases).where(eq(purchases.id, purchaseId)).limit(1);
    if (!rows || rows.length === 0) return null;
    return rows[0] as unknown as PurchaseRecord;
  }

  async getLastEvidenceEvent(purchaseId: string): Promise<EvidenceEvent | null> {
    const rows = await db
      .select()
      .from(evidenceEvents)
      .where(eq(evidenceEvents.purchaseId, purchaseId))
      .orderBy(desc(evidenceEvents.seq))
      .limit(1);

    if (!rows || rows.length === 0) return null;
    return rows[0] as unknown as EvidenceEvent;
  }

  async getEvidenceEvents(purchaseId: string): Promise<EvidenceEvent[]> {
    const rows = await db
      .select()
      .from(evidenceEvents)
      .where(eq(evidenceEvents.purchaseId, purchaseId))
      .orderBy(asc(evidenceEvents.seq));

    return rows as unknown as EvidenceEvent[];
  }

  async tamperEvidenceEvent(
    purchaseId: string,
    targetSeq: number,
    tamperedPayload: Record<string, unknown>,
  ): Promise<boolean> {
    const updated = await db
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
    return await db.transaction(async (tx) => {
      // 1. Insert evidence event in the transaction
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

      // 2. Update purchase record with next state and fields
      const updatedRows = await tx
        .update(purchases)
        .set({
          ...patch,
          updatedAt: new Date(),
        })
        .where(eq(purchases.id, purchaseId))
        .returning();

      return updatedRows[0] as unknown as PurchaseRecord;
    });
  }
}
