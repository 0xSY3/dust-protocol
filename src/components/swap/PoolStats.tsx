'use client'

import { DollarSignIcon, ShieldIcon, BarChart3Icon } from 'lucide-react'
import { ETHIcon, USDCIcon } from '@/components/stealth/icons'

interface PoolStatsProps {
  currentPrice: number | null
  ethReserve: number
  usdcReserve: number
  totalValueLocked: number
  shieldedEth: number
  shieldedUsdc: number
  noteCount: number
  combinedTvl: number
  isLoading: boolean
  poolTick?: number
  priceSource?: 'chainlink' | 'pool'
}

function formatNumber(num: number, decimals: number = 2): string {
  if (!isFinite(num) || isNaN(num)) return '—'
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
  shieldedEth,
  shieldedUsdc,
  noteCount,
  combinedTvl,
  isLoading,
  poolTick,
  priceSource,
}: PoolStatsProps) {
  // Composition bar based on shielded reserves (privacy pool)
  const shieldedEthValue = shieldedEth * (currentPrice ?? 0)
  const shieldedTotal = shieldedEthValue + shieldedUsdc
  const ethPercent = shieldedTotal > 0 ? (shieldedEthValue / shieldedTotal) * 100 : 50
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
      {/* TVL Card — combined privacy pool + swap pool */}
      <div className={cardClass}>
        <div className="flex items-center gap-1.5">
          <DollarSignIcon className={iconClass} />
          <span className={labelClass}>TVL</span>
        </div>
        <span className="text-base font-bold text-white font-mono tracking-tight">
          ${formatNumber(combinedTvl)}
        </span>
      </div>

      {/* Shielded — privacy pool composition + note count */}
      <div className={cardClass}>
        <div className="flex items-center gap-1.5">
          <ShieldIcon className={iconClass} />
          <span className={labelClass}>Shielded</span>
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
            <span className="flex items-center gap-1"><ETHIcon size={12} /> {formatNumber(shieldedEth, 4)}</span>
            <span className="flex items-center gap-1"><USDCIcon size={12} /> {formatNumber(shieldedUsdc, 0)}</span>
          </div>
          <div className="text-center text-[10px] font-mono text-[rgba(255,255,255,0.25)] mt-0.5">
            {noteCount} note{noteCount !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Oracle Price Card */}
      <div className={cardClass}>
        <div className="flex items-center gap-1.5">
          <BarChart3Icon className={iconClass} />
          <span className={labelClass}>Oracle</span>
          {priceSource && (
            <span className={`text-[8px] font-mono px-1 py-0.5 rounded-sm ${priceSource === 'chainlink' ? 'text-[#00FF41] bg-[rgba(0,255,65,0.08)]' : 'text-[rgba(255,255,255,0.3)] bg-[rgba(255,255,255,0.04)]'}`}>
              {priceSource === 'chainlink' ? 'CHAINLINK' : 'POOL'}
            </span>
          )}
        </div>
        <div className="text-sm font-bold text-white font-mono tracking-tight">
          <div className="hidden md:flex flex-col items-center gap-0.5">
            <span className="flex items-center gap-1">1 <ETHIcon size={14} /></span>
            <span>≈ {currentPrice != null ? formatNumber(currentPrice, 2) : '—'}</span>
            <USDCIcon size={14} />
          </div>
          <span className="md:hidden flex items-center gap-1">1 <ETHIcon size={12} /> ≈ {currentPrice != null ? formatNumber(currentPrice, 2) : '—'} <USDCIcon size={12} /></span>
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
