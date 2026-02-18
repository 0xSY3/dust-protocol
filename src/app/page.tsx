"use client";

import { useState, useEffect, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { WalletIcon, ArrowUpRightIcon } from "@/components/stealth/icons";
import { DustLogo } from "@/components/DustLogo";
import { useLogin } from "@privy-io/react-auth";
import { isPrivyEnabled } from "@/config/privy";
import { useConnect, useConnectors } from "wagmi";
import { injected } from "wagmi/connectors";
import DecryptedText from "@/components/DecryptedText";

// One-time cleanup of stale cache data from previous sessions
function cleanupCorruptedStorage() {
  if (typeof window === "undefined") return;
  const CURRENT_VERSION = 7;
  const flag = "stealth_storage_version";
  const stored = parseInt(localStorage.getItem(flag) || "0", 10);
  if (stored >= CURRENT_VERSION) return;
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (
      key.startsWith("stealth_last_scanned_") ||
      key.startsWith("stealth_payments_") ||
      key === "stealth_storage_v2_cleaned"
    )) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));

  // Backfill hashed onboarded flag for existing users
  // who have a stealth keys or PIN entry (pre-hashing era).
  // Import lazily to avoid circular deps from top-level import.
  if (stored < 7) {
    import('@/lib/storageKey').then(({ storageKey: sk, migrateKey: mk }) => {
      // Snapshot keys first — avoid mutating localStorage while iterating
      const allKeys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) allKeys.push(k);
      }
      for (const key of allKeys) {
        // Only `tokamak_stealth_keys_<rawAddr>` entries contain a raw wallet
        // address we can reconstruct. `dust_pin_` keys may already be hashed
        // (post-migration), so we can't safely extract an address from them.
        if (!key.startsWith("tokamak_stealth_keys_")) continue;
        const addr = key.replace("tokamak_stealth_keys_", "");
        // Must look like an Ethereum address (0x + 40 hex chars)
        if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) continue;
        // Write hashed onboarded key if not already set
        const hashedKey = sk('onboarded', addr);
        if (!localStorage.getItem(hashedKey)) {
          // Migrate legacy onboarded flag first, then backfill if still absent
          mk('dust_onboarded_' + addr.toLowerCase(), hashedKey);
          if (!localStorage.getItem(hashedKey)) {
            localStorage.setItem(hashedKey, 'true');
          }
        }
      }
    }).catch(() => { /* non-critical */ });
  }

  localStorage.setItem(flag, String(CURRENT_VERSION));
}


