"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingBag, BarChart3, RotateCcw, ListOrdered, Eye } from "lucide-react";

export function Navigation() {
  const pathname = usePathname();

  const navLinks = [
    { href: "/", label: "Purchases", icon: ListOrdered },
    { href: "/shop", label: "Demo Store", icon: ShoppingBag },
    { href: "/bench", label: "DisputeBench", icon: BarChart3 },
    { href: "/replay", label: "Replay Mode", icon: RotateCcw },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md px-6 py-3.5 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/25 group-hover:scale-105 transition-transform">
            <Eye className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold tracking-tight text-white group-hover:text-indigo-400 transition-colors">
                NetraBox
              </span>
              <span className="text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-500/20">
                v1.0
              </span>
            </div>
            <p className="text-[11px] text-slate-400">AI Flight Recorder & Dispute Tribunal</p>
          </div>
        </Link>

        <nav className="hidden md:flex items-center gap-1 pl-4 border-l border-slate-800">
          {navLinks.map((link) => {
            const Icon = link.icon;
            const isActive =
              link.href === "/"
                ? pathname === "/" || pathname.startsWith("/purchases")
                : pathname.startsWith(link.href);

            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? "bg-slate-800 text-white shadow-sm border border-slate-700"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                }`}
              >
                <Icon
                  className={`w-3.5 h-3.5 ${
                    isActive ? "text-indigo-400" : "text-slate-500 group-hover:text-slate-400"
                  }`}
                />
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <span className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-full border border-emerald-500/20 font-medium shadow-sm">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400" />
          PayPal Sandbox Connected
        </span>
      </div>
    </header>
  );
}
