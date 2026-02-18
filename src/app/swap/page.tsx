"use client";

import { SwapCard } from "@/components/swap/SwapCard";
import { PoolStats } from "@/components/swap/PoolStats";
import { PoolComposition } from "@/components/swap/PoolComposition";
import { usePoolStats } from "@/hooks/swap/usePoolStats";

export default function SwapPage() {
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
      <div className="text-center mb-6">
        <h1 className="text-3xl md:text-4xl font-bold tracking-widest text-white font-mono mb-2">
          STEALTH_SWAP
        </h1>
        <p className="text-sm text-[rgba(255,255,255,0.4)] font-mono tracking-wide">
          Private, slippage-free swaps via ZK proofs
        </p>
      </div>

      {/* Main Row: Stats | Card | Composition — desktop */}
      <div className="flex items-stretch justify-center gap-5 w-full max-w-[1100px]">
        {/* Left: Pool Stats */}
        <div className="hidden md:flex">
          <PoolStats {...poolStatsProps} />
        </div>

        {/* Center: Swap Card */}
        <SwapCard />

        {/* Right: Pool Composition */}
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
