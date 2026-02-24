"use client";

import { useAuth } from "@/contexts/AuthContext";
import { V2SwapCard } from "@/components/swap/V2SwapCard";
import { PoolStats } from "@/components/swap/PoolStats";
import { PoolComposition } from "@/components/swap/PoolComposition";
import { usePoolStats } from "@/hooks/swap/usePoolStats";

function PoolStatsSection({ chainId }: { chainId: number }) {
  const stats = usePoolStats(chainId);

  if (stats.error) return null;

  return (
    <div className="flex flex-col md:flex-row gap-3 w-full">
      <PoolComposition
        ethReserve={stats.ethReserve.toString()}
        usdcReserve={stats.usdcReserve.toString()}
      />
      <div className="flex-1 flex flex-row md:flex-col gap-2">
        <PoolStats
          currentPrice={stats.currentPrice}
          ethReserve={stats.ethReserve}
          usdcReserve={stats.usdcReserve}
          totalValueLocked={stats.totalValueLocked}
          isLoading={stats.isLoading}
          poolTick={stats.tick}
        />
      </div>
    </div>
  );
}

export default function PoolsPageClient() {
  const { activeChainId } = useAuth();

  return (
    <div className="min-h-screen p-4 md:p-8 relative">
      <div className="max-w-[900px] mx-auto flex flex-col gap-6">
        <div>
          <h1 className="text-[28px] font-bold text-white tracking-tight mb-1 font-mono">[Privacy Pools]</h1>
          <p className="text-sm text-[rgba(255,255,255,0.5)] font-mono">Manage your shielded balances</p>
        </div>

        <div className="flex flex-col gap-4">
          <div className="p-3 rounded-sm bg-[rgba(0,255,65,0.04)] border border-[rgba(0,255,65,0.12)]">
            <p className="text-[12px] text-[rgba(255,255,255,0.4)] leading-relaxed font-mono">
              Deposit any amount of ETH into a single global pool. Transfer privately between users with hidden amounts,
              or withdraw to a fresh address with no link to the depositor. All operations use ZK proofs (FFLONK).
            </p>
          </div>

          <PoolStatsSection chainId={activeChainId} />

          <div className="flex justify-center mt-1">
            <V2SwapCard chainId={activeChainId} />
          </div>
        </div>
      </div>
    </div>
  );
}
