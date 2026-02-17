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

  return (
    <div className="min-h-screen p-4 md:p-8 relative">
      {/* Page header */}
      <div className="max-w-[900px] mx-auto mb-8">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-[#00FF41] animate-pulse shrink-0" />
          <h1 className="text-2xl font-bold font-mono text-white tracking-tight">
            PRIVACY_SWAP
          </h1>
        </div>
        <p className="text-sm font-mono text-[rgba(255,255,255,0.4)] pl-4">
          Swap tokens privately using zero-knowledge proofs. Outputs are sent to stealth addresses.
        </p>
      </div>

      {/* Main content — mobile: stacked, desktop: three-column row */}
      <div className="max-w-[900px] mx-auto">
        {/* Desktop layout */}
        <div className="hidden lg:flex items-start gap-4 justify-center">
          {/* Left column: PoolStats (~240px container, component renders at 130px) */}
          <div className="w-[240px] flex justify-end">
            <PoolStats
              currentPrice={currentPrice}
              ethReserve={ethReserve}
              usdcReserve={usdcReserve}
              totalValueLocked={totalValueLocked}
              isLoading={isLoading}
              poolTick={tick !== undefined ? tick : undefined}
            />
          </div>

          {/* Center column: SwapCard */}
          <div className="flex-1 flex justify-center">
            <SwapCard />
          </div>

          {/* Right column: PoolComposition (80px) */}
          <div className="w-[80px]">
            <PoolComposition
              ethReserve={ethReserve.toString()}
              usdcReserve={usdcReserve.toString()}
            />
          </div>
        </div>

        {/* Mobile layout: SwapCard first, stats below */}
        <div className="flex flex-col items-center gap-6 lg:hidden">
          <SwapCard />

          <div className="flex gap-4 w-full max-w-[480px]">
            {/* PoolStats — horizontal on mobile */}
            <div className="flex-1">
              <PoolStats
                currentPrice={currentPrice}
                ethReserve={ethReserve}
                usdcReserve={usdcReserve}
                totalValueLocked={totalValueLocked}
                isLoading={isLoading}
                poolTick={tick !== undefined ? tick : undefined}
              />
            </div>

            {/* PoolComposition */}
            <div className="w-[80px] self-stretch">
              <PoolComposition
                ethReserve={ethReserve.toString()}
                usdcReserve={usdcReserve.toString()}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
