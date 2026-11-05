"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Truck,
  AlertTriangle,
  Play,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Scale,
  Sparkles,
} from "lucide-react";
import { Navigation } from "@/components/Navigation";
import { HONEST_MERCHANT, MALICIOUS_MERCHANT, type DeliveryBehavior } from "@netrabox/core";

interface ScenarioStep {
  seq: number;
  label: string;
  detail: string;
  status: "pending" | "running" | "done" | "failed";
}

interface DemoScenario {
  id: string;
  title: string;
  description: string;
  merchant: typeof HONEST_MERCHANT | typeof MALICIOUS_MERCHANT;
  productSku: string;
  deliveryBehavior: DeliveryBehavior;
  badge: string;
  badgeColor: string;
  expectedOutcome: string;
}

const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "honest-purchase",
    title: "1. Honest Commerce Flow",
    description:
      "Buyer agent orders Sony WH-1000XM5. Intent Guard verifies brand & budget. PayPal order authorized and captured on delivery.",
    merchant: HONEST_MERCHANT,
    productSku: "SONY-WH1000XM5",
    deliveryBehavior: "on_time",
    badge: "Happy Path",
    badgeColor: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    expectedOutcome: "State: CAPTURED • Intent Guard PASS • 0 disputes",
  },
  {
    id: "wrongsize-delivered",
    title: "2. Sloppy Merchant (Wrong Size)",
    description:
      "Merchant ships wrong size. Buyer initiates autonomous dispute. Tribunal classifies MERCHANT_FAULT and executes 100% refund.",
    merchant: MALICIOUS_MERCHANT,
    productSku: "ROGUE-TECH-02",
    deliveryBehavior: "wrong_size",
    badge: "Dispute & Refund",
    badgeColor: "text-amber-400 bg-amber-500/10 border-amber-500/30",
    expectedOutcome: "Tribunal: 100% Refund • Void/Refund executed via PayPal",
  },
  {
    id: "injection-attempt",
    title: "3. Adversarial Prompt Injection",
    description:
      "Malicious merchant listing injects instructions to override budget limit. Intent Guard catches deviation and blocks order.",
    merchant: MALICIOUS_MERCHANT,
    productSku: "ROGUE-TECH-01",
    deliveryBehavior: "never_delivered",
    badge: "Security Defense",
    badgeColor: "text-red-400 bg-red-500/10 border-red-500/30",
    expectedOutcome: "Intent Guard: BLOCK • PayPal order aborted • Zero money lost",
  },
  {
    id: "false-claim",
    title: "4. False Buyer Dispute (Fraud Defense)",
    description:
      "Buyer agent claims item never arrived, but signed delivery telemetry proves confirmed delivery. Tribunal denies refund.",
    merchant: HONEST_MERCHANT,
    productSku: "SONY-WH1000XM5",
    deliveryBehavior: "on_time",
    badge: "Merchant Protection",
    badgeColor: "text-indigo-400 bg-indigo-500/10 border-indigo-500/30",
    expectedOutcome: "Tribunal: BUYER_FAULT • Split: 0% refund • Funds preserved",
  },
];

