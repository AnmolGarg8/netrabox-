"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  FastForward,
  ArrowRight,
  Fingerprint,
  Clock,
  Layers,
  FileCheck2,
  History,
} from "lucide-react";
import {
  SEEDED_PURCHASES,
  SEEDED_EVIDENCE_EVENTS,
  type MockPurchaseItem,
  type MockEvidenceEventItem,
} from "@/lib/mock-data";
import { formatMoney, formatDate, getStateBadgeColor } from "@/lib/format";

export default function ReplayPage() {
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string>("pur_demo_01");
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1); // 1x, 2x, 4x

  const purchase: MockPurchaseItem =
    SEEDED_PURCHASES.find((p) => p.id === selectedPurchaseId) || SEEDED_PURCHASES[0];

  const allEvents: MockEvidenceEventItem[] = SEEDED_EVIDENCE_EVENTS[selectedPurchaseId] || [
    {
      id: "ev_default_1",
      purchaseId: selectedPurchaseId,
      seq: 1,
      type: "INSTRUCTION_RECEIVED",
      actor: "user",
      payload: { prompt: "Default replay item" },
      createdAt: new Date().toISOString(),
      prevHash: "0000000000000000000000000000000000000000000000000000000000000000",
      hash: "8a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6",
      signature: "3045022100881920abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      signerKeyId: "key_buyer",
    },
  ];

  const totalSteps = allEvents.length;
  const currentEvent = allEvents[Math.min(currentStep - 1, totalSteps - 1)];

  // Reset step when changing purchase
  useEffect(() => {
    setCurrentStep(1);
    setIsPlaying(false);
  }, [selectedPurchaseId]);

  // Auto-playback timer
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isPlaying) {
      const intervalMs = Math.max(800, 2400 / playbackSpeed);
      timerRef.current = setInterval(() => {
        setCurrentStep((prev) => {
          if (prev >= totalSteps) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, intervalMs);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, playbackSpeed, totalSteps]);

  const handleNext = () => {
    if (currentStep < totalSteps) setCurrentStep((c) => c + 1);
  };

  const handlePrev = () => {
    if (currentStep > 1) setCurrentStep((c) => c - 1);
  };

  const handleReset = () => {
    setIsPlaying(false);
    setCurrentStep(1);
  };

  const toggleSpeed = () => {
    if (playbackSpeed === 1) setPlaybackSpeed(2);
    else if (playbackSpeed === 2) setPlaybackSpeed(4);
    else setPlaybackSpeed(1);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* WATERMARK BANNER */}
      <div className="bg-amber-500/10 border-b border-amber-500/30 px-6 py-2.5 flex items-center justify-between text-xs text-amber-300">
        <div className="flex items-center gap-2 font-mono">
          <History className="w-4 h-4 text-amber-400 animate-pulse" />
          <span className="font-bold tracking-widest uppercase">
            [ REPLAY SESSION — DETERMINISTIC RECORDING • LIVE EXECUTION FROZEN ]
          </span>
        </div>
        <div className="flex items-center gap-4 text-amber-400/80">
          <span>Target Purchase: {purchase.id}</span>
          <span className="hidden sm:inline">Cryptographic Evidence Vault: Read-Only</span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto w-full p-6 md:p-8 space-y-8 flex-1">
        {/* HEADER & SCENARIO SELECTOR */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-3">
              Telemetry Replay Mode
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-mono font-normal">
                {totalSteps} Hash-Chained Events
              </span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Step through recorded buyer-agent negotiations, Intent Guard verifications, and PayPal
              settlement states.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">Select Run:</span>
            {SEEDED_PURCHASES.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedPurchaseId(p.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all ${
                  selectedPurchaseId === p.id
                    ? "bg-indigo-600 text-white font-bold shadow-md shadow-indigo-600/30 border border-indigo-400"
                    : "bg-slate-900 text-slate-400 hover:text-white border border-slate-800"
                }`}
              >
                {p.id}
              </button>
            ))}
          </div>
        </div>

        {/* PURCHASE SUMMARY STRIP */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs font-mono text-slate-400">Replaying Purchase:</div>
            <div className="font-semibold text-white text-sm">{purchase.title}</div>
            <div className="text-xs text-slate-400 font-mono flex items-center gap-3">
              <span>Amount: {formatMoney(purchase.amountMinor, purchase.currency)}</span>
              <span>Buyer: {purchase.buyerId}</span>
              <span>Merchant: {purchase.merchantId}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={`px-2.5 py-1 rounded-md text-xs font-mono font-semibold border ${getStateBadgeColor(
                purchase.state
              )}`}
            >
              Final: {purchase.state}
            </span>
            {purchase.disputeId && (
              <Link
                href={`/disputes/${purchase.disputeId}`}
                className="text-xs font-mono text-indigo-400 hover:text-indigo-300 underline flex items-center gap-1"
              >
                View Tribunal &rarr;
              </Link>
            )}
            <Link
              href={`/purchases/${purchase.id}`}
              className="text-xs font-mono text-indigo-400 hover:text-indigo-300 underline flex items-center gap-1"
            >
              Full Flight Recorder &rarr;
            </Link>
          </div>
        </div>

        {/* PLAYBACK CONTROL BAR */}
        <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-5 shadow-2xl space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            {/* Main playback buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleReset}
                title="Reset to beginning"
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={handlePrev}
                disabled={currentStep <= 1}
                title="Previous step"
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                <SkipBack className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className={`px-5 py-2.5 rounded-xl font-semibold text-xs flex items-center gap-2 shadow-lg transition ${
                  isPlaying
                    ? "bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/30"
                    : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30"
                }`}
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-4 h-4" /> Pause Replay
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-white" /> Start Replay
                  </>
                )}
              </button>
              <button
                onClick={handleNext}
                disabled={currentStep >= totalSteps}
                title="Next step"
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            </div>

            {/* Step Counter & Speed */}
            <div className="flex items-center gap-4">
              <button
                onClick={toggleSpeed}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-300 border border-slate-700 transition"
              >
                <FastForward className="w-3.5 h-3.5 text-indigo-400" />
                {playbackSpeed}x Speed
              </button>

              <div className="text-right">
                <span className="text-xs text-slate-400">Step: </span>
                <span className="text-sm font-bold font-mono text-white">
                  {currentStep} / {totalSteps}
                </span>
              </div>
            </div>
          </div>

          {/* Scrubbing timeline bar */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] font-mono text-slate-400">
              <span>Start (Seq #1)</span>
              <span>
                {currentEvent ? currentEvent.type : "Ready"} (Seq #{currentStep})
              </span>
              <span>End (Seq #{totalSteps})</span>
            </div>
            <input
              type="range"
              min="1"
              max={totalSteps}
              value={currentStep}
              onChange={(e) => {
                setIsPlaying(false);
                setCurrentStep(parseInt(e.target.value, 10));
              }}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
          </div>
        </div>

        {/* TWO-COLUMN INSPECTION INTERFACE */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* LEFT: TIMELINE PROGRESSION (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-400" />
                Sequential Evidence Stream
              </h2>
              <span className="text-xs text-slate-400 font-mono">
                {currentStep} of {totalSteps} Revealed
              </span>
            </div>

            <div className="space-y-3">
              {allEvents.map((evt, idx) => {
                const isPassed = idx + 1 <= currentStep;
                const isCurrent = idx + 1 === currentStep;

                return (
                  <div
                    key={evt.id}
                    onClick={() => {
                      setIsPlaying(false);
                      setCurrentStep(idx + 1);
                    }}
                    className={`cursor-pointer p-4 rounded-xl border transition-all ${
                      isCurrent
                        ? "bg-indigo-950/40 border-indigo-500 shadow-lg shadow-indigo-950/50 scale-[1.01]"
                        : isPassed
                        ? "bg-slate-900/60 border-slate-800 hover:border-slate-700 opacity-90"
                        : "bg-slate-950/40 border-slate-900 opacity-30 cursor-not-allowed"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-mono text-xs px-2 py-0.5 rounded font-bold ${
                            isCurrent
                              ? "bg-indigo-500 text-white"
                              : isPassed
                              ? "bg-slate-800 text-slate-300"
                              : "bg-slate-900 text-slate-600"
                          }`}
                        >
                          #{evt.seq}
                        </span>
                        <span
                          className={`text-xs font-semibold ${
                            isCurrent
                              ? "text-white"
                              : isPassed
                              ? "text-slate-300"
                              : "text-slate-600"
                          }`}
                        >
                          {evt.type}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500 uppercase">
                        {evt.actor}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-400 line-clamp-1 font-mono">
                      {JSON.stringify(evt.payload)}
                    </div>

                    {isCurrent && (
                      <div className="mt-2.5 pt-2 border-t border-indigo-500/30 flex items-center justify-between text-[10px] text-indigo-300 font-mono">
                        <span>● ACTIVE REPLAY POINTER</span>
                        <span>{formatDate(evt.createdAt)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* RIGHT: DEEP DIVE ON CURRENT STEP (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
              <div className="flex items-start justify-between border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold bg-indigo-500/20 text-indigo-400 px-2.5 py-1 rounded-md border border-indigo-500/30">
                      EVENT #{currentEvent?.seq || 1}
                    </span>
                    <h2 className="text-lg font-bold text-white">{currentEvent?.type}</h2>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    Recorded at: {formatDate(currentEvent?.createdAt || new Date().toISOString())}
                  </p>
                </div>

                <div className="text-right">
                  <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500 block mb-1">
                    Origin Actor
                  </span>
                  <span className="px-2.5 py-1 rounded bg-slate-800 text-xs font-mono font-semibold text-slate-200 uppercase border border-slate-700">
                    {currentEvent?.actor}
                  </span>
                </div>
              </div>

              {/* PAYLOAD INSPECTION */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                  <FileCheck2 className="w-4 h-4 text-emerald-400" />
                  Recorded Canonical Payload
                </span>
                <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-emerald-300/90 overflow-x-auto max-h-72 leading-relaxed">
                  {JSON.stringify(currentEvent?.payload || {}, null, 2)}
                </pre>
              </div>

              {/* CRYPTOGRAPHIC HASH CHAIN & SIGNATURE */}
              <div className="space-y-3 pt-2">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                  <Fingerprint className="w-4 h-4 text-indigo-400" />
                  Cryptographic Chain Link
                </span>

                <div className="grid grid-cols-1 gap-2 font-mono text-[11px]">
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80">
                    <div className="text-slate-500 text-[10px] uppercase mb-0.5">
                      Previous Hash (prevHash):
                    </div>
                    <div className="text-slate-400 break-all">{currentEvent?.prevHash}</div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80">
                    <div className="text-slate-500 text-[10px] uppercase mb-0.5">
                      Current Hash (SHA-256):
                    </div>
                    <div className="text-indigo-300 break-all font-semibold">
                      {currentEvent?.hash}
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80">
                    <div className="text-slate-500 text-[10px] uppercase mb-0.5">
                      Ed25519 Signature:
                    </div>
                    <div className="text-amber-300/90 break-all">{currentEvent?.signature}</div>
                    <div className="text-[10px] text-slate-500 mt-1">
                      Signer Key ID: {currentEvent?.signerKeyId}
                    </div>
                  </div>
                </div>
              </div>

              {/* ACTION CALLOUT */}
              <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                <div className="text-xs text-slate-400">
                  Ready to test adversarial intervention on this transaction?
                </div>
                <Link
                  href={`/purchases/${purchase.id}`}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  Inspect Flight Recorder <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
