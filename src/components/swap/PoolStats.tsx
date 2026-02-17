'use client'

import { DollarSignIcon, ShieldIcon, BarChart3Icon } from 'lucide-react'

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
  'flex-1 p-3 rounded-sm border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] backdrop-blur-sm flex flex-col justify-center gap-1.5 group hover:border-[rgba(0,255,65,0.2)] transition-colors'

const labelClass =
  'text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono'

const iconClass =
  'w-3 h-3 text-[rgba(255,255,255,0.4)] group-hover:text-[#00FF41] transition-colors'

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
      <div className="flex flex-col gap-3 w-[130px] h-full">
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
    <div className="flex flex-col gap-3 w-[130px] h-full">
      {/* TVL Card */}
      <div className={cardClass}>
        <div className="flex items-center gap-1.5">
          <DollarSignIcon className={iconClass} />
          <span className={labelClass}>TVL</span>
        </div>
        <span className="text-xs font-bold text-white font-mono tracking-tight">
          ${formatNumber(totalValue)}
        </span>
      </div>

      {/* Notes / Composition Card */}
      <div className={cardClass}>
        <div className="flex items-center gap-1.5">
          <ShieldIcon className={iconClass} />
          <span className={labelClass}>Notes</span>
        </div>
        <div className="flex flex-col gap-1 mt-0.5">
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
          <div className="flex justify-between text-[8px] font-mono text-[rgba(255,255,255,0.3)]">
            <span>{formatNumber(ethReserve, 2)} E</span>
            <span>{formatNumber(usdcReserve, 0)} U</span>
          </div>
        </div>
      </div>

      {/* Oracle Price Card */}
      <div className={cardClass}>
        <div className="flex items-center gap-1.5">
          <BarChart3Icon className={iconClass} />
          <span className={labelClass}>Oracle</span>
        </div>
        <span className="text-[10px] font-bold text-white font-mono tracking-tight leading-relaxed">
          1 ETH
          <br />≈ {currentPrice != null ? formatNumber(currentPrice, 2) : '—'}
          <br />
          USDC
        </span>
        {poolTick !== undefined && (
          <span className="text-[8px] text-[rgba(255,255,255,0.3)] font-mono">
            tick {poolTick}
          </span>
        )}
      </div>
    </div>
  )
}
