'use client'

interface PoolCompositionProps {
  ethReserve: string
  usdcReserve: string
}

function formatReserve(value: string, isUsdc: boolean): string {
  const num = parseFloat(value)
  if (isNaN(num)) return '—'
  if (isUsdc) {
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`
    if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`
    return num.toFixed(0)
  }
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`
  if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`
  return num.toFixed(2)
}

export function PoolComposition({ ethReserve, usdcReserve }: PoolCompositionProps) {
  const ethNum = parseFloat(ethReserve) || 0
  const usdcNum = parseFloat(usdcReserve) || 0

  // Compute relative heights for the bar (normalized to total value)
  // Use raw values for visual ratio — ETH on bottom (green), USDC on top (white)
  const total = ethNum + usdcNum
  const ethPct = total > 0 ? Math.round((ethNum / total) * 100) : 45
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
            <div className="w-2 h-2 rounded-sm bg-[#00FF41] opacity-60 shrink-0" />
            <span className="text-[rgba(255,255,255,0.7)] font-bold">{formatReserve(ethReserve, false)}</span>
            <span className="text-[rgba(255,255,255,0.3)]">ETH</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-sm bg-[rgba(255,255,255,0.2)] shrink-0" />
            <span className="text-[rgba(255,255,255,0.7)] font-bold">{formatReserve(usdcReserve, true)}</span>
            <span className="text-[rgba(255,255,255,0.3)]">USDC</span>
          </div>
        </div>
      </div>

      {/* Labels — desktop only */}
      <div className="hidden md:flex flex-col gap-2 mt-3 text-xs font-mono items-center">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-sm bg-[#00FF41] opacity-60 shrink-0" />
          <div className="flex flex-col items-center">
            <span className="text-[rgba(255,255,255,0.7)] font-bold">
              {formatReserve(ethReserve, false)}
            </span>
            <span className="text-[rgba(255,255,255,0.3)]">ETH</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-sm bg-[rgba(255,255,255,0.2)] shrink-0" />
          <div className="flex flex-col items-center">
            <span className="text-[rgba(255,255,255,0.7)] font-bold">
              {formatReserve(usdcReserve, true)}
            </span>
            <span className="text-[rgba(255,255,255,0.3)]">USDC</span>
          </div>
        </div>
      </div>
    </div>
  )
}
