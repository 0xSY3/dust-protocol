'use client'

import { ETHIcon, USDCIcon } from '@/components/stealth/icons'

interface PoolCompositionProps {
  ethReserve: string
  usdcReserve: string
  shieldedEth: string
  shieldedUsdc: string
  currentPrice: number | null
}

function formatReserve(value: number, isUsdc: boolean): string {
  if (!isFinite(value) || isNaN(value)) return '—'
  if (isUsdc) {
    if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
    if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`
    return value.toFixed(0)
  }
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`
  if (value < 0.01 && value > 0) return value.toFixed(4)
  return value.toFixed(2)
}

export function PoolComposition({ ethReserve, usdcReserve, shieldedEth, shieldedUsdc, currentPrice }: PoolCompositionProps) {
  const totalEth = (parseFloat(ethReserve) || 0) + (parseFloat(shieldedEth) || 0)
  const totalUsdc = (parseFloat(usdcReserve) || 0) + (parseFloat(shieldedUsdc) || 0)

  // Convert to USD for meaningful bar percentages
  const ethUsdValue = totalEth * (currentPrice ?? 0)
  const totalUsd = ethUsdValue + totalUsdc
  const ethPct = totalUsd > 0 ? Math.round((ethUsdValue / totalUsd) * 100) : 50
  const usdcPct = 100 - ethPct

  return (
    <div className="w-full md:w-[180px] p-4 rounded-sm border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] backdrop-blur-sm flex flex-col md:h-full">
      <div className="flex items-center justify-center gap-1.5 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-[#00FF41] animate-pulse" />
        <span className="text-xs text-[rgba(255,255,255,0.4)] uppercase tracking-widest font-mono">
          Pool
        </span>
      </div>

      {/* Vertical Bar — desktop only */}
      <div className="hidden md:flex flex-1 flex-col items-center gap-2">
        <div className="relative w-8 flex-1 min-h-[120px] rounded-full overflow-hidden bg-[rgba(255,255,255,0.05)] flex flex-col-reverse">
          <div
            className="w-full bg-[#00FF41] opacity-60 transition-all duration-700 ease-out"
            style={{ height: `${ethPct}%` }}
          />
          <div className="w-full h-[2px] bg-[#06080F] z-10 shrink-0" />
          <div
            className="w-full bg-[rgba(255,255,255,0.2)] transition-all duration-700 ease-out"
            style={{ height: `${usdcPct}%` }}
          />
        </div>
      </div>

      {/* Horizontal Bar — mobile only */}
      <div className="md:hidden flex flex-col gap-2 w-full">
        <div className="flex gap-0.5 h-3 w-full rounded-full overflow-hidden bg-[rgba(255,255,255,0.05)]">
          <div
            className="bg-[#00FF41] opacity-60 transition-all duration-700 ease-out rounded-l-full"
            style={{ width: `${ethPct}%` }}
          />
          <div
            className="bg-[rgba(255,255,255,0.2)] transition-all duration-700 ease-out rounded-r-full"
            style={{ width: `${usdcPct}%` }}
          />
        </div>
        <div className="flex justify-between text-[11px] font-mono">
          <div className="flex items-center gap-1.5">
            <ETHIcon size={14} />
            <span className="text-[rgba(255,255,255,0.7)] font-bold">{formatReserve(totalEth, false)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <USDCIcon size={14} />
            <span className="text-[rgba(255,255,255,0.7)] font-bold">{formatReserve(totalUsdc, true)}</span>
          </div>
        </div>
      </div>

      {/* Labels — desktop only */}
      <div className="hidden md:flex flex-col gap-2 mt-3 text-xs font-mono items-center">
        <div className="flex items-center gap-1.5">
          <ETHIcon size={16} />
          <span className="text-[rgba(255,255,255,0.7)] font-bold">
            {formatReserve(totalEth, false)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <USDCIcon size={16} />
          <span className="text-[rgba(255,255,255,0.7)] font-bold">
            {formatReserve(totalUsdc, true)}
          </span>
        </div>
      </div>
    </div>
  )
}
