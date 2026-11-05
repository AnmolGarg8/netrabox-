import {
  SEEDED_PURCHASES,
  SEEDED_EVIDENCE_EVENTS,
  SEEDED_DISPUTES,
  type MockPurchaseItem,
  type MockEvidenceEventItem,
  type MockDisputeItem,
} from "./mock-data";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";

export async function fetchPurchases(): Promise<MockPurchaseItem[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/purchases`, { cache: "no-store" });
    if (!res.ok) throw new Error("API responded with error");
    const data = (await res.json()) as { purchases: MockPurchaseItem[] };
    if (data.purchases && data.purchases.length > 0) {
      return data.purchases;
    }
  } catch {
    // fallback to seeded purchases
  }
  return SEEDED_PURCHASES;
}

export async function fetchPurchaseDetail(
  id: string,
): Promise<{ purchase: MockPurchaseItem; events: MockEvidenceEventItem[] }> {
  let purchase: MockPurchaseItem | undefined;
  let events: MockEvidenceEventItem[] = [];

  try {
    const pRes = await fetch(`${API_BASE_URL}/purchases/${id}`, { cache: "no-store" });
    if (pRes.ok) {
      const data = (await pRes.json()) as { purchase: MockPurchaseItem };
      purchase = data.purchase;
    }

    const eRes = await fetch(`${API_BASE_URL}/purchases/${id}/evidence`, { cache: "no-store" });
    if (eRes.ok) {
      const data = (await eRes.json()) as { events: MockEvidenceEventItem[] };
      events = data.events;
    }
  } catch {
    // fallback
  }

  if (!purchase) {
    purchase = SEEDED_PURCHASES.find((p) => p.id === id) || {
      id,
      title: `Purchase #${id}`,
      buyerId: "u_shopper",
      agentId: "agent_shopper",
      merchantId: "m_store",
      state: "CAPTURED",
      currency: "USD",
      amountMinor: 34999,
      capturedAmountMinor: 34999,
      refundedAmountMinor: 0,
      createdAt: new Date().toISOString(),
    };
  }

  if (events.length === 0) {
    events = SEEDED_EVIDENCE_EVENTS[id] || SEEDED_EVIDENCE_EVENTS["pur_demo_01"] || [];
  }

  return { purchase, events };
}

export async function verifyEvidenceChain(
  purchaseId: string,
): Promise<{ valid: boolean; totalEvents: number; brokenSeq?: number; reason?: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/purchases/${purchaseId}/evidence/verify`, {
      cache: "no-store",
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // fallback
  }

  // Check if simulated tampered state
  const purchase = SEEDED_PURCHASES.find((p) => p.id === purchaseId);
  if (purchase?.isTampered) {
    return {
      valid: false,
      totalEvents: 9,
      brokenSeq: 5,
      reason: "Hash mismatch at seq #5: recomputed hash does not match stored block digest",
    };
  }

  return {
    valid: true,
    totalEvents: 9,
  };
}

export async function triggerDemoTamper(purchaseId: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/demo/tamper`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        purchaseId,
        targetSeq: 5,
        tamperedPayload: {
          trackingNumber: "TRK_TAMPERED_BY_ATTACKER_999",
          status: "TAMPERED_IN_DATABASE_WITHOUT_RE_SIGNING",
        },
      }),
    });
    if (res.ok) return true;
  } catch {
    // fallback
  }

  const p = SEEDED_PURCHASES.find((item) => item.id === purchaseId);
  if (p) p.isTampered = true;
  return true;
}

export async function restoreDemoTamper(purchaseId: string): Promise<boolean> {
  const p = SEEDED_PURCHASES.find((item) => item.id === purchaseId);
  if (p) p.isTampered = false;
  return true;
}

export async function fetchDisputeDetail(id: string): Promise<MockDisputeItem | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/disputes/${id}`, { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { dispute: MockDisputeItem };
      return data.dispute;
    }
  } catch {
    // fallback
  }

  return SEEDED_DISPUTES[id] || SEEDED_DISPUTES["disp_demo_01"] || null;
}
