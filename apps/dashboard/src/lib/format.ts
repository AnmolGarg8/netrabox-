export function formatMoney(amountMinor: number, currency = "USD"): string {
  const amount = (amountMinor / 100).toFixed(2);
  return `$${amount} ${currency}`;
}

export function formatDate(dateStr: string | Date | undefined): string {
  if (!dateStr) return "N/A";
  const date = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function getStateBadgeColor(state: string): {
  bg: string;
  text: string;
  border: string;
  dot: string;
} {
  switch (state) {
    case "AUTHORIZED":
      return {
        bg: "bg-blue-500/10",
        text: "text-blue-400",
        border: "border-blue-500/20",
        dot: "bg-blue-400",
      };
    case "CAPTURED":
    case "DELIVERED":
      return {
        bg: "bg-emerald-500/10",
        text: "text-emerald-400",
        border: "border-emerald-500/20",
        dot: "bg-emerald-400",
      };
    case "DISPUTED":
    case "IN_TRIBUNAL":
      return {
        bg: "bg-amber-500/10",
        text: "text-amber-400",
        border: "border-amber-500/20",
        dot: "bg-amber-400",
      };
    case "RESOLVED_REFUNDED_FULL":
    case "RESOLVED_REFUNDED_PARTIAL":
      return {
        bg: "bg-purple-500/10",
        text: "text-purple-400",
        border: "border-purple-500/20",
        dot: "bg-purple-400",
      };
    case "RESOLVED_REJECTED":
    case "RESOLVED_CAPTURED":
    case "RESOLVED_VOIDED":
      return {
        bg: "bg-cyan-500/10",
        text: "text-cyan-400",
        border: "border-cyan-500/20",
        dot: "bg-cyan-400",
      };
    case "NEEDS_HUMAN_REVIEW":
      return {
        bg: "bg-rose-500/10",
        text: "text-rose-400",
        border: "border-rose-500/20",
        dot: "bg-rose-400",
      };
    case "VOIDED":
    default:
      return {
        bg: "bg-slate-800",
        text: "text-slate-400",
        border: "border-slate-700",
        dot: "bg-slate-400",
      };
  }
}