export default function DemoShopPage() {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("wrongsize-delivered");
  const [selectedBehavior, setSelectedBehavior] = useState<DeliveryBehavior>("wrong_size");
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [activePurchaseId, setActivePurchaseId] = useState<string | null>(null);
  const [activeDisputeId, setActiveDisputeId] = useState<string | null>(null);
  const [showPaypalModal, setShowPaypalModal] = useState<boolean>(false);
  const [steps, setSteps] = useState<ScenarioStep[]>([]);

  const selectedScenario =
    DEMO_SCENARIOS.find((s) => s.id === selectedScenarioId) || DEMO_SCENARIOS[0];

  const runScenario = async (scenario: DemoScenario) => {
    setIsRunning(true);
    setActiveDisputeId(null);
    setActivePurchaseId(null);

    const initialSteps: ScenarioStep[] = [
      {
        seq: 1,
        label: "Buyer Agent Intent & Constraints",
        detail: "Extracting user constraints: brand, budget, and condition.",
        status: "running",
      },
      {
        seq: 2,
        label: "Catalog Inspection & Intent Guard",
        detail: "Scanning merchant listings and checking for prompt injection.",
        status: "pending",
      },
      {
        seq: 3,
        label: "PayPal Orders v2 Authorization",
        detail: "Issuing intent=AUTHORIZE with idempotency key.",
        status: "pending",
      },
      {
        seq: 4,
        label: "Fulfillment & Delivery Telemetry",
        detail: `Simulating shipment with behavior: ${scenario.deliveryBehavior}.`,
        status: "pending",
      },
      {
        seq: 5,
        label: "Dispute Tribunal or Final Settlement",
        detail: "Resolving transaction status or evaluating evidence in court.",
        status: "pending",
      },
    ];

    setSteps(initialSteps);

    // Step 1: Agent Intent
    await new Promise((r) => setTimeout(r, 600));
    setSteps((prev) =>
      prev.map((s, idx) =>
        idx === 0 ? { ...s, status: "done" } : idx === 1 ? { ...s, status: "running" } : s,
      ),
    );

    // Step 2: Intent Guard
    await new Promise((r) => setTimeout(r, 700));
    if (scenario.id === "injection-attempt") {
      setSteps((prev) =>
        prev.map((s, idx) =>
          idx === 1
            ? {
                ...s,
                status: "failed",
                detail:
                  "BLOCKED: Prompt injection detected! Catalog payload violated user budget constraints.",
              }
            : s,
        ),
      );
      setIsRunning(false);
      setActivePurchaseId("pur_demo_03");
      return;
    }

    setSteps((prev) =>
      prev.map((s, idx) =>
        idx === 1 ? { ...s, status: "done" } : idx === 2 ? { ...s, status: "running" } : s,
      ),
    );

    // Step 3: PayPal Authorization Simulation
    await new Promise((r) => setTimeout(r, 600));
    setShowPaypalModal(true);
  };

  const completePaypalApproval = async () => {
    setShowPaypalModal(false);

    // Mark Step 3 done
    setSteps((prev) =>
      prev.map((s, idx) =>
        idx === 2 ? { ...s, status: "done" } : idx === 3 ? { ...s, status: "running" } : s,
      ),
    );

    // Step 4: Fulfillment
    await new Promise((r) => setTimeout(r, 800));
    setSteps((prev) =>
      prev.map((s, idx) =>
        idx === 3 ? { ...s, status: "done" } : idx === 4 ? { ...s, status: "running" } : s,
      ),
    );

    // Step 5: Resolution
    await new Promise((r) => setTimeout(r, 900));

    if (selectedScenarioId === "honest-purchase") {
      setSteps((prev) =>
        prev.map((s, idx) =>
          idx === 4
            ? {
                ...s,
                status: "done",
                detail:
                  "Order confirmed delivered on-time. PayPal capture executed. Status: CAPTURED.",
              }
            : s,
        ),
      );
      setActivePurchaseId("pur_demo_01");
    } else if (selectedScenarioId === "wrongsize-delivered") {
      setSteps((prev) =>
        prev.map((s, idx) =>
          idx === 4
            ? {
                ...s,
                status: "done",
                detail:
                  "Wrong item delivered. Autonomous dispute opened. Tribunal awarded 100% refund.",
              }
            : s,
        ),
      );
      setActivePurchaseId("pur_demo_02");
      setActiveDisputeId("disp_demo_02");
    } else if (selectedScenarioId === "false-claim") {
      setSteps((prev) =>
        prev.map((s, idx) =>
          idx === 4
            ? {
                ...s,
                status: "done",
                detail:
                  "Buyer claim rejected: valid cryptographic delivery signature found. Merchant protected.",
              }
            : s,
        ),
      );
      setActivePurchaseId("pur_demo_01");
      setActiveDisputeId("disp_demo_01");
    }

    setIsRunning(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Navigation />

      {/* SUB-HEADER */}
      <div className="border-b border-slate-800 bg-slate-900/40 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-400" />
              Autonomous Commerce & Tribunal Simulator
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Run simulated end-to-end agent purchases, adversarial attacks, and PayPal dispute
              executions.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono">
              PayPal Orders v2 AUTHORIZE
            </span>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto w-full p-6 md:p-8 space-y-8 flex-1">
        {/* SCENARIO PICKER CARDS */}
        <div>
          <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3">
            Step 1: Select Demo Scenario
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {DEMO_SCENARIOS.map((sc) => {
              const isSelected = selectedScenarioId === sc.id;
              return (
                <div
                  key={sc.id}
                  onClick={() => {
                    setSelectedScenarioId(sc.id);
                    setSelectedBehavior(sc.deliveryBehavior);
                    setSteps([]);
                    setActivePurchaseId(null);
                    setActiveDisputeId(null);
                  }}
                  className={`cursor-pointer rounded-2xl p-5 border transition-all flex flex-col justify-between ${
                    isSelected
                      ? "bg-slate-900 border-indigo-500 shadow-xl shadow-indigo-950/40 scale-[1.02]"
                      : "bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900"
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${sc.badgeColor}`}
                      >
                        {sc.badge}
                      </span>
                    </div>
                    <h3 className="font-bold text-sm text-white">{sc.title}</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">{sc.description}</p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] font-mono text-indigo-300">
                    {sc.expectedOutcome}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* EXECUTION STAGE */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* LEFT: SCENARIO LAUNCHER & MERCHANT CATALOG (5 cols) */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
              <div className="flex items-start justify-between border-b border-slate-800 pb-4">
                <div>
                  <h3 className="font-bold text-white text-base">{selectedScenario.title}</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Merchant: {selectedScenario.merchant.name} (ID: {selectedScenario.merchant.id})
                  </p>
                </div>
                <span className="text-xs font-mono px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  SKU: {selectedScenario.productSku}
                </span>
              </div>

              {/* Malicious Listing Warning if selected */}
              {selectedScenario.merchant.id === MALICIOUS_MERCHANT.id && (
                <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-amber-400">
                    <AlertTriangle className="w-4 h-4" /> Adversarial Listing Active
                  </div>
                  <p className="text-amber-300/80">
                    Catalog text contains hidden prompt injection instructions aimed at overriding
                    buyer budget.
                  </p>
                </div>
              )}

              {/* Behavior override selector */}
              <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 flex items-center justify-between text-xs">
                <span className="text-slate-400 flex items-center gap-1.5 font-mono">
                  <Truck className="w-4 h-4 text-indigo-400" />
                  Delivery Behavior:
                </span>
                <select
                  value={selectedBehavior}
                  onChange={(e) => setSelectedBehavior(e.target.value as DeliveryBehavior)}
                  disabled={isRunning}
                  className="bg-slate-900 border border-slate-700 text-slate-200 rounded px-2.5 py-1 text-xs focus:outline-none focus:border-indigo-500 font-mono"
                >
                  <option value="on_time">on_time (Legitimate)</option>
                  <option value="wrong_size">wrong_size (Disputable)</option>
                  <option value="partial_delivery">partial_delivery (Split Liability)</option>
                  <option value="never_delivered">never_delivered (Full Refund)</option>
                </select>
              </div>

              {/* Trigger button */}
              <button
                onClick={() =>
                  runScenario({ ...selectedScenario, deliveryBehavior: selectedBehavior })
                }
                disabled={isRunning}
                className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 transition"
              >
                {isRunning ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Agent Executing Flight Sequence...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-white" />
                    Run Autonomous Buyer Agent
                  </>
                )}
              </button>
            </div>
          </div>

          {/* RIGHT: LIVE TELEMETRY LOGS & NEXT ACTIONS (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="font-bold text-white text-sm flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live Execution Telemetry
                </h3>
                <span className="text-xs font-mono text-slate-400">
                  {steps.filter((s) => s.status === "done").length} / {steps.length || 5} steps
                  completed
                </span>
              </div>

              {steps.length === 0 ? (
                <div className="py-16 text-center text-slate-500 text-xs font-mono border-2 border-dashed border-slate-800 rounded-xl">
                  Select a scenario and click &ldquo;Run Autonomous Buyer Agent&rdquo; to watch the
                  flight recorder in action.
                </div>
              ) : (
                <div className="space-y-3">
                  {steps.map((step) => (
                    <div
                      key={step.seq}
                      className={`p-3.5 rounded-xl border transition-all ${
                        step.status === "running"
                          ? "bg-indigo-950/40 border-indigo-500 shadow-md shadow-indigo-950/50"
                          : step.status === "done"
                            ? "bg-slate-950/80 border-slate-800"
                            : step.status === "failed"
                              ? "bg-red-950/30 border-red-500/50"
                              : "bg-slate-950/40 border-slate-900 opacity-40"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          {step.status === "running" && (
                            <span className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                          )}
                          {step.status === "done" && (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          )}
                          {step.status === "failed" && <XCircle className="w-4 h-4 text-red-400" />}
                          {step.status === "pending" && (
                            <span className="w-4 h-4 rounded-full border border-slate-700 flex items-center justify-center text-[10px] text-slate-500">
                              {step.seq}
                            </span>
                          )}
                          <span
                            className={`text-xs font-semibold ${
                              step.status === "failed" ? "text-red-300" : "text-white"
                            }`}
                          >
                            {step.label}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-500 uppercase">
                          {step.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 font-mono pl-6 leading-relaxed">
                        {step.detail}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* ACTION CALLOUTS ON COMPLETION */}
              {(activePurchaseId || activeDisputeId) && (
                <div className="mt-4 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-indigo-950/20 p-4 rounded-xl border border-indigo-500/30">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Flight Recording
                      Persisted
                    </span>
                    <p className="text-[11px] text-slate-400 font-mono">
                      Chain signed with Ed25519 • PayPal Orders v2 synced
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {activePurchaseId && (
                      <Link
                        href={`/purchases/${activePurchaseId}`}
                        className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition"
                      >
                        Inspect Timeline <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                    )}
                    {activeDisputeId && (
                      <Link
                        href={`/disputes/${activeDisputeId}`}
                        className="px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold flex items-center gap-1.5 transition"
                      >
                        Enter Courtroom <Scale className="w-3.5 h-3.5" />
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* SIMULATED PAYPAL SANDBOX APPROVAL MODAL */}
      {showPaypalModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2">
                <span className="h-7 w-7 rounded-lg bg-blue-600 flex items-center justify-center font-black text-white text-xs">
                  P
                </span>
                <span className="font-bold text-white text-sm">PayPal Sandbox Approval</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                Sandbox Mode
              </span>
            </div>

            <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
              <div className="text-xs text-slate-400">Order Authorization Request:</div>
              <div className="flex justify-between items-center text-sm font-semibold text-white">
                <span>{selectedScenario.title}</span>
                <span>$349.99 USD</span>
              </div>
              <div className="text-[11px] font-mono text-slate-500 border-t border-slate-800 pt-2 space-y-1">
                <div>Intent: AUTHORIZE</div>
                <div>Payee: {selectedScenario.merchant.name}</div>
                <div>NetraBox Flight Recorder: ACTIVE</div>
              </div>
            </div>

            <div className="space-y-2">
              <button
                onClick={completePaypalApproval}
                className="w-full py-3 bg-[#0070ba] hover:bg-[#005ea6] text-white font-bold rounded-xl text-xs shadow-lg transition flex items-center justify-center gap-2"
              >
                Approve Authorization (PayPal Sandbox)
              </button>
              <button
                onClick={() => setShowPaypalModal(false)}
                className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-xs transition"
              >
                Cancel Approval
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
