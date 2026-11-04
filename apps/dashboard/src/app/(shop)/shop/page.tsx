"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Truck,
  AlertTriangle,
} from "lucide-react";
import { HONEST_MERCHANT, MALICIOUS_MERCHANT, type DeliveryBehavior } from "@netrabox/core";

export default function DemoShopPage() {
  const [selectedScenarioBehavior, setSelectedScenarioBehavior] =
    useState<DeliveryBehavior>("wrong_size");
  const [activePurchaseId, setActivePurchaseId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const startAgentPurchase = async (productSku: string, merchantId: string) => {
    setStatusMessage("🤖 Buyer Agent initialized. Evaluating constraints and offers...");
    try {
      // 1. Initialize purchase on API
      const res = await fetch("http://localhost:4000/api/v1/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyerId: "demo_buyer_1",
          agentId: "agent_gemini_shopper",
          merchantId,
          title: `Purchase SKU: ${productSku}`,
          amountMinor: 34999,
          currency: "USD",
          metadata: {
            scenarioBehavior:
              merchantId === MALICIOUS_MERCHANT.id ? selectedScenarioBehavior : "on_time",
          },
        }),
      });

      if (!res.ok) throw new Error("Failed to initialize purchase");
      const purchase = (await res.json()) as { id: string };
      setActivePurchaseId(purchase.id);
      setStatusMessage(`✅ Flight recorder active for Purchase ID: ${purchase.id}`);
    } catch {
      setStatusMessage("⚠️ NetraBox API not running on port 4000 (Local simulation active).");
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
          <span className="text-slate-600">|</span>
          <span className="font-bold text-white tracking-tight">
            NetraBox Demo Commerce Sandbox
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-indigo-400 bg-indigo-500/10 px-2.5 py-1 rounded-full border border-indigo-500/20 font-mono">
            Autonomous Commerce Simulator
          </span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-8 space-y-8">
        {statusMessage && (
          <div className="p-4 rounded-xl bg-indigo-950/40 border border-indigo-500/30 text-indigo-200 text-sm flex items-center justify-between">
            <span>{statusMessage}</span>
            {activePurchaseId && (
              <Link
                href={`/purchases/${activePurchaseId}`}
                className="underline font-semibold hover:text-white ml-4"
              >
                View Flight Recorder &rarr;
              </Link>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* MERCHANT 1: HONEST */}
          <section className="bg-slate-900/80 border border-emerald-500/30 rounded-2xl p-6 shadow-xl space-y-6">
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  <h2 className="text-xl font-bold text-white">{HONEST_MERCHANT.name}</h2>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Verified Authorized Merchant • Rating: {HONEST_MERCHANT.rating} / 5.0 ★
                </p>
              </div>
              <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/30 font-medium">
                Honest Seller
              </span>
            </div>

            <div className="space-y-4">
              {HONEST_MERCHANT.products.map((product) => (
                <div
                  key={product.id}
                  className="bg-slate-950/70 border border-slate-800 rounded-xl p-5 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs font-mono text-emerald-400 uppercase">
                        {product.brand} • {product.category}
                      </span>
                      <span className="text-lg font-bold text-white">
                        ${(product.priceMinor / 100).toFixed(2)}
                      </span>
                    </div>
                    <h3 className="font-semibold text-white mb-1">{product.name}</h3>
                    <p className="text-xs text-slate-400 leading-relaxed mb-4">
                      {product.description}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => startAgentPurchase(product.sku, HONEST_MERCHANT.id)}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition"
                  >
                    <ShoppingCart className="w-3.5 h-3.5" />
                    Agent Buy (Honest Flow)
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* MERCHANT 2: MALICIOUS */}
          <section className="bg-slate-900/80 border border-amber-500/30 rounded-2xl p-6 shadow-xl space-y-6">
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-amber-400" />
                  <h2 className="text-xl font-bold text-white">{MALICIOUS_MERCHANT.name}</h2>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Unverified 3rd-Party Seller • Rating: {MALICIOUS_MERCHANT.rating} / 5.0 ★
                </p>
              </div>
              <span className="text-xs text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/30 font-medium flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Prompt Injection Threat
              </span>
            </div>

            {/* Configurable Delivery Behavior for Scenarios */}
            <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Truck className="w-4 h-4 text-indigo-400" />
                Scenario Delivery Behavior:
              </span>
              <select
                value={selectedScenarioBehavior}
                onChange={(e) => setSelectedScenarioBehavior(e.target.value as DeliveryBehavior)}
                className="bg-slate-900 border border-slate-700 text-slate-200 rounded px-2 py-1 focus:outline-none focus:border-indigo-500"
              >
                <option value="wrong_size">Wrong Size / Item Delivered</option>
                <option value="partial_delivery">Partial Fulfillment Only</option>
                <option value="never_delivered">Never Delivered (Lost in Transit)</option>
                <option value="on_time">On-time (Normal)</option>
              </select>
            </div>

            <div className="space-y-4">
              {MALICIOUS_MERCHANT.products.map((product) => (
                <div
                  key={product.id}
                  className="bg-slate-950/70 border border-slate-800 rounded-xl p-5 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs font-mono text-amber-400 uppercase">
                        {product.brand} • {product.category}
                      </span>
                      <span className="text-lg font-bold text-white">
                        ${(product.priceMinor / 100).toFixed(2)}
                      </span>
                    </div>
                    <h3 className="font-semibold text-white mb-1">{product.name}</h3>

                    {/* Highlighted prompt injection text */}
                    <div className="my-2 p-2.5 rounded bg-red-950/30 border border-red-500/30 text-xs text-red-300 font-mono leading-relaxed">
                      <span className="font-bold text-red-400 uppercase block text-[10px]">
                        ⚠️ Prompt Injection Payload in Catalog:
                      </span>
                      {product.description}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => startAgentPurchase(product.sku, MALICIOUS_MERCHANT.id)}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold transition mt-3"
                  >
                    <ShoppingCart className="w-3.5 h-3.5" />
                    Agent Buy (Test Intent Guard)
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
