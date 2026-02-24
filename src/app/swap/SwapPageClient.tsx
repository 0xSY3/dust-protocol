"use client";

import { useState } from "react";
import { SwapCard } from "@/components/swap/SwapCard";
import { SwapV2Card } from "@/components/swap/SwapV2Card";
import { PoolStats } from "@/components/swap/PoolStats";
import { PoolComposition } from "@/components/swap/PoolComposition";
import { usePoolStats } from "@/hooks/swap/usePoolStats";

type SwapVersion = "v2" | "v1";

export default function SwapPageClient() {
  const [version, setVersion] = useState<SwapVersion>("v2");
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
          STEALTH_SWAP
        </h1>
        <p className="text-sm text-[rgba(255,255,255,0.4)] font-mono tracking-wide">
          Private, slippage-free token swaps via ZK proofs
        </p>
      </div>

      {/* Version toggle */}
      <div className="flex items-center gap-1 p-0.5 rounded-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] mb-3">
        <button
          onClick={() => setVersion("v2")}
          className={`px-4 py-1.5 rounded-sm text-[11px] font-bold font-mono tracking-wider transition-all ${
            version === "v2"
              ? "bg-[rgba(0,255,65,0.12)] border border-[rgba(0,255,65,0.3)] text-[#00FF41]"
              : "border border-transparent text-[rgba(255,255,255,0.35)] hover:text-[rgba(255,255,255,0.6)]"
          }`}
        >
          V2 (UTXO)
        </button>
        <button
          onClick={() => setVersion("v1")}
          className={`px-4 py-1.5 rounded-sm text-[11px] font-bold font-mono tracking-wider transition-all ${
            version === "v1"
              ? "bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.15)] text-white"
              : "border border-transparent text-[rgba(255,255,255,0.35)] hover:text-[rgba(255,255,255,0.6)]"
          }`}
        >
          V1 (Legacy)
        </button>
      </div>

      {/* Main Row: Stats | Card | Composition — desktop */}
      <div className="flex items-stretch justify-center gap-5 w-full max-w-[1100px]">
        <div className="hidden md:flex">
          <PoolStats {...poolStatsProps} />
        </div>
        {version === "v2" ? <SwapV2Card /> : <SwapCard />}
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
    </div>
  );
}
