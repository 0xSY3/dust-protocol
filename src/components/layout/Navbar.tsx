"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { useAuth } from "@/contexts/AuthContext";
import { DustLogo } from "@/components/DustLogo";
import { getSupportedChains } from "@/config/chains";
import { ChainIcon as ChainTokenIcon } from "@/components/stealth/icons";
import { MenuIcon, XIcon, ChevronDownIcon, CopyIcon, LogOutIcon, CheckIcon } from "lucide-react";
import { isPrivyEnabled } from "@/config/privy";
import { useLogin } from "@privy-io/react-auth";

const chains = getSupportedChains();

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/swap", label: "Swap" },
  { href: "/pools", label: "Pools" },
  { href: "/wallet", label: "Wallet" },
  { href: "/links", label: "Links" },
  { href: "/activities", label: "Activity" },
  { href: "/settings", label: "Settings" },
  { href: "/docs", label: "Docs" },
];

function isNavActive(itemHref: string, pathname: string) {
  if (itemHref === "/docs") return pathname.startsWith("/docs");
  return pathname === itemHref;
}

export function Navbar() {
  const pathname = usePathname();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { connect } = useConnect();
  const { login: privyLogin } = useLogin();
  const { activeChainId, setActiveChain } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const walletRef = useRef<HTMLDivElement>(null);

  const activeChain = chains.find(c => c.id === activeChainId) || chains[0];

  const displayName = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null;

  const handleConnect = () => {
    if (isPrivyEnabled) {
      privyLogin();
    } else {
      connect({ connector: injected() });
    }
  };

  // Close wallet dropdown on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (walletRef.current && !walletRef.current.contains(e.target as Node)) {
        setWalletOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  function copyAddress() {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 h-[72px] bg-[#06080F]/70 backdrop-blur-xl border-b border-white/[0.04] flex items-center px-4 lg:px-8 transition-all duration-300">

        {/* Left — logo */}
        <div className="flex-1 flex items-center min-w-0">
          <Link href="/dashboard" className="flex items-center gap-2.5 shrink-0 group">
            <div className="relative flex items-center justify-center w-8 h-8 rounded-xl bg-white/[0.02] border border-white/[0.04] group-hover:border-[#00FF41]/30 group-hover:bg-[#00FF41]/[0.02] transition-all duration-300 overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-tr from-[#00FF41]/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <DustLogo size={22} color="#00FF41" className="relative z-10 drop-shadow-[0_0_8px_rgba(0,255,65,0.5)] group-hover:drop-shadow-[0_0_12px_rgba(0,255,65,0.8)] transition-all duration-300" />
            </div>
            <span className="flex items-baseline gap-2">
              <span className="text-lg font-bold tracking-[0.15em] text-white font-mono group-hover:text-[#00FF41] transition-colors duration-300">DUST</span>
              <span className="hidden sm:inline text-[10px] font-mono tracking-[0.3em] text-[#00FF41]/40 uppercase group-hover:text-[#00FF41]/70 transition-colors duration-300">PROTOCOL</span>
            </span>
          </Link>
        </div>

        {/* Center — nav links, only show when connected */}
        <div className="hidden md:flex flex-1 justify-center min-w-0">
          <div className="flex items-center p-1.5 rounded-2xl bg-[#06080F]/80 border border-white/[0.04] shadow-[0_4px_24px_-8px_rgba(0,0,0,0.5)] backdrop-blur-2xl shrink-0">
            {isConnected && navItems.map(item => {
              const isActive = isNavActive(item.href, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative inline-flex items-center px-4 py-2 text-[11px] font-mono tracking-wider transition-all duration-300 rounded-xl whitespace-nowrap overflow-hidden group ${isActive
                      ? 'text-[#00FF41]'
                      : 'text-white/50 hover:text-white'
                    }`}
                >
                  {isActive && (
                    <span className="absolute inset-0 bg-[#00FF41]/10 rounded-xl" />
                  )}
                  {!isActive && (
                    <span className="absolute inset-0 bg-white/5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  )}
                  {/* Highlight line on active */}
                  {isActive && (
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-[2px] bg-[#00FF41] rounded-t-full shadow-[0_0_8px_rgba(0,255,65,0.8)]" />
                  )}
                  <span className="relative z-10">{item.label.toUpperCase()}</span>
                </Link>
              )
            })}
          </div>
        </div>

        {/* Right — wallet button always visible + hamburger for small screens */}
        <div className="flex-1 flex items-center justify-end gap-3 min-w-0">
          <div className="relative shrink-0" ref={walletRef}>
            {displayName ? (
              <>
                <button
                  onClick={() => setWalletOpen(v => !v)}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/10 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.3)] transition-all duration-300 group"
                >
                  <div className="flex items-center justify-center w-6 h-6 rounded-full bg-white/[0.04] border border-white/5 group-hover:border-white/10 transition-colors">
                    <ChainTokenIcon size={14} chainId={activeChain.id} />
                  </div>
                  <div className="flex flex-col items-start gap-0.5">
                    <div className="flex items-center gap-2">
                      <div className="relative flex items-center justify-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#00FF41] z-10" />
                        <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-[#00FF41] animate-ping opacity-75" />
                        <div className="absolute w-3 h-3 rounded-full bg-[#00FF41]/20 blur-sm" />
                      </div>
                      <span className="text-[11px] font-mono font-medium tracking-wide text-white/90 group-hover:text-white transition-colors">{displayName}</span>
                    </div>
                  </div>
                  <ChevronDownIcon
                    className="w-3.5 h-3.5 text-white/40 group-hover:text-white/70 transition-all duration-300 ml-1"
                    style={{ transform: walletOpen ? "rotate(180deg)" : "none" }}
                  />
                </button>

                {walletOpen && (
                  <div className="absolute top-[calc(100%+12px)] mt-0 right-0 bg-[#06080F]/95 backdrop-blur-3xl border border-white/[0.08] rounded-2xl min-w-[260px] z-50 overflow-hidden shadow-[0_16px_40px_-8px_rgba(0,0,0,0.5)] p-1.5 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="px-3 pt-3 pb-2 flex items-center justify-between">
                      <span className="text-[10px] font-mono text-white/40 tracking-[0.2em] font-medium uppercase">Select Network</span>
                    </div>

                    <div className="space-y-0.5">
                      {chains.map(chain => {
                        const isActive = chain.id === activeChainId;
                        return (
                          <button
                            key={chain.id}
                            onClick={() => { setActiveChain(chain.id); setWalletOpen(false); }}
                            className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-mono transition-all duration-200 flex items-center gap-3 group relative overflow-hidden ${isActive
                                ? 'text-[#00FF41] bg-[#00FF41]/[0.05] border border-[#00FF41]/10'
                                : 'text-white/60 hover:bg-white/[0.04] hover:text-white border border-transparent hover:border-white/[0.02]'
                              }`}
                          >
                            {isActive && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#00FF41] shadow-[0_0_8px_rgba(0,255,65,0.8)]" />}
                            <div className={`flex items-center justify-center w-7 h-7 rounded-full bg-black/20 border transition-colors ${isActive ? 'border-[#00FF41]/20 group-hover:border-[#00FF41]/40' : 'border-white/5 group-hover:border-white/10'}`}>
                              <ChainTokenIcon size={16} chainId={chain.id} />
                            </div>
                            <span className="flex-1 font-medium tracking-wide">{chain.name}</span>
                            {isActive && <span className="w-1.5 h-1.5 rounded-full bg-[#00FF41] shadow-[0_0_6px_rgba(0,255,65,0.8)]"></span>}
                          </button>
                        );
                      })}
                    </div>

                    <div className="border-t border-white/[0.04] my-1.5 mx-2" />

                    <div className="space-y-0.5">
                      <button
                        onClick={copyAddress}
                        className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-mono text-white/50 hover:bg-white/[0.02] hover:text-white transition-all duration-200 flex items-center gap-3 group border border-transparent hover:border-white/[0.02]"
                      >
                        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-white/[0.02] border border-white/5 group-hover:border-white/10">
                          {copied ? <CheckIcon className="w-3.5 h-3.5 text-[#00FF41]" /> : <CopyIcon className="w-3.5 h-3.5" />}
                        </div>
                        <span className="font-medium tracking-wide">{copied ? "COPIED TO CLIPBOARD" : "COPY ADDRESS"}</span>
                      </button>
                      <button
                        onClick={() => { disconnect(); setWalletOpen(false); }}
                        className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-mono text-[#ff4b4b]/70 hover:bg-[#ff4b4b]/[0.05] hover:text-[#ff4b4b] transition-all duration-200 flex items-center gap-3 group border border-transparent hover:border-[#ff4b4b]/10"
                      >
                        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-[#ff4b4b]/[0.02] border border-[#ff4b4b]/5 group-hover:border-[#ff4b4b]/10 tracking-widest">
                          <LogOutIcon className="w-3.5 h-3.5" />
                        </div>
                        <span className="font-medium tracking-wide">DISCONNECT</span>
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <button
                onClick={handleConnect}
                className="relative overflow-hidden px-5 py-2.5 group rounded-xl bg-[#00FF41]/10 border border-[#00FF41]/30 hover:border-[#00FF41]/70 transition-all duration-300 shadow-[0_0_16px_-4px_rgba(0,255,65,0.2)] hover:shadow-[0_0_24px_-4px_rgba(0,255,65,0.4)]"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-[#00FF41]/0 via-[#00FF41]/20 to-[#00FF41]/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-in-out" />
                <span className="relative text-[11px] font-mono font-bold tracking-widest text-[#00FF41] group-hover:text-white transition-colors duration-300">
                  CONNECT WALLET
                </span>
                <span className="absolute left-0 bottom-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#00FF41]/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></span>
              </button>
            )}
          </div>

          {/* Hamburger — only nav links on small screens */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden shrink-0 w-10 h-10 flex items-center justify-center rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] text-white/60 hover:text-white transition-all duration-300 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.3)]"
          >
            {mobileOpen ? <XIcon className="w-5 h-5" /> : <MenuIcon className="w-5 h-5" />}
          </button>
        </div>
      </nav>

      {/* Mobile nav drawer */}
      {mobileOpen && (
        <div className="fixed top-[72px] left-0 right-0 z-40 bg-[#06080F]/95 backdrop-blur-3xl border-b border-white/[0.04] flex flex-col py-4 shadow-[0_16px_40px_-8px_rgba(0,0,0,0.6)] animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex flex-col px-3 gap-1">
            {isConnected ? navItems.map(item => {
              const isActive = isNavActive(item.href, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center px-4 py-3.5 text-xs font-mono tracking-widest transition-all duration-300 rounded-xl relative overflow-hidden group ${isActive
                      ? 'text-[#00FF41] bg-[#00FF41]/[0.04] border border-[#00FF41]/10'
                      : 'text-white/50 hover:text-white hover:bg-white/[0.02] border border-transparent hover:border-white/[0.04]'
                    }`}
                >
                  {isActive && (
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#00FF41] shadow-[0_0_12px_rgba(0,255,65,0.8)]" />
                  )}
                  <span className={`relative z-10 transition-transform duration-300 ${isActive ? 'translate-x-1' : 'group-hover:translate-x-1'}`}>
                    {item.label.toUpperCase()}
                  </span>
                  {isActive && (
                    <span className="absolute right-4 w-1.5 h-1.5 rounded-full bg-[#00FF41] shadow-[0_0_6px_rgba(0,255,65,0.8)]"></span>
                  )}
                </Link>
              )
            }) : (
              <button
                onClick={() => { handleConnect(); setMobileOpen(false); }}
                className="mx-1 mt-2 py-4 relative overflow-hidden group rounded-xl bg-[#00FF41]/10 border border-[#00FF41]/30 hover:border-[#00FF41]/70 transition-all duration-300 flex items-center justify-center shadow-[0_0_16px_-4px_rgba(0,255,65,0.2)]"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-[#00FF41]/0 via-[#00FF41]/20 to-[#00FF41]/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-in-out" />
                <span className="relative text-xs font-mono font-bold tracking-widest text-[#00FF41] group-hover:text-white transition-colors duration-300">
                  CONNECT WALLET
                </span>
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
