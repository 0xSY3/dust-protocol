import { describe, it, expect } from 'vitest'
import { parseEther } from 'viem'
import { createNote } from '../note'
import {
  computeNoteCommitment,
  computeAssetId,
  computeOwnerPubKey,
} from '../commitment'
import { BN254_FIELD_SIZE, TREE_DEPTH } from '../constants'
import { buildSplitInputs } from '../proof-inputs'
import type { NoteCommitmentV2, V2Keys } from '../types'

const TEST_CHAIN_ID = 11155111

const MOCK_KEYS: V2Keys = {
  spendingKey: 12345n,
  nullifierKey: 67890n,
}

async function mockNote(
  amount: bigint,
  chainId = TEST_CHAIN_ID
): Promise<NoteCommitmentV2> {
  const ownerPubKey = await computeOwnerPubKey(MOCK_KEYS.spendingKey)
  const assetId = await computeAssetId(
    chainId,
    '0x0000000000000000000000000000000000000000'
  )
  const note = createNote(ownerPubKey, amount, assetId, chainId)
  const commitment = await computeNoteCommitment(note)
  return {
    note,
    commitment,
    leafIndex: 0,
    spent: false,
    createdAt: Date.now(),
  }
}

function dummyMerkleProof() {
  return {
    pathElements: new Array<bigint>(TREE_DEPTH).fill(0n),
    pathIndices: new Array<number>(TREE_DEPTH).fill(0),
  }
}

