"use client";

import { useState } from "react";
import { SwapCard } from "@/components/swap/SwapCard";
import { V2SwapCard } from "@/components/swap/V2SwapCard";
import { PoolStats } from "@/components/swap/PoolStats";
import { PoolComposition } from "@/components/swap/PoolComposition";
import { usePoolStats } from "@/hooks/swap/usePoolStats";
import { useAuth } from "@/contexts/AuthContext";

type SwapMode = "v2" | "v1";

export default function SwapPage() {
  const [mode, setMode] = useState<SwapMode>("v2");
  const { activeChainId } = useAuth();

  const {
    currentPrice,
    ethReserve,
    usdcReserve,
    totalValueLocked,
    isLoading,
    tick,
  } = usePoolStats();

  const poolStatsProps = {
    currentPrice,
    ethReserve,
    usdcReserve,
    totalValueLocked,
    isLoading,
    poolTick: tick !== undefined ? tick : undefined,
  };

  return (
    <div className="w-full flex flex-col items-center gap-2 px-6 pb-12 pt-8">
      {/* Header */}
      <div className="text-center mb-4">
        <h1 className="text-3xl md:text-4xl font-bold tracking-widest text-white font-mono mb-2">
          {mode === "v2" ? "STEALTH_POOL" : "STEALTH_SWAP"}
        </h1>
        <p className="text-sm text-[rgba(255,255,255,0.4)] font-mono tracking-wide">
          {mode === "v2"
            ? "Shield, unshield & transfer via ZK proofs"
            : "Private, slippage-free swaps via ZK proofs"}
        </p>
      </div>

      {/* Mode Toggle */}
      <div className="flex items-center gap-1 p-1 rounded-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] mb-4">
        <button
          onClick={() => setMode("v2")}
          className={`px-4 py-1.5 rounded-sm text-xs font-bold font-mono tracking-wider transition-all ${
            mode === "v2"
              ? "bg-[rgba(0,255,65,0.12)] border border-[rgba(0,255,65,0.3)] text-[#00FF41] shadow-[0_0_10px_rgba(0,255,65,0.08)]"
              : "border border-transparent text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.6)]"
          }`}
        >
          V2 POOL
        </button>
        <button
          onClick={() => setMode("v1")}
          className={`px-4 py-1.5 rounded-sm text-xs font-bold font-mono tracking-wider transition-all ${
            mode === "v1"
              ? "bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.12)] text-white"
              : "border border-transparent text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.6)]"
          }`}
        >
          SWAP
          <span className="ml-1.5 text-[9px] text-[rgba(255,255,255,0.3)]">LEGACY</span>
        </button>
      </div>

      {/* V2 Pool Mode */}
      {mode === "v2" && (
        <V2SwapCard chainId={activeChainId} />
      )}

      {/* V1 Legacy Swap Mode */}
      {mode === "v1" && (
        <>
          {/* Main Row: Stats | Card | Composition — desktop */}
          <div className="flex items-stretch justify-center gap-5 w-full max-w-[1100px]">
            <div className="hidden md:flex">
              <PoolStats {...poolStatsProps} />
            </div>
            <SwapCard />
            <div className="hidden md:flex">
              <PoolComposition
                ethReserve={ethReserve.toString()}
                usdcReserve={usdcReserve.toString()}
              />
            </div>
          </div>

          {/* Mobile: Stats and Composition below card */}
          <div className="flex flex-col items-center gap-3 md:hidden w-full">
            <PoolStats {...poolStatsProps} />
            <PoolComposition
              ethReserve={ethReserve.toString()}
              usdcReserve={usdcReserve.toString()}
            />
          </div>
        </>
      )}
    </div>
  );
}
