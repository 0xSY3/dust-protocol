"use client";

import { useState, useEffect, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { WalletIcon, ArrowUpRightIcon, MailIcon } from "@/components/stealth/icons";
import { DustLogo } from "@/components/DustLogo";
import { useLogin } from "@privy-io/react-auth";
import { isPrivyEnabled } from "@/config/privy";
import { useConnect } from "wagmi";
import { injected } from "wagmi/connectors";
import Image from "next/image";

import { SpiritPortal } from "@/components/SpiritPortal";

// One-time cleanup of stale cache data from previous sessions
function cleanupCorruptedStorage() {
  if (typeof window === "undefined") return;
  const CURRENT_VERSION = 6;
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

  if (stored < 6) {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("tokamak_stealth_keys_") || key?.startsWith("dust_pin_")) {
        const addr = key.replace("tokamak_stealth_keys_", "").replace("dust_pin_", "");
        const onboardedKey = "dust_onboarded_" + addr;
        if (!localStorage.getItem(onboardedKey)) {
          localStorage.setItem(onboardedKey, "true");
        }
      }
    }
  }

  localStorage.setItem(flag, String(CURRENT_VERSION));
}

// Inline SVG icons for social providers (not in icon library)
const GoogleIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

const FarcasterIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M5.5 3h13v18h-2.25v-7.5a4.25 4.25 0 0 0-8.5 0V21H5.5V3z" fill="#855DCD" />
    <path d="M3 5.5L5.5 3h13L21 5.5H3z" fill="#855DCD" />
  </svg>
);

export default function Home() {
  const { isConnected, isOnboarded, isHydrated, address } = useAuth();
  const { login: privyLogin } = useLogin();
  const { connect } = useConnect();
  const router = useRouter();
  const [searchName, setSearchName] = useState("");
  const hasPrivy = isPrivyEnabled;

  useEffect(() => { cleanupCorruptedStorage(); }, []);

  useEffect(() => {
    if (!isHydrated) return;
    if (isConnected && !address) return;
    if (isConnected && isOnboarded) {
      router.replace("/dashboard");
    } else if (isConnected && !isOnboarded) {
      router.replace("/onboarding");
    }
  }, [isConnected, isOnboarded, isHydrated, address, router]);

  const handlePaySearch = () => {
    const name = searchName.trim().toLowerCase().replace(/\.tok$/, "");
    if (!name) return;
    router.push(`/pay/${name}`);
  };

  if (!isHydrated || (isConnected && !address) || (isConnected && isOnboarded)) {
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

        {/* Mobile Background Image */}
        <div className="absolute top-0 left-0 w-full h-full z-0 lg:hidden opacity-60">
          <Image
            src="/mobile.png"
            alt="Background"
            fill
            priority
            style={{ objectFit: "cover", objectPosition: "center" }}
            quality={90}
          />
        </div>

        {/* Dust Spirit Portal (Desktop Only) */}
        <div className="hidden lg:block">
          <SpiritPortal />
        </div>

        {/* Header */}
        <header className="relative z-[100] px-5 py-5 md:px-10 md:py-8">
          <div className="w-full flex items-center justify-between">
            {/* Left: Logo */}
            <div className="flex items-center gap-3">
              <DustLogo size={32} color="#00FF41" />
              <div className="hidden sm:flex items-baseline gap-1.5">
                <span
                  className="text-2xl font-normal text-white tracking-tight"
                  style={{ fontFamily: "var(--font-instrument-serif), serif" }}
                >
                  Dust
                </span>
                <span
                  className="text-2xl font-normal text-white/50 tracking-tight"
                  style={{ fontFamily: "var(--font-instrument-serif), serif" }}
                >
                  Protocol
                </span>
              </div>
            </div>

            {/* Right: Connect & Auth */}
            <div className="flex items-center gap-4">
              {hasPrivy && !isConnected && (
                <div className="flex items-center gap-2">
                  {[
                    { icon: GoogleIcon, method: "google" as const },
                    { icon: MailIcon, method: "email" as const },
                    { icon: FarcasterIcon, method: "farcaster" as const },
                  ].map((opt) => (
                    <button
                      key={opt.method}
                      className="w-10 h-10 bg-white/5 border border-white/10 rounded-full flex items-center justify-center cursor-pointer transition-all hover:bg-white/10 hover:border-white/20 hover:-translate-y-px"
                      onClick={() => privyLogin({ loginMethods: [opt.method] })}
                    >
                      <opt.icon size={16} />
                    </button>
                  ))}
                </div>
              )}
              {/* Manual Connect Button */}
              <button
                className="flex items-center gap-2 px-4 md:px-5 py-2.5 bg-[#00FF41] text-[#06080F] rounded-sm font-mono font-bold text-sm tracking-wider uppercase cursor-pointer transition-all hover:-translate-y-px hover:shadow-[0_0_20px_rgba(0,255,65,0.4)] active:translate-y-0"
                style={{ animation: "btn-glow 3s ease-in-out infinite" }}
                onClick={() => connect({ connector: injected() })}
              >
                <WalletIcon size={16} color="#06080F" />
                Connect
              </button>
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
                Private<br />Transfers
              </p>
              <p className="text-base text-white/70 max-w-[320px] leading-relaxed">
                Untraceable payments that dissolve into the blockchain.
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
                Privacy<br />Swap
              </p>
              <p className="text-base text-white/70 max-w-[320px] leading-relaxed ml-auto">
                Swap tokens anonymously without leaving a trace.
              </p>
            </div>

            {/* Coming Soon pill */}
            <div className="fade-up d4 px-6 py-3 rounded-full border border-white/15 bg-white/5 backdrop-blur-md">
              <p className="text-[13px] font-mono text-white/60 tracking-[0.1em]">
                COMING_SOON
              </p>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="absolute bottom-5 left-0 w-full text-center z-10 pointer-events-none">
          <p className="text-white/50 text-[11px] font-mono">
            &copy; 2026 Dust Protocol. All rights reserved.
          </p>
        </div>

      </div>
    </>
  );
}
