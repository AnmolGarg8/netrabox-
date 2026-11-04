import type { EvidenceEvent } from "@netrabox/core";
import type { IStateStore } from "./machine.js";
import type { PurchaseRecord } from "./types.js";

export class InMemoryStateStore implements IStateStore {
  public purchases: Map<string, PurchaseRecord> = new Map();
  public events: Map<string, EvidenceEvent[]> = new Map();

  async getPurchase(purchaseId: string): Promise<PurchaseRecord | null> {
    const item = this.purchases.get(purchaseId);
    return item ? { ...item } : null;
  }

  async getLastEvidenceEvent(purchaseId: string): Promise<EvidenceEvent | null> {
    const list = this.events.get(purchaseId);
    if (!list || list.length === 0) return null;
    return { ...list[list.length - 1] };
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
}
