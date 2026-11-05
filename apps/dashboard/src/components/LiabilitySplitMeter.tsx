interface SplitProps {
  buyer: number;
  agentProvider: number;
  merchant: number;
}

export function LiabilitySplitMeter({ buyer, agentProvider, merchant }: SplitProps) {
  const b = Math.max(0, buyer);
  const a = Math.max(0, agentProvider);
  const m = Math.max(0, merchant);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs font-semibold">
        <span className="text-slate-400">Judicial Liability Split</span>
        <span className="text-white font-mono">{b + a + m}% Total</span>
      </div>

      {/* Tri-Color Progress Bar */}
      <div className="h-3 w-full rounded-full bg-slate-950 overflow-hidden flex border border-slate-800">
        <div
          style={{ width: `${b}%` }}
          className="bg-blue-500 transition-all duration-500 hover:opacity-90"
          title={`Buyer: ${b}%`}
        />
        <div
          style={{ width: `${a}%` }}
          className="bg-amber-500 transition-all duration-500 hover:opacity-90"
          title={`Agent Provider: ${a}%`}
        />
        <div
          style={{ width: `${m}%` }}
          className="bg-purple-500 transition-all duration-500 hover:opacity-90"
          title={`Merchant: ${m}%`}
        />
      </div>

      {/* Legend */}
      <div className="grid grid-cols-3 gap-2 pt-1 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-blue-500" />
          <span className="text-slate-400">Buyer:</span>
          <span className="font-bold text-white font-mono">{b}%</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          <span className="text-slate-400">Agent:</span>
          <span className="font-bold text-white font-mono">{a}%</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-purple-500" />
          <span className="text-slate-400">Merchant:</span>
          <span className="font-bold text-white font-mono">{m}%</span>
        </div>
      </div>
    </div>
  );
}
