import { useState, useCallback, useRef, useMemo, type RefObject } from 'react'
import { useChainId } from 'wagmi'
import { proveCompliance, type ComplianceResult } from '@/lib/dustpool/v2/compliance-flow'
import type { V2Keys } from '@/lib/dustpool/v2/types'

export type ComplianceProofStatus =
  | 'idle'
  | 'fetching-witness'
  | 'generating-proof'
  | 'submitting'
  | 'done'
  | 'error'

export function useV2ComplianceProof(
  keysRef: RefObject<V2Keys | null>,
  chainIdOverride?: number
) {
  const wagmiChainId = useChainId()
  const chainId = chainIdOverride ?? wagmiChainId

  const [isPending, setIsPending] = useState(false)
  const [status, setStatus] = useState<ComplianceProofStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ComplianceResult | null>(null)
  const provingRef = useRef(false)

  const prove = useCallback(async (
    commitment: bigint,
    leafIndex: number
  ) => {
    const keys = keysRef.current
    if (!keys) { setError('Keys not available — verify PIN first'); return }
    if (provingRef.current) return

    provingRef.current = true
    setIsPending(true)
    setError(null)
    setResult(null)
    setStatus('fetching-witness')

    try {
      const complianceResult = await proveCompliance(
        commitment,
        leafIndex,
        keys.nullifierKey,
        chainId,
        (s) => setStatus(s as ComplianceProofStatus)
      )

      setResult(complianceResult)
      setStatus('done')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Compliance proof failed'
      setError(msg)
      setStatus('error')
    } finally {
      setIsPending(false)
      provingRef.current = false
    }
  }, [chainId, keysRef])

  const clearError = useCallback(() => {
    setError(null)
    setResult(null)
    setStatus('idle')
  }, [])

  return useMemo(
    () => ({ prove, isPending, status, error, result, clearError }),
    [prove, isPending, status, error, result, clearError]
  )
}
