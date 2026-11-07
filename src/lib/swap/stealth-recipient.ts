// Parsing for the swap card's optional "Send output to" and invoice fields. Pure, so the card can
// validate as the user types and the hook can re-check before generating a stealth address.

import { parseStealthMetaAddress } from '@/lib/stealth/keys'
import { formatNameWithSuffix, isValidName } from '@/lib/stealth/names'
import { isInvoiceId } from '@/lib/stealth/metadata'
import type { GeneratedStealthAddress } from '@/lib/stealth/types'
import type { StealthPayout } from './swap-to-stealth'

export type RecipientInput =
  | { kind: 'none' }
  | { kind: 'meta-address'; uri: string }
  | { kind: 'name'; name: string }
  | { kind: 'invalid'; reason: string }

export type InvoiceIdInput =
  | { kind: 'none' }
  | { kind: 'valid'; invoiceId: string }
  | { kind: 'invalid'; reason: string }

export function classifyRecipientInput(raw: string): RecipientInput {
  const input = raw.trim()
  if (!input) return { kind: 'none' }

  if (input.startsWith('st:')) {
    try {
      parseStealthMetaAddress(input)
      return { kind: 'meta-address', uri: input }
    } catch {
      return { kind: 'invalid', reason: 'Not a valid st:eth:0x… stealth meta-address' }
    }
  }
  if (isValidName(input)) return { kind: 'name', name: formatNameWithSuffix(input) }
  return { kind: 'invalid', reason: 'Enter a .dust name or a st:eth:0x… meta-address' }
}

/** The name registry stores the raw meta-address bytes; InvoiceCheckout builds the URI the same way */
export function metaAddressUriFromRegistry(resolved: string): string {
  return `st:eth:0x${resolved.replace(/^0x/, '')}`
}

export function parseInvoiceIdInput(raw: string): InvoiceIdInput {
  const input = raw.trim()
  if (!input) return { kind: 'none' }
  if (!isInvoiceId(input)) return { kind: 'invalid', reason: 'Invoice ID must be 0x followed by 32 hex characters' }
  // bytes16(0) is the adapter's "no invoice" sentinel and would be dropped from the announcement
  if (BigInt(input) === 0n) return { kind: 'invalid', reason: 'Invoice ID must not be zero' }
  return { kind: 'valid', invoiceId: input.toLowerCase() }
}

/** generateStealthAddress returns bare hex; the relayer API takes 0x-prefixed bytes */
export function toStealthPayout(generated: GeneratedStealthAddress): StealthPayout {
  return {
    stealthAddress: generated.stealthAddress,
    ephemeralPubKey: `0x${generated.ephemeralPublicKey.replace(/^0x/, '')}`,
    viewTag: `0x${generated.viewTag.replace(/^0x/, '')}`,
  }
}
