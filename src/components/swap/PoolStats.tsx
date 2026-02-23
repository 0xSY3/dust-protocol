'use client'

import { DollarSignIcon, ShieldIcon, BarChart3Icon } from 'lucide-react'
import { ETHIcon, USDCIcon } from '@/components/stealth/icons'

interface PoolStatsProps {
  currentPrice: number | null
  ethReserve: number
  usdcReserve: number
  totalValueLocked: number
  isLoading: boolean
  poolTick?: number
}

function formatNumber(num: number, decimals: number = 2): string {
  if (num >= 1e9) return `${(num / 1e9).toFixed(decimals)}B`
  if (num >= 1e6) return `${(num / 1e6).toFixed(decimals)}M`
  if (num >= 1e3) return `${(num / 1e3).toFixed(decimals)}K`
  if (num < 0.01 && num > 0) return num.toFixed(6)
  return num.toFixed(decimals)
}

const cardClass =
  'flex-1 p-3 rounded-sm border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] backdrop-blur-sm flex flex-col items-center justify-center gap-1.5 group hover:border-[rgba(0,255,65,0.2)] transition-colors text-center'

const labelClass =
  'text-xs text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono'

const iconClass =
  'w-4 h-4 text-[rgba(255,255,255,0.4)] group-hover:text-[#00FF41] transition-colors'

export function PoolStats({
  currentPrice,
  ethReserve,
  usdcReserve,
  totalValueLocked,
  isLoading,
  poolTick,
}: PoolStatsProps) {
  const ethValue = ethReserve * (currentPrice ?? 0)
  const totalValue =
    totalValueLocked > 0 ? totalValueLocked : ethValue + usdcReserve
  const ethPercent = totalValue > 0 ? (ethValue / totalValue) * 100 : 50
  const usdcPercent = 100 - ethPercent

  if (isLoading) {
    return (
      <div className="flex flex-row md:flex-col gap-2 md:gap-3 w-full md:w-[180px] md:h-full">
        {[0, 1, 2].map((i) => (
          <div key={i} className={cardClass}>
            <div className="h-2 w-12 bg-[rgba(255,255,255,0.06)] rounded animate-pulse" />
            <div className="h-3 w-16 bg-[rgba(255,255,255,0.04)] rounded animate-pulse" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-row md:flex-col gap-2 md:gap-3 w-full md:w-[180px] md:h-full" style={{ minHeight: 'inherit' }}>
      {/* TVL Card */}
      <div className={cardClass}>
        <div className="flex items-center gap-1.5">
          <DollarSignIcon className={iconClass} />
          <span className={labelClass}>TVL</span>
        </div>
        <span className="text-base font-bold text-white font-mono tracking-tight">
          ${formatNumber(totalValue)}
        </span>
      </div>

      {/* Notes / Composition Card */}
      <div className={cardClass}>
        <div className="flex items-center gap-1.5">
          <ShieldIcon className={iconClass} />
          <span className={labelClass}>Notes</span>
        </div>
        <div className="flex flex-col gap-1 mt-0.5 w-full">
          <div className="flex gap-0.5 h-1.5 w-full rounded-full overflow-hidden bg-[rgba(255,255,255,0.1)]">
            <div
              className="bg-[#00FF41] opacity-80 transition-all duration-500"
              style={{ width: `${ethPercent.toFixed(1)}%` }}
            />
            <div
              className="bg-[rgba(255,255,255,0.3)] transition-all duration-500"
              style={{ width: `${usdcPercent.toFixed(1)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] font-mono text-[rgba(255,255,255,0.3)]">
            <span className="flex items-center gap-1"><ETHIcon size={12} /> {formatNumber(ethReserve, 2)}</span>
            <span className="flex items-center gap-1"><USDCIcon size={12} /> {formatNumber(usdcReserve, 0)}</span>
          </div>
        </div>
      </div>

      {/* Oracle Price Card */}
      <div className={cardClass}>
        <div className="flex items-center gap-1.5">
          <BarChart3Icon className={iconClass} />
          <span className={labelClass}>Oracle</span>
        </div>
        <div className="text-sm font-bold text-white font-mono tracking-tight">
          <div className="hidden md:flex flex-col items-center gap-0.5">
            <span className="flex items-center gap-1">1 <ETHIcon size={14} /></span>
            <span>≈ {currentPrice != null ? formatNumber(currentPrice, 2) : '—'}</span>
            <USDCIcon size={14} />
          </div>
          <span className="md:hidden flex items-center gap-1">1 <ETHIcon size={12} /> ≈ {currentPrice != null ? formatNumber(currentPrice, 0) : '—'} <USDCIcon size={12} /></span>
        </div>
        {poolTick !== undefined && (
          <span className="text-[10px] text-[rgba(255,255,255,0.3)] font-mono">
            tick {poolTick}
          </span>
        )}
      </div>
    </div>
  )
}