export default function Home() {
  const { isConnected, isOnboarded, isHydrated, isNamesSettled, address } = useAuth();
  const { login: privyLogin } = useLogin();
  const { connect, isPending: isConnecting, error: connectError } = useConnect();
  const connectors = useConnectors();
  const router = useRouter();
  const [searchName, setSearchName] = useState("");
  const [connectAttempted, setConnectAttempted] = useState(false);
  const hasPrivy = isPrivyEnabled;
  const hasInjectedWallet = typeof window !== "undefined" && !!window.ethereum;

  const handleConnect = () => {
    setConnectAttempted(true);
    if (hasPrivy) {
      // Privy's modal handles everything: wallets, WalletConnect, social logins
      privyLogin();
      return;
    }
    // Non-Privy fallback: use injected wallet or prompt install
    if (hasInjectedWallet) {
      const injectedConnector = connectors.find(c => c.type === "injected") ?? injected();
      connect({ connector: injectedConnector as ReturnType<typeof injected> });
    } else {
      window.open("https://metamask.io/download/", "_blank", "noopener,noreferrer");
    }
  };

  useEffect(() => { cleanupCorruptedStorage(); }, []);

  useEffect(() => {
    if (!isHydrated) return;
    if (isConnected && !address) return;
    if (isConnected && isOnboarded) {
      router.replace("/dashboard");
    } else if (isConnected && !isOnboarded && isNamesSettled) {
      // Only route to onboarding AFTER the on-chain name query has settled.
      // This prevents a false redirect when the user has a name registered
      // on-chain but localStorage was cleared (new browser / cleared cache).
      router.replace("/onboarding");
    }
  }, [isConnected, isOnboarded, isNamesSettled, isHydrated, address, router]);

  const handlePaySearch = () => {
    const name = searchName.trim().toLowerCase().replace(/\.tok$/, "");
    if (!name) return;
    router.push(`/pay/${name}`);
  };

  // Show loading spinner while hydrating OR while connected but name query is still in-flight
  // (prevents flash of landing page for returning users in new browser)
  if (!isHydrated || (isConnected && !address) || (isConnected && isOnboarded) || (isConnected && !isNamesSettled)) {
    return (
      <div className="min-h-screen bg-[#06080F] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="opacity-60">
            <DustLogo size={40} color="#00FF41" />
          </div>
          <p className="text-[14px] font-mono text-white/40">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes btn-glow {
          0%, 100% { box-shadow: 0 0 20px rgba(0,255,65,0.2), 0 0 60px rgba(0,255,65,0.06); }
          50% { box-shadow: 0 0 30px rgba(0,255,65,0.35), 0 0 80px rgba(0,255,65,0.1); }
        }
        .fade-up { animation: fade-up 0.8s cubic-bezier(0.16,1,0.3,1) forwards; opacity: 0; }
        .d1 { animation-delay: 0.1s; }
        .d2 { animation-delay: 0.25s; }
        .d3 { animation-delay: 0.4s; }
        .d4 { animation-delay: 0.55s; }
        .d5 { animation-delay: 0.7s; }
        .d6 { animation-delay: 0.85s; }
        .d7 { animation-delay: 1.0s; }

        .split-layout-text {
          font-family: var(--font-instrument-serif), serif;
          font-style: italic;
          font-weight: 400;
        }
      `}</style>

      <div className="min-h-screen bg-[#06080F] flex flex-col relative overflow-x-hidden">

        {/* Mobile Background Video */}
        <div className="absolute top-0 left-0 w-full h-full z-0 lg:hidden">
          <video
            autoPlay
            loop
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover brightness-[0.5]"
          >
            <source src="/bg.webm" type="video/webm" />
            <source src="/bg.mp4" type="video/mp4" />
          </video>
        </div>

        {/* Desktop Background Video */}
        <div className="absolute top-0 left-0 w-full h-full z-0 hidden lg:block">
          <video
            autoPlay
            loop
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover brightness-[0.65]"
          >
            <source src="/bg.webm" type="video/webm" />
            <source src="/bg.mp4" type="video/mp4" />
          </video>
        </div>

        {/* Header */}
        <header className="relative z-[100] px-5 py-5 md:px-10 md:py-8">
          <div className="w-full flex items-center justify-between">
            {/* Left: Logo */}
            <div className="flex items-center gap-3">
              <DustLogo size={40} color="#00FF41" />
              <div className="hidden sm:flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-widest text-white font-mono">DUST</span>
                <span className="text-[13px] font-bold font-mono tracking-[0.25em] text-[rgba(0,255,65,0.35)] uppercase">PROTOCOL</span>
              </div>
            </div>

            {/* Right: Docs + Connect Wallet */}
            <div className="flex items-center gap-3">
              <a
                href="/docs"
                className="hidden sm:flex items-center gap-1.5 px-4 py-2.5 border border-white/15 text-white/70 rounded-sm font-mono font-bold text-sm tracking-wider uppercase transition-all hover:border-[rgba(0,255,65,0.4)] hover:text-[#00FF41] hover:-translate-y-px backdrop-blur-sm"
              >
                Docs
              </a>
            <div className="flex flex-col items-end gap-1">
              <button
                className="flex items-center gap-2 px-4 md:px-5 py-2.5 bg-[#00FF41] text-[#06080F] rounded-sm font-mono font-bold text-sm tracking-wider uppercase cursor-pointer transition-all hover:-translate-y-px hover:shadow-[0_0_20px_rgba(0,255,65,0.4)] active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                style={{ animation: "btn-glow 3s ease-in-out infinite" }}
                onClick={handleConnect}
                disabled={isConnecting}
                title={!hasInjectedWallet && !hasPrivy ? "No wallet detected — click to install MetaMask" : undefined}
              >
                <WalletIcon size={16} color="#06080F" />
                {isConnecting ? "Connecting…" : !hasInjectedWallet && !hasPrivy ? "Install Wallet" : "Connect Wallet"}
              </button>
              {connectAttempted && connectError && (
                <p className="text-[10px] font-mono text-[#ff6b6b] whitespace-nowrap leading-none">
                  {connectError.message.includes("rejected") ? "Rejected — try again" : "Connection failed — try again"}
                </p>
              )}
            </div>
            </div>
          </div>
        </header>

        {/* Mobile Layout */}
        <div
          className="flex lg:hidden flex-col w-full px-6 pt-20 pb-12 gap-6 z-10 min-h-[calc(100vh-80px)] justify-end"
        >
          <div className="flex flex-col items-start gap-4 w-full">
            <div>
              <p
                className="text-[42px] text-white leading-[1.1] tracking-[-0.03em] mb-2"
                style={{
                  fontFamily: "var(--font-instrument-serif), serif",
                  textShadow: "0 4px 24px rgba(0,0,0,0.6)",
                }}
              >
                Private Transfers<br />and Privacy Swap
              </p>
              <p
                className="text-base text-white/85 leading-relaxed max-w-[300px]"
                style={{ textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}
              >
                Swap tokens anonymously without leaving a trace.
              </p>
            </div>

            {/* Pay Search Input */}
            <div className="flex items-center gap-2 w-full">
              <input
                className="flex-1 h-14 bg-[rgba(20,20,25,0.6)] border border-white/15 rounded-2xl text-white text-base px-5 backdrop-blur-lg placeholder:text-white/50 focus:border-[#00FF41] focus:outline-none focus:bg-[rgba(20,20,25,0.8)] transition-all"
                placeholder="username.tok"
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") handlePaySearch(); }}
              />
              <button
                className="w-14 h-14 shrink-0 bg-[#00FF41] rounded-2xl flex items-center justify-center shadow-[0_4px_12px_rgba(0,0,0,0.3)] hover:shadow-[0_0_20px_rgba(0,255,65,0.4)] transition-all"
                onClick={handlePaySearch}
              >
                <ArrowUpRightIcon size={24} color="#06080F" />
              </button>
            </div>
          </div>
        </div>

        {/* Desktop Layout (Split View) */}
        <div className="relative z-10 flex-1 hidden lg:flex flex-row w-full px-[60px] items-center justify-center min-h-[calc(100vh-100px)]">

          {/* Left Side: Privacy Transfers */}
          <div className="flex-1 flex flex-col gap-6 items-start justify-center text-left w-full">
            <div className="fade-up d1">
              <p
                className="text-[72px] text-white leading-[1.1] tracking-[-0.03em] mb-4"
                style={{ fontFamily: "var(--font-instrument-serif), serif" }}
              >
                <DecryptedText text="Private" animateOn="both" sequential revealDirection="start" speed={40} />
                <br />
                <DecryptedText text="Transfers" animateOn="both" sequential revealDirection="start" speed={40} />
              </p>
              <p className="text-base text-white/70 max-w-[320px] leading-relaxed">
                <DecryptedText text="Untraceable payments that dissolve into the blockchain." animateOn="both" sequential revealDirection="start" speed={20} />
              </p>
            </div>

            {/* Pay Search Input form */}
            <div className="flex flex-col gap-3 w-full max-w-[380px] items-start fade-up d2">
              <div className="flex items-center gap-2 w-full">
                <input
                  className="flex-1 h-14 bg-[rgba(0,0,0,0.4)] border border-white/15 rounded-sm text-white text-base px-5 font-mono backdrop-blur-lg placeholder:text-white/50 hover:border-[rgba(0,255,65,0.3)] focus:border-[#00FF41] focus:outline-none focus:bg-[rgba(0,0,0,0.6)] focus:shadow-[0_0_0_1px_rgba(0,255,65,0.2)] transition-all"
                  placeholder="username.tok"
                  value={searchName}
                  onChange={(e) => setSearchName(e.target.value)}
                  onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") handlePaySearch(); }}
                />
                <button
                  className="w-14 h-14 shrink-0 bg-white/10 border border-white/15 rounded-sm flex items-center justify-center cursor-pointer backdrop-blur-lg transition-all hover:bg-[#00FF41] hover:border-[#00FF41] hover:-translate-y-px"
                  onClick={handlePaySearch}
                >
                  <ArrowUpRightIcon size={20} color="white" />
                </button>
              </div>
              <p className="text-[11px] font-mono text-white/50 tracking-[0.05em] text-left w-full">
                ENTER A USERNAME TO PAY
              </p>
            </div>
          </div>

          {/* Right Side: Privacy Swap */}
          <div className="flex-1 flex flex-col gap-6 items-end justify-center text-right">
            <div className="fade-up d3">
              <p
                className="text-[72px] text-white leading-[1.1] tracking-[-0.03em] mb-4"
                style={{ fontFamily: "var(--font-instrument-serif), serif" }}
              >
                <DecryptedText text="Privacy" animateOn="both" sequential revealDirection="start" speed={40} />
                <br />
                <DecryptedText text="Swap" animateOn="both" sequential revealDirection="start" speed={40} />
              </p>
              <p className="text-base text-white/70 max-w-[320px] leading-relaxed ml-auto">
                <DecryptedText text="Swap tokens anonymously without leaving a trace." animateOn="both" sequential revealDirection="start" speed={20} />
              </p>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="absolute bottom-5 left-0 w-full flex items-center justify-center gap-4 z-10 pointer-events-none">
          <p className="text-white/50 text-[11px] font-mono">
            &copy; 2026 Dust Protocol. All rights reserved.
          </p>
          <a
            href="https://x.com/DustProtocolApp"
            target="_blank"
            rel="noopener noreferrer"
            className="pointer-events-auto text-white/40 hover:text-[#00FF41] text-[11px] font-mono uppercase tracking-wider transition-colors"
          >
            Follow us on X
          </a>
        </div>

      </div>
    </>
  );
}
