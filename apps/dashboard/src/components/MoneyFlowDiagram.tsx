import { formatMoney, getStateBadgeColor } from "../lib/format";
import { Lock, RotateCcw, Wallet, Store } from "lucide-react";

interface MoneyFlowDiagramProps {
  amountMinor: number;
  capturedAmountMinor: number;
  refundedAmountMinor: number;
  currency?: string;
  state: string;
  paypalOrderId?: string;
  paypalAuthorizationId?: string;
  paypalCaptureId?: string;
  paypalRefundId?: string;
}

export function MoneyFlowDiagram({
  amountMinor,
  capturedAmountMinor,
  refundedAmountMinor,
  currency = "USD",
  state,
  paypalOrderId,
  paypalAuthorizationId,
  paypalCaptureId,
  paypalRefundId,
}: MoneyFlowDiagramProps) {
  const badge = getStateBadgeColor(state);
  const netHeldMinor = capturedAmountMinor - refundedAmountMinor;

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-6">
        <div>
          <h3 className="text-sm font-bold text-white tracking-tight">
            PayPal Orders v2 Settlement Flow
          </h3>
          <p className="text-xs text-slate-400">
            Real Sandbox Rails: Intent <span className="font-mono text-indigo-400">AUTHORIZE</span>{" "}
            &amp; Atomic Capture/Refund
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${badge.bg} ${badge.text} ${badge.border}`}
          >
            <span className={`w-2 h-2 rounded-full ${badge.dot}`} />
            {state}
          </span>
        </div>
      </div>

      {/* Visual Flow Nodes */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 relative">
        {/* Node 1: Buyer Wallet */}
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between relative">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-8 w-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
              <Wallet className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-bold text-white block">Buyer Wallet</span>
              <span className="text-[10px] text-slate-500 font-mono">Sandbox Buyer</span>
            </div>
          </div>
          <div className="pt-2 border-t border-slate-800/60">
            <span className="text-[10px] text-slate-400 block">Total Order</span>
            <span className="text-sm font-bold text-white">
              {formatMoney(amountMinor, currency)}
            </span>
          </div>
        </div>

        {/* Node 2: PayPal Hold / Escrow */}
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between relative">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-8 w-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-bold text-white block">PayPal Hold</span>
              <span className="text-[10px] text-slate-500 font-mono">
                {paypalAuthorizationId || "Pending Auth"}
              </span>
            </div>
          </div>
          <div className="pt-2 border-t border-slate-800/60">
            <span className="text-[10px] text-slate-400 block">Authorized Funds</span>
            <span className="text-sm font-bold text-indigo-400">
              {formatMoney(amountMinor, currency)}
            </span>
          </div>
        </div>

        {/* Node 3: Merchant Settlement */}
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between relative">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <Store className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-bold text-white block">Merchant Account</span>
              <span className="text-[10px] text-slate-500 font-mono">
                {paypalCaptureId || "Uncaptured"}
              </span>
            </div>
          </div>
          <div className="pt-2 border-t border-slate-800/60">
            <span className="text-[10px] text-slate-400 block">Captured Balance</span>
            <span className="text-sm font-bold text-emerald-400">
              {formatMoney(capturedAmountMinor, currency)}
            </span>
          </div>
        </div>

        {/* Node 4: Tribunal Refund */}
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between relative">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-8 w-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
              <RotateCcw className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-bold text-white block">Tribunal Refund</span>
              <span className="text-[10px] text-slate-500 font-mono">
                {paypalRefundId || "None"}
              </span>
            </div>
          </div>
          <div className="pt-2 border-t border-slate-800/60">
            <span className="text-[10px] text-slate-400 block">Refunded to Buyer</span>
            <span className="text-sm font-bold text-purple-400">
              {formatMoney(refundedAmountMinor, currency)}
            </span>
          </div>
        </div>
      </div>

      {/* PayPal Reference IDs Footer */}
      <div className="mt-4 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
        <div className="flex items-center gap-4">
          <div>
            <span className="text-slate-500 text-[11px]">PayPal Order:</span>{" "}
            <span className="font-mono text-slate-300 font-medium">{paypalOrderId || "N/A"}</span>
          </div>
          <div>
            <span className="text-slate-500 text-[11px]">Auth ID:</span>{" "}
            <span className="font-mono text-slate-300 font-medium">
              {paypalAuthorizationId || "N/A"}
            </span>
          </div>
        </div>

        <div className="text-right">
          <span className="text-slate-500 text-[11px]">Net Merchant Payout:</span>{" "}
          <span className="font-bold text-white font-mono">
            {formatMoney(netHeldMinor, currency)}
          </span>
        </div>
      </div>
    </div>
  );
}
