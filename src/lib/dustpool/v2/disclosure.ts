/**
 * V2 DustPool Selective Disclosure — generate verifiable compliance reports.
 *
 * Reports are self-authenticating: each note includes the secret blinding factor
 * which is never published on-chain. If Poseidon(owner, amount, asset, chainId, blinding)
 * matches the on-chain commitment, the reporter must have created the note.
 *
 * Verification requires no trusted setup, no ZK circuit — just Poseidon hash checks.
 */

import { poseidonHash, computeNoteCommitment } from './commitment'
import { computeNullifier } from './nullifier'
import type { NoteCommitmentV2 } from './types'
import type { ViewKey } from './viewkey'

// ── Types ───────────────────────────────────────────────────────────────────

export interface DisclosureNote {
  commitment: string
  amount: string
  asset: string
  chainId: number
  blinding: string
  leafIndex: number
  spent: boolean
  createdAt: number
}

export interface DisclosureReport {
  version: number
  ownerPubKey: string
  chainId: number
  notes: DisclosureNote[]
  totalDeposited: string
  totalSpent: string
  totalUnspent: string
  dateRange: { from: number; to: number } | null
  generatedAt: number
}

export interface DisclosureOptions {
  dateRange?: { from: number; to: number }
  includeSpent?: boolean
  assetFilter?: bigint
}

export interface VerificationResult {
  valid: boolean
  totalNotes: number
  validNotes: number
  invalidNotes: number
  errors: string[]
}

// ── Report Generation ───────────────────────────────────────────────────────

/**
 * Generate a disclosure report from locally stored notes.
 *
 * The report contains note preimages (including blinding factors) that allow
 * any third party to verify ownership via Poseidon hash recomputation.
 *
 * @param notes     - User's notes (from IndexedDB, already decrypted)
 * @param viewKey   - User's view key (ownerPubKey + nullifierKey)
 * @param chainId   - Chain ID for the report
 * @param options   - Optional filters (date range, spent/unspent, asset)
 */
export function generateDisclosureReport(
  notes: NoteCommitmentV2[],
  viewKey: ViewKey,
  chainId: number,
  options: DisclosureOptions = {}
): DisclosureReport {
  const { dateRange, includeSpent = true, assetFilter } = options

  let filtered = notes.filter(n => n.note.owner === viewKey.ownerPubKey)

  if (dateRange) {
    filtered = filtered.filter(
      n => n.createdAt >= dateRange.from && n.createdAt <= dateRange.to
    )
  }

  if (!includeSpent) {
    filtered = filtered.filter(n => !n.spent)
  }

  if (assetFilter !== undefined) {
    filtered = filtered.filter(n => n.note.asset === assetFilter)
  }

  // Filter out dummy notes (zero amount)
  filtered = filtered.filter(n => n.note.amount > 0n)

  let totalDeposited = 0n
  let totalSpent = 0n
  let totalUnspent = 0n

  const disclosureNotes: DisclosureNote[] = filtered.map(n => {
    totalDeposited += n.note.amount
    if (n.spent) {
      totalSpent += n.note.amount
    } else {
      totalUnspent += n.note.amount
    }

    return {
      commitment: '0x' + n.commitment.toString(16).padStart(64, '0'),
      amount: n.note.amount.toString(),
      asset: '0x' + n.note.asset.toString(16).padStart(64, '0'),
      chainId: n.note.chainId,
      blinding: '0x' + n.note.blinding.toString(16).padStart(64, '0'),
      leafIndex: n.leafIndex,
      spent: n.spent,
      createdAt: n.createdAt,
    }
  })

  return {
    version: 1,
    ownerPubKey: '0x' + viewKey.ownerPubKey.toString(16).padStart(64, '0'),
    chainId,
    notes: disclosureNotes,
    totalDeposited: totalDeposited.toString(),
    totalSpent: totalSpent.toString(),
    totalUnspent: totalUnspent.toString(),
    dateRange: dateRange ?? null,
    generatedAt: Date.now(),
  }
}

// ── Report Verification ─────────────────────────────────────────────────────

/**
 * Verify a disclosure report by recomputing Poseidon commitments.
 *
 * For each note, checks that:
 *   Poseidon(ownerPubKey, amount, asset, chainId, blinding) == claimed commitment
 *
 * This proves the reporter knows the preimage (including secret blinding),
 * which only the original depositor could know.
 *
 * Does NOT verify on-chain inclusion (requires RPC access) — that's a separate
 * step the verifier performs by checking commitments against the Merkle tree.
 */
