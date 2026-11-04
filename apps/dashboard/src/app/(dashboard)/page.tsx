import Link from "next/link";
import { ShieldCheck, Scale, ShoppingBag, Terminal } from "lucide-react";

export default function DashboardHome() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/25">
            👁️
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white">NetraBox</h1>
            <p className="text-xs text-slate-400">AI Flight Recorder & Dispute Tribunal</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link
            href="/shop"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
          >
            <ShoppingBag className="w-4 h-4 text-emerald-400" />
            Demo Store
          </Link>
          <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            PayPal Sandbox Ready
          </span>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-8 space-y-8">
        <section className="bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/40 border border-slate-800 rounded-xl p-8 shadow-xl">
          <h2 className="text-2xl font-bold text-white mb-2">Cryptographic Commerce Ledger</h2>
          <p className="text-slate-400 max-w-3xl leading-relaxed">
            When an AI agent executes a purchase, NetraBox signs every step with Ed25519 and locks
            it into an immutable SHA-256 hash chain. If a dispute occurs, autonomous legal advocates
            debate the ledger before an AI judge, and a deterministic policy engine settles funds
            directly on PayPal Sandbox.
          </p>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6">
            <div className="h-10 w-10 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center mb-4">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h3 className="font-semibold text-white mb-1">Flight Recorder</h3>
            <p className="text-sm text-slate-400">
              Ed25519 signed, hash-chained evidence verifying prompts, constraints, reasoning, and
              cart proposals.
            </p>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6">
            <div className="h-10 w-10 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center mb-4">
              <Scale className="w-6 h-6" />
            </div>
            <h3 className="font-semibold text-white mb-1">Autonomous Tribunal</h3>
            <p className="text-sm text-slate-400">
              Multi-agent debate (Buyer Advocate vs Merchant Advocate) with strict grounding against
              verified event IDs.
            </p>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6">
            <div className="h-10 w-10 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center mb-4">
              <Terminal className="w-6 h-6" />
            </div>
            <h3 className="font-semibold text-white mb-1">Deterministic Settlement</h3>
            <p className="text-sm text-slate-400">
              Policy engine executes verified capture, partial capture, void, or refund actions on
              PayPal Orders v2 rails.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
