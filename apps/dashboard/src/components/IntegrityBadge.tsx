"use client";

import { useState } from "react";
import { ShieldCheck, ShieldAlert, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { triggerDemoTamper, restoreDemoTamper, verifyEvidenceChain } from "../lib/api";

interface IntegrityBadgeProps {
  purchaseId: string;
  initialValid?: boolean;
  totalEvents?: number;
  initialBrokenSeq?: number;
  initialReason?: string;
  onVerificationChange?: (valid: boolean) => void;
}

export function IntegrityBadge({
  purchaseId,
  initialValid = true,
  totalEvents = 9,
  initialBrokenSeq,
  initialReason,
  onVerificationChange,
}: IntegrityBadgeProps) {
  const [isValid, setIsValid] = useState<boolean>(initialValid);
  const [brokenSeq, setBrokenSeq] = useState<number | undefined>(initialBrokenSeq);
  const [reason, setReason] = useState<string | undefined>(initialReason);
  const [verifying, setVerifying] = useState(false);
  const [tampering, setTampering] = useState(false);

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const res = await verifyEvidenceChain(purchaseId);
      setIsValid(res.valid);
      setBrokenSeq(res.brokenSeq);
      setReason(res.reason);
      if (onVerificationChange) onVerificationChange(res.valid);
    } catch {
      // ignore
    } finally {
      setTimeout(() => setVerifying(false), 300);
    }
  };

  const handleTamper = async () => {
    setTampering(true);
    try {
      await triggerDemoTamper(purchaseId);
      await handleVerify();
    } finally {
      setTampering(false);
    }
  };

  const handleRestore = async () => {
    setTampering(true);
    try {
      await restoreDemoTamper(purchaseId);
      await handleVerify();
    } finally {
      setTampering(false);
    }
  };

  return (
    <div
      className={`rounded-2xl p-5 border transition-all duration-300 shadow-xl ${
        isValid
          ? "bg-slate-900/90 border-emerald-500/30 shadow-emerald-950/20"
          : "bg-rose-950/40 border-rose-500/50 shadow-rose-950/30 animate-pulse"
      }`}
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div
            className={`h-12 w-12 rounded-xl flex items-center justify-center shrink-0 shadow-lg ${
              isValid
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-rose-500/20 text-rose-400 border border-rose-500/40"
            }`}
          >
            {isValid ? (
              <ShieldCheck className="w-6 h-6 animate-pulse" />
            ) : (
              <ShieldAlert className="w-6 h-6" />
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-white tracking-tight">
                {isValid
                  ? "100% Cryptographically Verified Flight Ledger"
                  : `🚨 Cryptographic Tampering Detected at Seq #${brokenSeq || 5}`}
              </h3>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                  isValid
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : "bg-rose-500/20 text-rose-300 border-rose-500/40 font-mono"
                }`}
              >
                {isValid ? "SHA-256 Chain + Ed25519 Valid" : "Hash Digest Mismatch"}
              </span>
            </div>

            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              {isValid
                ? `All ${totalEvents} evidence events mathematically sealed with monotonically increasing sequence numbers and Ed25519 digital signatures.`
                : reason ||
                  `Integrity broken at event sequence #${brokenSeq}. Recomputed payload hash diverges from cryptographically signed block digest.`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0 self-end md:self-center">
          <button
            onClick={handleVerify}
            disabled={verifying}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${verifying ? "animate-spin text-indigo-400" : ""}`}
            />
            Verify Now
          </button>

          {isValid ? (
            <button
              onClick={handleTamper}
              disabled={tampering}
              title="Demo Mode: modify stored database payload to prove verification catch"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-semibold border border-rose-500/30 transition shadow-sm"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              Simulate DB Tamper
            </button>
          ) : (
            <button
              onClick={handleRestore}
              disabled={tampering}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-semibold border border-emerald-500/40 transition shadow-sm"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              Restore & Re-sign
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