export async function verifyDisclosureReport(
  report: DisclosureReport
): Promise<VerificationResult> {
  const errors: string[] = []
  let validNotes = 0

  if (report.version !== 1) {
    return { valid: false, totalNotes: 0, validNotes: 0, invalidNotes: 0, errors: [`Unsupported report version: ${report.version}`] }
  }

  const ownerPubKey = BigInt(report.ownerPubKey)

  for (let i = 0; i < report.notes.length; i++) {
    const dn = report.notes[i]

    try {
      const recomputed = await computeNoteCommitment({
        owner: ownerPubKey,
        amount: BigInt(dn.amount),
        asset: BigInt(dn.asset),
        chainId: dn.chainId,
        blinding: BigInt(dn.blinding),
      })

      const claimed = BigInt(dn.commitment)
      if (recomputed === claimed) {
        validNotes++
      } else {
        errors.push(`Note ${i}: commitment mismatch (claimed ${dn.commitment}, computed 0x${recomputed.toString(16)})`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown error'
      errors.push(`Note ${i}: verification failed — ${msg}`)
    }
  }

  const invalidNotes = report.notes.length - validNotes

  return {
    valid: invalidNotes === 0 && report.notes.length > 0,
    totalNotes: report.notes.length,
    validNotes,
    invalidNotes,
    errors,
  }
}

// ── Nullifier Verification ──────────────────────────────────────────────────

/**
 * Compute nullifiers for all notes in a disclosure report.
 * Requires the view key's nullifierKey. Returns nullifier hex strings
 * that can be checked against the on-chain nullifier set.
 */
export async function computeReportNullifiers(
  report: DisclosureReport,
  nullifierKey: bigint
): Promise<Map<string, string>> {
  const nullifiers = new Map<string, string>()

  for (const dn of report.notes) {
    const commitment = BigInt(dn.commitment)
    if (dn.leafIndex < 0) continue // pending notes have no valid nullifier

    const nullifier = await computeNullifier(nullifierKey, commitment, dn.leafIndex)
    nullifiers.set(dn.commitment, '0x' + nullifier.toString(16).padStart(64, '0'))
  }

  return nullifiers
}

// ── Export Formats ───────────────────────────────────────────────────────────

/**
 * Format a disclosure report as CSV for tax/audit tools.
 * Columns: Date, Type, Amount (wei), Amount (ETH), Asset, Commitment, Status
 */
export function formatReportCSV(report: DisclosureReport): string {
  const header = 'Date,Type,Amount (wei),Amount (ETH),Asset,Commitment,Leaf Index,Status'
  const rows = report.notes.map(n => {
    const date = new Date(n.createdAt).toISOString()
    const amountWei = n.amount
    const amountEth = formatWeiToEth(n.amount)
    const status = n.spent ? 'Spent' : 'Unspent'
    return `${date},Deposit,${amountWei},${amountEth},${n.asset},${n.commitment},${n.leafIndex},${status}`
  })

  const summary = [
    '',
    `Total Deposited (wei),${report.totalDeposited}`,
    `Total Deposited (ETH),${formatWeiToEth(report.totalDeposited)}`,
    `Total Spent (wei),${report.totalSpent}`,
    `Total Unspent (wei),${report.totalUnspent}`,
    `Owner Public Key,${report.ownerPubKey}`,
    `Chain ID,${report.chainId}`,
    `Generated,${new Date(report.generatedAt).toISOString()}`,
  ]

  return [header, ...rows, ...summary].join('\n')
}

/**
 * Format a disclosure report as verifiable JSON.
 * This format can be shared with auditors who can run verifyDisclosureReport().
 */
export function formatReportJSON(report: DisclosureReport): string {
  return JSON.stringify(report, null, 2)
}

/**
 * Parse a JSON disclosure report string back into a DisclosureReport.
 * Throws if the JSON is invalid or missing required fields.
 */
export function parseReportJSON(json: string): DisclosureReport {
  const parsed = JSON.parse(json) as Record<string, unknown>

  if (typeof parsed.version !== 'number') {
    throw new Error('Invalid report: missing version field')
  }
  if (typeof parsed.ownerPubKey !== 'string') {
    throw new Error('Invalid report: missing ownerPubKey field')
  }
  if (!Array.isArray(parsed.notes)) {
    throw new Error('Invalid report: missing notes array')
  }

  return parsed as unknown as DisclosureReport
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatWeiToEth(weiStr: string): string {
  const wei = BigInt(weiStr)
  const eth = Number(wei) / 1e18
  return eth.toFixed(6)
}
