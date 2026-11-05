import { formatMoney } from "../lib/format";
import { LiabilitySplitMeter } from "./LiabilitySplitMeter";
import { Scale, CheckCircle2, FileCheck, Landmark } from "lucide-react";

interface VerdictCardProps {
  classification: string;
  liabilitySplit: { buyer: number; agentProvider: number; merchant: number };
  refundAmountMinor: number;
  confidence: number;
  reasoning: string;
  recommendedAction: string;
  citedEvidenceIds?: string[];
  executedAction?: string;
  paypalTransactionId?: string;
  onSelectCitedId?: (id: string) => void;
}

export function VerdictCard({
  classification,
  liabilitySplit,
  refundAmountMinor,
  confidence,
  reasoning,
  recommendedAction,
  citedEvidenceIds = [],
  executedAction,
  paypalTransactionId,
  onSelectCitedId,
}: VerdictCardProps) {
  const confidencePercent = Math.round(confidence * 100);

  return (
    <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/40 border border-indigo-500/30 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 right-0 h-32 w-32 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center justify-center">
            <Scale className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-semibold text-purple-400 tracking-wide uppercase block">
              Autonomous Courtroom Verdict
            </span>
            <h2 className="text-xl font-bold text-white tracking-tight">{classification}</h2>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-[10px] text-slate-500 block">Judge Confidence</span>
            <span className="text-sm font-bold text-emerald-400 font-mono">
              {confidencePercent}%
            </span>
          </div>

          <div className="h-9 w-24 bg-slate-950 rounded-lg p-1 border border-slate-800 flex items-center">
            <div
              style={{ width: `${confidencePercent}%` }}
              className="h-full bg-emerald-500 rounded transition-all duration-500"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-6">
        <div>
          <span className="text-xs font-semibold text-slate-400 block mb-2">Judicial Reasoning</span>
          <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/50 p-4 rounded-xl border border-slate-800/80">
            {reasoning}
          </p>

          {/* Cited Evidence IDs */}
          {citedEvidenceIds.length > 0 && (
            <div className="mt-3">
              <span className="text-[11px] text-slate-500 block mb-1.5 font-medium">
                Cited Cryptographic Evidence Pins:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {citedEvidenceIds.map((id) => (
                  <button
                    key={id}
                    onClick={() => onSelectCitedId && onSelectCitedId(id)}
                    className="flex items-center gap-1 text-[11px] font-mono bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 px-2.5 py-1 rounded-md border border-indigo-500/20 transition"
                  >
                    <FileCheck className="w-3 h-3 text-indigo-400" />
                    {id}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800/80">
            <LiabilitySplitMeter
              buyer={liabilitySplit.buyer}
              agentProvider={liabilitySplit.agentProvider}
              merchant={liabilitySplit.merchant}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-950/50 p-3.5 rounded-xl border border-slate-800/80">
              <span className="text-[10px] text-slate-500 block">Recommended Action</span>
              <span className="text-xs font-bold text-white tracking-wide">
                {recommendedAction}
              </span>
            </div>

            <div className="bg-slate-950/50 p-3.5 rounded-xl border border-slate-800/80">
              <span className="text-[10px] text-slate-500 block">Settlement Refund</span>
              <span className="text-sm font-bold text-emerald-400 font-mono">
                {formatMoney(refundAmountMinor)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Policy Engine Execution Footer */}
      <div className="pt-4 border-t border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
            <CheckCircle2 className="w-3.5 h-3.5" />
          </div>
          <div>
            <span className="font-semibold text-white">Policy Engine Enforced:</span>{" "}
            <span className="text-slate-300 font-mono">
              {executedAction || recommendedAction}
            </span>
          </div>
        </div>

        {paypalTransactionId && (
          <div className="flex items-center gap-1.5 bg-slate-950 px-3 py-1 rounded-lg border border-slate-800">
            <Landmark className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-slate-500 text-[11px]">PayPal Tx:</span>
            <span className="font-mono text-emerald-400 text-[11px] font-bold">
              {paypalTransactionId}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
