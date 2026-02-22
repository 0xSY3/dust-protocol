/**
 * AES-256-GCM encryption for IndexedDB note storage.
 *
 * Encrypts sensitive note fields (owner, amount, asset, blinding) so that
 * a compromised browser cannot extract transaction history from IndexedDB.
 * The encryption key is derived from the user's spendingKey via SHA-256.
 */

export interface NotePayload {
  owner: string
  amount: string
  asset: string
  blinding: string
}

export interface EncryptedPayload {
  ciphertext: string
  iv: string
}

/**
 * Derive an AES-256-GCM CryptoKey from the spending key.
 * SHA-256(spendingKey bytes) -> 256-bit AES key.
 */
export async function deriveStorageKey(spendingKey: bigint): Promise<CryptoKey> {
  const hex = spendingKey.toString(16).padStart(64, '0')
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }

  const keyMaterial = await crypto.subtle.digest('SHA-256', bytes)

  return crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  )
}

/** Encrypt sensitive note fields into a single ciphertext blob. */
export async function encryptNotePayload(
  payload: NotePayload,
  key: CryptoKey
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  )

  return {
    ciphertext: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv.buffer),
  }
}

/** Decrypt a ciphertext blob back into note fields. */
export async function decryptNotePayload(
  encrypted: EncryptedPayload,
  key: CryptoKey
): Promise<NotePayload> {
  const ciphertext = base64ToArrayBuffer(encrypted.ciphertext)
  const iv = base64ToArrayBuffer(encrypted.iv)

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  )

  return JSON.parse(new TextDecoder().decode(plaintext)) as NotePayload
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}
