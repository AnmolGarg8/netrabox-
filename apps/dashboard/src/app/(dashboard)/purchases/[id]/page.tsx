"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { fetchPurchaseDetail } from "../../../../lib/api";
import { formatMoney, formatDate, getStateBadgeColor } from "../../../../lib/format";
import type { MockPurchaseItem, MockEvidenceEventItem } from "../../../../lib/mock-data";
import { IntegrityBadge } from "../../../../components/IntegrityBadge";
import { MoneyFlowDiagram } from "../../../../components/MoneyFlowDiagram";
import { FlightRecorderTimeline } from "../../../../components/FlightRecorderTimeline";
import { ArrowLeft, Scale, RefreshCw, AlertTriangle } from "lucide-react";

export default function PurchaseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = (params?.id as string) || "pur_demo_01";

  const [purchase, setPurchase] = useState<MockPurchaseItem | null>(null);
  const [events, setEvents] = useState<MockEvidenceEventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [highlightedId, setHighlightedId] = useState<string | undefined>();
  const [openingDispute, setOpeningDispute] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await fetchPurchaseDetail(id);
      setPurchase(data.purchase);
      setEvents(data.events);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id]);

  const handleOpenDispute = async () => {
    setOpeningDispute(true);
    try {
      const res = await fetch("http://localhost:4000/api/v1/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchaseId: id,
          reason: "Item delivered was defective or failed specifications",
          claimantActor: "user",
          disputedAmountMinor: purchase?.amountMinor || 34999,
        }),
      });

      if (res.ok) {
        const body = await res.json();
        if (body.dispute?.id) {
          router.push(`/disputes/${body.dispute.id}`);
          return;
        }
      }
    } catch {
      // fallback
    }

    // Default simulated dispute redirect
    router.push(`/disputes/disp_demo_01`);
  };

  if (loading || !purchase) {
    return (
      <div className="py-20 text-center space-y-4">
        <RefreshCw className="w-8 h-8 animate-spin text-indigo-400 mx-auto" />
        <p className="text-slate-400 text-sm">Loading Flight Ledger...</p>
      </div>
    );
  }

  const badge = getStateBadgeColor(purchase.state);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Back Navigation Bar */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to Purchases
        </Link>

        <div className="flex items-center gap-3">
          {purchase.disputeId ? (
            <Link
              href={`/disputes/${purchase.disputeId}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-lg shadow-purple-600/25 transition"
            >
              <Scale className="w-3.5 h-3.5" />
              View Tribunal Courtroom
            </Link>
          ) : (
            <button
              onClick={handleOpenDispute}
              disabled={openingDispute}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-bold border border-amber-500/30 transition shadow-sm"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              Open Formal Dispute
            </button>
          )}
        </div>
      </div>

      {/* Main Title Header */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="font-mono text-xs text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                {purchase.id}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                {purchase.state}
              </span>
            </div>

            <h1 className="text-2xl font-bold text-white tracking-tight">{purchase.title}</h1>
            <p className="text-xs text-slate-400 mt-1">
              Shopper: <span className="text-slate-300 font-mono">{purchase.buyerId}</span> • Agent:{" "}
              <span className="text-slate-300 font-mono">{purchase.agentId}</span> • Merchant:{" "}
              <span className="text-slate-300 font-mono">{purchase.merchantId}</span>
            </p>
          </div>

          <div className="text-left md:text-right shrink-0">
            <span className="text-[11px] text-slate-500 block">Total Order</span>
            <span className="text-2xl font-extrabold text-white font-mono">
              {formatMoney(purchase.amountMinor, purchase.currency)}
            </span>
            <span className="text-[10px] text-slate-500 block mt-0.5 font-mono">
              Created {formatDate(purchase.createdAt)}
            </span>
          </div>
        </div>
      </div>

      {/* Cryptographic Integrity Badge with Tamper Button */}
      <IntegrityBadge
        purchaseId={purchase.id}
        initialValid={!purchase.isTampered}
        totalEvents={events.length}
      />

      {/* PayPal Orders v2 Settlement Flow */}
      <MoneyFlowDiagram
        amountMinor={purchase.amountMinor}
        capturedAmountMinor={purchase.capturedAmountMinor}
        refundedAmountMinor={purchase.refundedAmountMinor}
        currency={purchase.currency}
        state={purchase.state}
        paypalOrderId={purchase.paypalOrderId}
        paypalAuthorizationId={purchase.paypalAuthorizationId}
        paypalCaptureId={purchase.paypalCaptureId}
        paypalRefundId={purchase.paypalRefundId}
      />

      {/* Flight Recorder Timeline */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <FlightRecorderTimeline
          events={events}
          highlightedEventId={highlightedId}
          onSelectEventId={(id) => setHighlightedId(id)}
        />
      </div>
    </div>
  );
}
