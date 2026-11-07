import type { EvidenceEvent, SettlementActionRecord, PurchaseState } from "@netrabox/core";
import type { IStateStore } from "./machine.js";
import type { PurchaseRecord } from "./types.js";

export class InMemoryStateStore implements IStateStore {
  public purchases: Map<string, PurchaseRecord> = new Map();
  public events: Map<string, EvidenceEvent[]> = new Map();
  public settlementActions: Map<string, SettlementActionRecord> = new Map();

  async getPurchase(purchaseId: string): Promise<PurchaseRecord | null> {
    const item = this.purchases.get(purchaseId);
    return item ? { ...item } : null;
  }

  async getLastEvidenceEvent(purchaseId: string): Promise<EvidenceEvent | null> {
    const list = this.events.get(purchaseId);
    if (!list || list.length === 0) return null;
    return { ...list[list.length - 1] };
  }

  async getEvidenceEvents(purchaseId: string): Promise<EvidenceEvent[]> {
    const list = this.events.get(purchaseId);
    if (!list) return [];
    return list.map((e) => ({ ...e }));
  }

  async tamperEvidenceEvent(
    purchaseId: string,
    targetSeq: number,
    tamperedPayload: Record<string, unknown>,
  ): Promise<boolean> {
    const list = this.events.get(purchaseId);
    if (!list) return false;
    const target = list.find((e) => e.seq === targetSeq);
    if (!target) return false;
    target.payload = { ...tamperedPayload };
    return true;
  }

  async applyAtomicTransition(
    purchaseId: string,
    _nextState: PurchaseRecord["state"],
    patch: Partial<PurchaseRecord>,
    event: EvidenceEvent,
  ): Promise<PurchaseRecord> {
    const current = this.purchases.get(purchaseId);
    if (!current) {
      throw new Error(`Purchase ${purchaseId} not found in in-memory store`);
    }

    const updated: PurchaseRecord = {
      ...current,
      ...patch,
      updatedAt: new Date(),
    };

    // Atomic update simulation
    this.purchases.set(purchaseId, updated);

    const list = this.events.get(purchaseId) || [];
    list.push(event);
    this.events.set(purchaseId, list);

    return { ...updated };
  }

  async getSettlementAction(id: string): Promise<SettlementActionRecord | null> {
    const action = this.settlementActions.get(id);
    return action ? { ...action } : null;
  }

  async getSettlementActionByIdempotencyKey(key: string): Promise<SettlementActionRecord | null> {
    for (const action of this.settlementActions.values()) {
      if (action.idempotencyKey === key) {
        return { ...action };
      }
    }
    return null;
  }

  async createSettlementAction(action: SettlementActionRecord): Promise<SettlementActionRecord> {
    this.settlementActions.set(action.id, { ...action });
    return { ...action };
  }

  async updateSettlementAction(
    id: string,
    patch: Partial<SettlementActionRecord>,
  ): Promise<SettlementActionRecord> {
    const current = this.settlementActions.get(id);
    if (!current) {
      throw new Error(`Settlement action ${id} not found in in-memory store`);
    }
    const updated: SettlementActionRecord = {
      ...current,
      ...patch,
      updatedAt: new Date(),
    };
    this.settlementActions.set(id, updated);
    return { ...updated };
  }

  async getUnreconciledSettlementActions(olderThanMs = 30000): Promise<SettlementActionRecord[]> {
    const now = Date.now();
    const result: SettlementActionRecord[] = [];
    for (const action of this.settlementActions.values()) {
      if (action.status === "PENDING" || action.status === "NEEDS_RECONCILE") {
        const createdMs = new Date(action.createdAt).getTime();
        if (now - createdMs >= olderThanMs) {
          result.push({ ...action });
        }
      }
    }
    return result;
  }

  async recordSettlementPendingWithEvidence(params: {
    action: SettlementActionRecord;
    evidenceEvent: EvidenceEvent;
  }): Promise<{ existing: boolean; action: SettlementActionRecord }> {
    const existing = await this.getSettlementActionByIdempotencyKey(params.action.idempotencyKey);
    if (existing) {
      return { existing: true, action: existing };
    }

    // Atomic insert of pending row and SETTLEMENT_REQUESTED evidence
    this.settlementActions.set(params.action.id, { ...params.action });
    const list = this.events.get(params.action.purchaseId) || [];
    list.push(params.evidenceEvent);
    this.events.set(params.action.purchaseId, list);

    return { existing: false, action: { ...params.action } };
  }

  async applyAtomicSettlementSuccess(params: {
    actionId: string;
    purchaseId: string;
    nextState: PurchaseState;
    patch: Partial<PurchaseRecord>;
    evidenceEvents: EvidenceEvent[];
    actionPatch: Partial<SettlementActionRecord>;
  }): Promise<void> {
    // 1. Update settlement action to SUCCEEDED
    const action = this.settlementActions.get(params.actionId);
    if (action) {
      this.settlementActions.set(params.actionId, {
        ...action,
        ...params.actionPatch,
        status: "SUCCEEDED",
        updatedAt: new Date(),
      });
    }

    // 2. Update purchase record
    const purchase = this.purchases.get(params.purchaseId);
    if (purchase) {
      this.purchases.set(params.purchaseId, {
        ...purchase,
        ...params.patch,
        state: params.nextState,
        updatedAt: new Date(),
      });
    }

    // 3. Append evidence events
    const list = this.events.get(params.purchaseId) || [];
    for (const ev of params.evidenceEvents) {
      list.push(ev);
    }
    this.events.set(params.purchaseId, list);
  }

  async recordSettlementFailureWithEvidence(
    actionId: string,
    patch: Partial<SettlementActionRecord>,
    failedEvent: EvidenceEvent,
  ): Promise<SettlementActionRecord> {
    const updated = await this.updateSettlementAction(actionId, patch);
    const list = this.events.get(failedEvent.purchaseId) || [];
    list.push(failedEvent);
    this.events.set(failedEvent.purchaseId, list);
    return updated;
  }
}
