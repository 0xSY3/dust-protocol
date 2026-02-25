import { useState, useCallback, type RefObject } from 'react'
import { useAccount, useChainId } from 'wagmi'
import {
  deriveViewKey, serializeViewKey, serializeScopedViewKey,
  type ViewKey, type ScopedViewKey,
} from '@/lib/dustpool/v2/viewkey'
import {
  generateDisclosureReport,
  verifyDisclosureReport,
  formatReportCSV,
  formatReportJSON,
  type DisclosureReport,
  type DisclosureOptions,
  type VerificationResult,
} from '@/lib/dustpool/v2/disclosure'
import { openV2Database, getUnspentNotes, storedToNoteCommitment } from '@/lib/dustpool/v2/storage'
import type { StoredNoteV2 } from '@/lib/dustpool/v2/storage'
import { deriveStorageKey, decryptNotePayload } from '@/lib/dustpool/v2/storage-crypto'
import type { NoteCommitmentV2, V2Keys } from '@/lib/dustpool/v2/types'

type ExportFormat = 'json' | 'csv'

interface UseV2DisclosureReturn {
  viewKey: ViewKey | null
  viewKeyString: string | null
  scopedViewKeyString: string | null
  report: DisclosureReport | null
  verification: VerificationResult | null
  isGenerating: boolean
  error: string | null
  deriveAndSetViewKey: () => Promise<boolean>
  generateScopedViewKey: (startBlock: number, endBlock: number) => Promise<boolean>
  generateReport: (options?: DisclosureOptions) => Promise<DisclosureReport | null>
  verifyReport: (report: DisclosureReport) => Promise<VerificationResult>
  exportReport: (format: ExportFormat) => string | null
  clearDisclosure: () => void
}

export function useV2Disclosure(
  keysRef: RefObject<V2Keys | null>,
  chainIdOverride?: number
): UseV2DisclosureReturn {
  const { address } = useAccount()
  const wagmiChainId = useChainId()
  const chainId = chainIdOverride ?? wagmiChainId

  const [viewKey, setViewKey] = useState<ViewKey | null>(null)
  const [viewKeyString, setViewKeyString] = useState<string | null>(null)
  const [scopedViewKeyString, setScopedViewKeyString] = useState<string | null>(null)
  const [report, setReport] = useState<DisclosureReport | null>(null)
  const [verification, setVerification] = useState<VerificationResult | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const deriveAndSetViewKey = useCallback(async (): Promise<boolean> => {
    const keys = keysRef.current
    if (!keys) {
      setError('Keys not available — verify PIN first')
      return false
    }

    try {
      const vk = await deriveViewKey(keys)
      setViewKey(vk)
      setViewKeyString(serializeViewKey(vk))
      setError(null)
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'View key derivation failed'
      setError(msg)
      return false
    }
  }, [keysRef])

  const generateScopedViewKey = useCallback(async (
    startBlock: number,
    endBlock: number
  ): Promise<boolean> => {
    const keys = keysRef.current
    if (!keys) {
      setError('Keys not available — verify PIN first')
      return false
    }

    try {
      const vk = await deriveViewKey(keys)
      const svk: ScopedViewKey = { ...vk, startBlock, endBlock }
      setViewKey(svk)
      setViewKeyString(serializeViewKey(vk))
      setScopedViewKeyString(serializeScopedViewKey(svk))
      setError(null)
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Scoped view key derivation failed'
      setError(msg)
      return false
    }
  }, [keysRef])

  const loadAllNotes = useCallback(async (): Promise<NoteCommitmentV2[]> => {
    if (!address) return []

    const keys = keysRef.current
    const db = await openV2Database()
    const encKey = keys ? await deriveStorageKey(keys.spendingKey) : undefined

    // Load ALL notes (spent + unspent) for disclosure
    const tx = db.transaction(['notes'], 'readonly')
    const store = tx.objectStore('notes')
    const index = store.index('walletAddress')
    const addr = address.toLowerCase()

    const rawNotes = await new Promise<StoredNoteV2[]>((resolve, reject) => {
      const request = index.getAll(addr)
      request.onsuccess = () => {
        const results = (request.result as StoredNoteV2[]).filter(n => n.chainId === chainId)
        resolve(results)
      }
      request.onerror = () => reject(request.error)
    })

    let allNotes = rawNotes
    if (encKey) {
      allNotes = await Promise.all(rawNotes.map(async (n) => {
        if (!n.encryptedData || !n.iv) return n
        const payload = await decryptNotePayload(
          { ciphertext: n.encryptedData, iv: n.iv },
          encKey
        )
        return { ...n, owner: payload.owner, amount: payload.amount, asset: payload.asset, blinding: payload.blinding }
      }))
    }

    return allNotes.map(storedToNoteCommitment)
  }, [address, chainId, keysRef])

  const generateReport = useCallback(async (
    options: DisclosureOptions = {}
  ): Promise<DisclosureReport | null> => {
    if (!viewKey) {
      setError('Derive view key first')
      return null
    }

    setIsGenerating(true)
    setError(null)

    try {
      const notes = await loadAllNotes()
      const disclosureReport = generateDisclosureReport(notes, viewKey, chainId, options)
      setReport(disclosureReport)

      const result = await verifyDisclosureReport(disclosureReport)
      setVerification(result)

      return disclosureReport
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Report generation failed'
      setError(msg)
      return null
    } finally {
      setIsGenerating(false)
    }
  }, [viewKey, chainId, loadAllNotes])

  const verifyReport = useCallback(async (
    reportToVerify: DisclosureReport
  ): Promise<VerificationResult> => {
    const result = await verifyDisclosureReport(reportToVerify)
    setVerification(result)
    return result
  }, [])

  const exportReport = useCallback((format: ExportFormat): string | null => {
    if (!report) {
      setError('Generate a report first')
      return null
    }

    if (format === 'csv') return formatReportCSV(report)
    return formatReportJSON(report)
  }, [report])

  const clearDisclosure = useCallback(() => {
    setViewKey(null)
    setViewKeyString(null)
    setScopedViewKeyString(null)
    setReport(null)
    setVerification(null)
    setError(null)
    setIsGenerating(false)
  }, [])

  return {
    viewKey,
    viewKeyString,
    scopedViewKeyString,
    report,
    verification,
    isGenerating,
    error,
    deriveAndSetViewKey,
    generateScopedViewKey,
    generateReport,
    verifyReport,
    exportReport,
    clearDisclosure,
  }
}
