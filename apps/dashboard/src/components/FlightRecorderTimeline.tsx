"use client";

import { useState } from "react";
import { formatDate } from "../lib/format";
import type { MockEvidenceEventItem } from "../lib/mock-data";
import {
  User,
  Bot,
  Store,
  Cpu,
  Scale,
  ChevronDown,
  ChevronUp,
  Key,
  Hash,
  Link as LinkIcon,
} from "lucide-react";

interface TimelineProps {
  events: MockEvidenceEventItem[];
  highlightedEventId?: string;
  onSelectEventId?: (id: string) => void;
}

export function FlightRecorderTimeline({
  events,
  highlightedEventId,
  onSelectEventId,
}: TimelineProps) {
  const [expandedEvents, setExpandedEvents] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) => {
    setExpandedEvents((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const getActorBadge = (actor: string) => {
    switch (actor) {
      case "user":
        return {
          icon: User,
          label: "Buyer User",
          bg: "bg-blue-500/10 text-blue-400 border-blue-500/20",
        };
      case "agent":
        return {
          icon: Bot,
          label: "Buyer Agent",
          bg: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
        };
      case "merchant":
        return {
          icon: Store,
          label: "Merchant",
          bg: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
        };
      case "tribunal":
        return {
          icon: Scale,
          label: "AI Tribunal",
          bg: "bg-purple-500/10 text-purple-400 border-purple-500/20",
        };
      case "system":
      default:
        return {
          icon: Cpu,
          label: "Platform Orchestrator",
          bg: "bg-slate-700/30 text-slate-400 border-slate-700/50",
        };
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-white tracking-tight">
            Cryptographic Flight Recorder Ledger
          </h3>
          <p className="text-xs text-slate-400">
            Monotonically chained SHA-256 blocks with native Ed25519 digital signatures
          </p>
        </div>
        <span className="text-xs font-mono bg-slate-800 text-slate-300 px-2.5 py-1 rounded-lg border border-slate-700">
          {events.length} Sealed Blocks
        </span>
      </div>

      <div className="relative pl-6 border-l-2 border-slate-800 space-y-6 pt-2">
        {events.map((event) => {
          const isExpanded = !!expandedEvents[event.id];
          const isHighlighted = highlightedEventId === event.id;
          const actorInfo = getActorBadge(event.actor);
          const ActorIcon = actorInfo.icon;

          return (
            <div
              key={event.id}
              id={`ev-node-${event.id}`}
              onClick={() => onSelectEventId && onSelectEventId(event.id)}
              className={`relative group rounded-xl p-4 transition-all duration-200 border cursor-pointer ${
                isHighlighted
                  ? "bg-indigo-950/40 border-indigo-500 ring-2 ring-indigo-500/30 shadow-lg shadow-indigo-950/50"
                  : "bg-slate-900/70 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900"
              }`}
            >
              {/* Timeline Connector Dot */}
              <div
                className={`absolute -left-[31px] top-5 h-4 w-4 rounded-full border-2 transition-colors ${
                  isHighlighted
                    ? "bg-indigo-500 border-white ring-4 ring-indigo-500/30"
                    : "bg-slate-900 border-indigo-500 group-hover:border-white"
                }`}
              />

              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-800/60">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="font-mono text-xs font-bold text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                    #{event.seq}
                  </span>

                  <span className="font-bold text-xs text-white tracking-tight">{event.type}</span>

                  <span
                    className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${actorInfo.bg}`}
                  >
                    <ActorIcon className="w-3 h-3" />
                    {actorInfo.label}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span className="font-mono text-[11px]">{formatDate(event.createdAt)}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(event.id);
                    }}
                    className="flex items-center gap-1 text-slate-400 hover:text-white transition text-[11px] font-medium"
                  >
                    {isExpanded ? "Hide" : "Inspect"}
                    {isExpanded ? (
                      <ChevronUp className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>

              {/* Event Content Summary */}
              <div className="text-xs text-slate-300">
                {Boolean(event.payload.prompt) && (
                  <p className="line-clamp-2">
                    <span className="text-slate-500">Prompt:</span> &ldquo;
                    {String(event.payload.prompt)}&rdquo;
                  </p>
                )}
                {Boolean(event.payload.reason) && (
                  <p className="line-clamp-2">
                    <span className="text-slate-500">Reason:</span> {String(event.payload.reason)}
                  </p>
                )}
                {Boolean(event.payload.trackingNumber) && (
                  <p className="line-clamp-2">
                    <span className="text-slate-500">Carrier Tracking:</span>{" "}
                    <span className="font-mono text-indigo-300">
                      {String(event.payload.trackingNumber)}
                    </span>{" "}
                    ({String(event.payload.carrier || "Carrier")})
                  </p>
                )}
                {Boolean(event.payload.action) && (
                  <p className="line-clamp-2">
                    <span className="text-slate-500">Action:</span>{" "}
                    <span className="font-bold text-purple-400">
                      {String(event.payload.action)}
                    </span>
                  </p>
                )}
              </div>

              {/* Expanded Cryptographic Drawer */}
              {isExpanded && (
                <div className="mt-3 pt-3 border-t border-slate-800/80 space-y-2 text-[11px] font-mono">
                  <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 space-y-1.5 overflow-x-auto">
                    <div className="flex items-center gap-1.5 text-slate-400">
                      <Hash className="w-3.5 h-3.5 text-indigo-400" />
                      <span className="text-slate-500">Block Hash:</span>
                      <span className="text-slate-300 break-all">{event.hash}</span>
                    </div>

                    <div className="flex items-center gap-1.5 text-slate-400">
                      <LinkIcon className="w-3.5 h-3.5 text-slate-500" />
                      <span className="text-slate-500">Prev Hash:</span>
                      <span className="text-slate-400 break-all">{event.prevHash}</span>
                    </div>

                    <div className="flex items-center gap-1.5 text-slate-400">
                      <Key className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-slate-500">Ed25519 Sig:</span>
                      <span className="text-emerald-400/80 break-all">{event.signature}</span>
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-500 block mb-1">Payload JSON:</span>
                    <pre className="p-3 bg-slate-950 rounded-lg text-slate-300 overflow-x-auto border border-slate-800">
                      {JSON.stringify(event.payload, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
