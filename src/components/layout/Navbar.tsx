"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { useAuth } from "@/contexts/AuthContext";
import { DustLogo } from "@/components/DustLogo";
import { ChainSelector } from "@/components/ChainSelector";
import { MenuIcon, XIcon } from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/swap", label: "Swap" },
  { href: "/pools", label: "Pools" },
  { href: "/wallet", label: "Wallet" },
  { href: "/links", label: "Links" },
  { href: "/activities", label: "Activity" },
  { href: "/settings", label: "Settings" },
];

export function Navbar() {
  const pathname = usePathname();
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const { ownedNames } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const displayName = ownedNames.length > 0
    ? `${ownedNames[0].name}.tok`
    : address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null;

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 h-14 bg-[#06080F] border-b border-[rgba(255,255,255,0.06)] flex items-center px-4 md:px-6">
        <Link href="/dashboard" className="flex items-center gap-2 mr-6 shrink-0">
          <DustLogo size={22} color="#00FF41" />
          <span className="text-sm font-bold tracking-widest text-white font-mono hidden sm:block">DUST</span>
        </Link>

        <div className="hidden md:flex items-center gap-1 flex-1">
          {navItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`px-3 py-1.5 text-[11px] font-mono tracking-wider transition-all rounded-sm ${
                pathname === item.href
                  ? 'text-[#00FF41] bg-[rgba(0,255,65,0.06)] border border-[rgba(0,255,65,0.15)]'
                  : 'text-[rgba(255,255,255,0.5)] hover:text-white hover:bg-[rgba(255,255,255,0.04)] border border-transparent'
              }`}
            >
              {item.label.toUpperCase()}
            </Link>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-2 ml-auto">
          <ChainSelector />
          {displayName && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)]">
              <div className="w-1.5 h-1.5 rounded-full bg-[#00FF41] animate-pulse" />
              <span className="text-[10px] font-mono text-[rgba(255,255,255,0.7)]">{displayName}</span>
            </div>
          )}
          <button
            onClick={() => disconnect()}
            className="px-2.5 py-1 text-[10px] font-mono text-[rgba(255,255,255,0.4)] border border-[rgba(255,255,255,0.06)] rounded-sm hover:text-white hover:border-[rgba(255,255,255,0.15)] transition-all"
          >
            DISCONNECT
          </button>
        </div>

        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden ml-auto text-[rgba(255,255,255,0.6)] hover:text-white transition-colors"
        >
          {mobileOpen ? <XIcon className="w-5 h-5" /> : <MenuIcon className="w-5 h-5" />}
        </button>
      </nav>

      {mobileOpen && (
        <div className="fixed top-14 left-0 right-0 z-40 bg-[#06080F] border-b border-[rgba(255,255,255,0.06)] flex flex-col py-2">
          {navItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`px-6 py-3 text-[11px] font-mono tracking-wider transition-all ${
                pathname === item.href
                  ? 'text-[#00FF41] bg-[rgba(0,255,65,0.04)]'
                  : 'text-[rgba(255,255,255,0.5)] hover:text-white hover:bg-[rgba(255,255,255,0.03)]'
              }`}
            >
              {item.label.toUpperCase()}
            </Link>
          ))}
          <div className="px-6 py-3 flex items-center gap-3">
            <ChainSelector />
            {address && (
              <button
                onClick={() => { disconnect(); setMobileOpen(false); }}
                className="text-[10px] font-mono text-[rgba(255,255,255,0.4)] hover:text-white"
              >
                DISCONNECT
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
