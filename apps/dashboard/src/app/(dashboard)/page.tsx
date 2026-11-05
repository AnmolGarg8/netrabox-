"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchPurchases } from "../../lib/api";
import { formatMoney, formatDate, getStateBadgeColor } from "../../lib/format";
import type { MockPurchaseItem } from "../../lib/mock-data";
import {
  Scale,
  ShoppingBag,
  ArrowRight,
  RefreshCw,
  Search,
  CheckCircle2,
} from "lucide-react";

export default function PurchasesListPage() {
  const [purchases, setPurchases] = useState<MockPurchaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await fetchPurchases();
      setPurchases(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000); // 5s live polling
    return () => clearInterval(interval);
  }, []);

  const filteredPurchases = purchases.filter((p) => {
    const matchesFilter =
      filterState === "ALL" ||
      (filterState === "DISPUTED" && (p.state === "DISPUTED" || p.state === "IN_TRIBUNAL")) ||
      (filterState === "RESOLVED" && p.state.startsWith("RESOLVED")) ||
      (filterState === "ACTIVE" && (p.state === "AUTHORIZED" || p.state === "CAPTURED"));

    const matchesSearch =
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.buyerId.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesFilter && matchesSearch;
  });

  return (
    <div className="space-y-8">
      {/* Hero Banner */}
      <section className="bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/40 border border-slate-800 rounded-2xl p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 h-64 w-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-3xl space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-indigo-400 tracking-wider uppercase bg-indigo-500/10 px-2.5 py-1 rounded-md border border-indigo-500/20">
              Autonomous Commerce Infrastructure
            </span>
            <span className="text-xs text-slate-500 font-mono">• Ed25519 Flight Ledger</span>
          </div>

          <h1 className="text-3xl font-extrabold text-white tracking-tight sm:text-4xl">
            AI-Agent Purchase Flight Recorder &amp; Dispute Tribunal
          </h1>

          <p className="text-sm text-slate-400 leading-relaxed">
            Every autonomous agent decision is mathematically signed with Ed25519 into an immutable
            SHA-256 hash chain. If a transaction fails, autonomous advocates debate the evidence, an
            AI judge classifies liability, and a deterministic policy engine settles funds directly
            on PayPal sandbox rails.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8 pt-6 border-t border-slate-800/80">
          <div>
            <span className="text-[11px] text-slate-500 block font-medium">Ledger Integrity</span>
            <span className="text-lg font-bold text-emerald-400 flex items-center gap-1.5 mt-0.5">
              <CheckCircle2 className="w-4 h-4" /> 100% Cryptographic
            </span>
          </div>

          <div>
            <span className="text-[11px] text-slate-500 block font-medium">Payment Protocol</span>
            <span className="text-lg font-bold text-white mt-0.5 block">
              PayPal Orders v2
            </span>
          </div>

          <div>
            <span className="text-[11px] text-slate-500 block font-medium">Settlement Intent</span>
            <span className="text-lg font-bold text-indigo-400 font-mono mt-0.5 block">
              AUTHORIZE
            </span>
          </div>

          <div>
            <span className="text-[11px] text-slate-500 block font-medium">Dispute Mode</span>
            <span className="text-lg font-bold text-purple-400 mt-0.5 block">
              Autonomous Tribunal
            </span>
          </div>
        </div>
      </section>

      {/* Purchases Header & Filter Controls */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">Active &amp; Recorded Purchases</h2>
            <p className="text-xs text-slate-400">
              Live ledger tracking of AI agent purchasing sessions ({filteredPurchases.length} total)
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-800 transition shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-indigo-400" : ""}`} />
              Refresh
            </button>

            <Link
              href="/shop"
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/25 transition"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              Launch Demo Purchase
            </Link>
          </div>
        </div>

        {/* Filters and Search Bar */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-3 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
          <div className="flex items-center gap-1 w-full md:w-auto overflow-x-auto">
            {["ALL", "ACTIVE", "DISPUTED", "RESOLVED"].map((tab) => (
              <button
                key={tab}
                onClick={() => setFilterState(tab)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                  filterState === tab
                    ? "bg-slate-800 text-white shadow-sm border border-slate-700"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="relative w-full md:w-64">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search purchases..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
            />
          </div>
        </div>
      </div>

      {/* Purchases Table / Cards */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 uppercase font-semibold text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="px-6 py-3.5">Purchase Item</th>
                <th className="px-4 py-3.5">State</th>
                <th className="px-4 py-3.5">Amount</th>
                <th className="px-4 py-3.5">Settlement (Captured / Refunded)</th>
                <th className="px-4 py-3.5">Created</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredPurchases.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                    No purchases found matching filter.
                  </td>
                </tr>
              ) : (
                filteredPurchases.map((purchase) => {
                  const badge = getStateBadgeColor(purchase.state);

                  return (
                    <tr
                      key={purchase.id}
                      className="hover:bg-slate-800/40 transition-colors group"
                    >
                      <td className="px-6 py-4">
                        <Link
                          href={`/purchases/${purchase.id}`}
                          className="font-bold text-white group-hover:text-indigo-400 transition block leading-tight text-sm"
                        >
                          {purchase.title}
                        </Link>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="font-mono text-[10px] text-slate-500">
                            {purchase.id}
                          </span>
                          <span className="text-slate-600">•</span>
                          <span className="text-[11px] text-slate-400 font-mono">
                            {purchase.buyerId}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                          {purchase.state}
                        </span>
                      </td>

                      <td className="px-4 py-4 whitespace-nowrap">
                        <span className="font-bold text-white font-mono text-sm">
                          {formatMoney(purchase.amountMinor, purchase.currency)}
                        </span>
                      </td>

                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="space-y-0.5 font-mono text-[11px]">
                          <div className="text-emerald-400 font-medium">
                            Cap: {formatMoney(purchase.capturedAmountMinor, purchase.currency)}
                          </div>
                          {purchase.refundedAmountMinor > 0 && (
                            <div className="text-purple-400 font-medium">
                              Ref: {formatMoney(purchase.refundedAmountMinor, purchase.currency)}
                            </div>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-4 whitespace-nowrap text-slate-400 font-mono text-[11px]">
                        {formatDate(purchase.createdAt)}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-2">
                          {purchase.disputeId && (
                            <Link
                              href={`/disputes/${purchase.disputeId}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 font-semibold text-[11px] border border-purple-500/20 transition"
                            >
                              <Scale className="w-3 h-3" />
                              Tribunal
                            </Link>
                          )}

                          <Link
                            href={`/purchases/${purchase.id}`}
                            className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-[11px] transition"
                          >
                            Timeline
                            <ArrowRight className="w-3 h-3 text-slate-400" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