describe('buildSplitInputs', () => {
  it('splits 1.37 ETH into [1.0, 0.3, 0.05, 0.02] with correct output amounts', async () => {
    // #given
    const noteCommitment = await mockNote(parseEther('1.37'))
    const chunks = [
      parseEther('1.0'),
      parseEther('0.3'),
      parseEther('0.05'),
      parseEther('0.02'),
    ]

    // #when
    const result = await buildSplitInputs(
      noteCommitment,
      chunks,
      '0x0',
      MOCK_KEYS,
      dummyMerkleProof(),
      TEST_CHAIN_ID
    )

    // #then — outputNotes has 4 real notes matching chunks, no change (sum = 1.37)
    expect(result.outputNotes).toHaveLength(4)
    expect(result.outputNotes[0].amount).toBe(parseEther('1.0'))
    expect(result.outputNotes[1].amount).toBe(parseEther('0.3'))
    expect(result.outputNotes[2].amount).toBe(parseEther('0.05'))
    expect(result.outputNotes[3].amount).toBe(parseEther('0.02'))

    // Circuit inputs have 8 output slots (padded with dummies)
    const amounts = result.circuitInputs.outAmount as string[]
    expect(amounts).toHaveLength(8)
    for (let i = 4; i < 8; i++) {
      expect(BigInt(amounts[i])).toBe(0n)
    }

    // Internal split: publicAmount = 0
    expect(BigInt(result.circuitInputs.publicAmount as string)).toBe(0n)
  })

  it('computes output commitments matching Poseidon(owner, amount, asset, chainId, blinding)', async () => {
    // #given
    const noteCommitment = await mockNote(parseEther('1.0'))
    const chunks = [parseEther('0.5'), parseEther('0.3')]

    // #when
    const result = await buildSplitInputs(
      noteCommitment,
      chunks,
      '0x0',
      MOCK_KEYS,
      dummyMerkleProof(),
      TEST_CHAIN_ID
    )

    // #then — each real output's commitment matches recomputation
    const owners = result.circuitInputs.outOwner as string[]
    const amounts = result.circuitInputs.outAmount as string[]
    const assets = result.circuitInputs.outAsset as string[]
    const chainIds = result.circuitInputs.outChainId as string[]
    const blindings = result.circuitInputs.outBlinding as string[]
    const commitments = result.circuitInputs.outputCommitment as string[]

    for (let i = 0; i < 8; i++) {
      const expected = await computeNoteCommitment({
        owner: BigInt(owners[i]),
        amount: BigInt(amounts[i]),
        asset: BigInt(assets[i]),
        chainId: Number(chainIds[i]),
        blinding: BigInt(blindings[i]),
      })
      expect(BigInt(commitments[i])).toBe(expected)
    }
  })

  it('balance conservation: sum(inputs) + publicAmount === sum(outputs)', async () => {
    // #given — internal split with change
    const noteCommitment = await mockNote(parseEther('2.0'))
    const chunks = [parseEther('1.0'), parseEther('0.5'), parseEther('0.3')]

    // #when
    const result = await buildSplitInputs(
      noteCommitment,
      chunks,
      '0x0',
      MOCK_KEYS,
      dummyMerkleProof(),
      TEST_CHAIN_ID
    )

    // #then
    const inAmounts = result.circuitInputs.inAmount as string[]
    const outAmounts = result.circuitInputs.outAmount as string[]
    const publicAmount = BigInt(result.circuitInputs.publicAmount as string)

    const sumIn = BigInt(inAmounts[0]) + BigInt(inAmounts[1]) + publicAmount
    const sumOut = outAmounts.reduce((s: bigint, a: string) => s + BigInt(a), 0n)
    expect(sumIn).toBe(sumOut)
  })

  it('pads dummy outputs with zeros to length 8', async () => {
    // #given
    const noteCommitment = await mockNote(parseEther('1.0'))
    const chunks = [parseEther('0.5'), parseEther('0.5')]

    // #when
    const result = await buildSplitInputs(
      noteCommitment,
      chunks,
      '0x0',
      MOCK_KEYS,
      dummyMerkleProof(),
      TEST_CHAIN_ID
    )

    // #then — all 8 circuit input arrays have length 8
    const amounts = result.circuitInputs.outAmount as string[]
    const owners = result.circuitInputs.outOwner as string[]
    const blindings = result.circuitInputs.outBlinding as string[]
    expect(amounts).toHaveLength(8)
    expect(owners).toHaveLength(8)

    // Slots 2-7 are zero-padded dummies
    for (let i = 2; i < 8; i++) {
      expect(BigInt(amounts[i])).toBe(0n)
      expect(BigInt(owners[i])).toBe(0n)
      expect(BigInt(blindings[i])).toBe(0n)
    }

    // outputNotes only contains real notes
    expect(result.outputNotes).toHaveLength(2)
  })

  it('includes change note when chunks do not sum to input amount', async () => {
    // #given
    const noteCommitment = await mockNote(parseEther('2.0'))
    const chunks = [parseEther('1.0'), parseEther('0.5')]

    // #when
    const result = await buildSplitInputs(
      noteCommitment,
      chunks,
      '0x0',
      MOCK_KEYS,
      dummyMerkleProof(),
      TEST_CHAIN_ID
    )

    // #then — 3 real output notes: 2 chunks + 1 change (0.5 ETH)
    expect(result.outputNotes).toHaveLength(3)
    expect(result.outputNotes[2].amount).toBe(parseEther('0.5'))
    // Change note owned by the sender
    expect(result.outputNotes[2].owner).toBe(noteCommitment.note.owner)
  })

  it('sets field-negative publicAmount and recipient for withdrawal', async () => {
    // #given
    const noteCommitment = await mockNote(parseEther('1.37'))
    const chunks = [
      parseEther('1.0'),
      parseEther('0.3'),
      parseEther('0.05'),
      parseEther('0.02'),
    ]
    const totalChunks = chunks.reduce((s, c) => s + c, 0n)
    const recipient = '0x1234567890123456789012345678901234567890'

    // #when
    const result = await buildSplitInputs(
      noteCommitment,
      chunks,
      recipient,
      MOCK_KEYS,
      dummyMerkleProof(),
      TEST_CHAIN_ID
    )

    // #then
    expect(BigInt(result.circuitInputs.publicAmount as string)).toBe(BN254_FIELD_SIZE - totalChunks)
    expect(BigInt(result.circuitInputs.recipient as string)).toBe(BigInt(recipient))
  })

  it('throws when chunks exceed input note amount', async () => {
    const noteCommitment = await mockNote(parseEther('1.0'))
    const chunks = [parseEther('0.8'), parseEther('0.5')]

    await expect(
      buildSplitInputs(
        noteCommitment,
        chunks,
        '0x0',
        MOCK_KEYS,
        dummyMerkleProof(),
        TEST_CHAIN_ID
      )
    ).rejects.toThrow(/exceeds note balance/)
  })

  it('throws when more than 8 chunks', async () => {
    const noteCommitment = await mockNote(parseEther('10.0'))
    const chunks = new Array(9).fill(parseEther('1.0'))

    await expect(
      buildSplitInputs(
        noteCommitment,
        chunks,
        '0x0',
        MOCK_KEYS,
        dummyMerkleProof(),
        TEST_CHAIN_ID
      )
    ).rejects.toThrow(/Too many chunks/)
  })
})
