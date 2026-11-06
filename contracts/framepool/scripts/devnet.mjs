// Runs DustPoolV2Frame on the ERC-8421 alternative-mempool devnet (chain 1337: ethrex with EIP-8141 frame
// transactions behind a skandha sidecar), end to end:
//
//   deploy                    PoseidonT3, both verifiers and the pool; the key's address becomes relayer; stakes the pool
//   deposit <eth>             deposits a fresh note (its secrets go to .devnet-state.json) and posts the new root
//   root                      posts the root over every queued commitment, e.g. after a withdrawal queued its change
//   withdraw <recipient> <eth> [--fee-cap <eth>] [--show-canonical-rejection]
//                             proves a spend of the newest unspent note and sends it to the alternative mempool as a
//                             frame transaction that nobody signs: the pool is both its sender and its gas payer
//   status                    pool balance, stake, notes and withdrawals
//
// deploy, deposit and root send legacy transactions signed with DEVNET_PRIVATE_KEY, the pool's owner and relayer.
// withdraw signs nothing. Build first: (cd contracts/framepool && forge build).

import { randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { getProfile } from '@forshtat/hegota-support/profiles'
import { RpcError, rpc, toWire } from '@forshtat/hegota-support/rpc'
import { encodeTx, frame, newTx, txHash } from '@forshtat/hegota-support/tx'
import {
  decodeErrorResult,
  decodeEventLog,
  decodeFunctionResult,
  encodeDeployData,
  encodeEventTopics,
  encodeFunctionData,
  formatEther,
  getAddress,
  parseAbi,
  parseEther,
  toHex,
  zeroAddress,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  commitmentOf,
  createNote,
  deriveKeys,
  frameCalldata,
  frameRecipientSignal,
  frameWithdrawalInput,
  merkleTree,
  proveTransaction,
} from './frame-withdrawal.mjs'

// The gateway serves the alternative mempool, the faucet, the explorer methods and eth_*; only ethrex itself
// serves ethrex_simulateFrameTransaction
const GATEWAY = 'https://altmempoolgateway.forshtat.com/rpc'
const ETHREX = 'https://altmempool.forshtat.com'
const EXPLORER = 'https://explorer.altmempool.wtf'
const CHAIN_ID = 1337
const STAKING_REGISTRY = getAddress('0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f')
// mempool-workshop/workshop.config.json5: the base fee is 7 wei, frame transactions bid 2 gwei
const LEGACY_GAS_PRICE = 2_000_000n
const MAX_FEE_PER_GAS = 2_000_000_000n
// Above the registry's 0.01 ETH minimum stake; one day is ERC-8421's minimum unstake delay
const STAKE = parseEther('0.012')
const UNSTAKE_DELAY_SEC = 86_400
const DEFAULT_FEE_CAP_ETH = '0.01'
// VERIFY limit of the measuring simulation; the transaction sent gets the measured gas plus 20%
const VERIFY_GAS_PROBE = 2_000_000n
const RECEIPT_TIMEOUT_MS = 180_000

const HERE = dirname(fileURLToPath(import.meta.url))
const STATE_FILE = resolve(HERE, '../.devnet-state.json')
const profile = getProfile('ethrex-eip8141-tracer')
const REGISTRY_ABI = parseAbi([
  'function getDepositInfo(address account) view returns (uint256 stake, uint32 unstakeDelaySec, uint64 withdrawTime)',
])

function artifact(name) {
  const file = resolve(HERE, '../out', `${name}.json`)
  if (!existsSync(file)) throw new Error(`${file} is missing: run forge build in contracts/framepool`)
  return JSON.parse(readFileSync(file, 'utf8'))
}

const POOL_ABI = artifact('DustPoolV2Frame.sol/DustPoolV2Frame').abi
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : { chainId: CHAIN_ID, notes: [], withdrawals: [] }
const saveState = () => writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`)
const toBytes32 = (v) => `0x${BigInt(v).toString(16).padStart(64, '0')}`
const roundUp = (value, step) => ((value + step - 1n) / step) * step
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const explorerLink = (hash) => `${EXPLORER}/tx/${hash}`

function signer() {
  const key = process.env.DEVNET_PRIVATE_KEY
  if (!key) throw new Error('DEVNET_PRIVATE_KEY is not set (the pool owner and relayer)')
  return privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`)
}

function requirePool() {
  if (!state.pool) throw new Error(`no pool in ${STATE_FILE}: run deploy first`)
  return state.pool
}

async function read(address, abi, functionName, args = [], block = 'latest') {
  const data = await rpc(GATEWAY, 'eth_call', [{ to: address, data: encodeFunctionData({ abi, functionName, args }) }, block])
  return decodeFunctionResult({ abi, functionName, data })
}

async function waitForReceipt(hash) {
  const deadline = Date.now() + RECEIPT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const receipt = await rpc(GATEWAY, 'eth_getTransactionReceipt', [hash])
    if (receipt) return receipt
    await sleep(2_000)
  }
  throw new Error(`${hash} was not mined within ${RECEIPT_TIMEOUT_MS / 1000}s: ${explorerLink(hash)}`)
}

async function sendLegacy(account, label, { to = null, data = '0x', value = 0n }) {
  // The node's estimate includes EIP-8037 state gas, which makes creation and new storage expensive here
  const request = { from: account.address, data, value: toHex(value), ...(to && { to }) }
  const gas = (BigInt(await rpc(GATEWAY, 'eth_estimateGas', [request])) * 13n) / 10n
  const nonce = Number(await rpc(GATEWAY, 'eth_getTransactionCount', [account.address, 'pending']))
  const raw = await account.signTransaction({ chainId: CHAIN_ID, type: 'legacy', nonce, to, data, value, gas, gasPrice: LEGACY_GAS_PRICE })
  const hash = await rpc(GATEWAY, 'eth_sendRawTransaction', [raw])
  const receipt = await waitForReceipt(hash)
  if (receipt.status !== '0x1') throw new Error(`${label} reverted: ${explorerLink(hash)}`)
  console.log(`${label}: ${hash} (${BigInt(receipt.gasUsed)} gas)`)
  return receipt
}

function linkedBytecode(art, libraries) {
  let code = art.bytecode.object
  for (const refs of Object.values(art.bytecode.linkReferences)) {
    for (const [name, positions] of Object.entries(refs)) {
      if (!libraries[name]) throw new Error(`no address for library ${name}`)
      for (const { start, length } of positions) {
        const at = 2 + start * 2
        code = code.slice(0, at) + libraries[name].slice(2).toLowerCase() + code.slice(at + length * 2)
      }
    }
  }
  if (code.includes('__$')) throw new Error('bytecode still has an unlinked library placeholder')
  return code
}

async function deployContract(account, name, args = [], libraries = {}) {
  const art = artifact(name)
  const data = encodeDeployData({ abi: art.abi, bytecode: linkedBytecode(art, libraries), args })
  const receipt = await sendLegacy(account, `deploy ${name.split('/')[1]}`, { data })
  return { address: getAddress(receipt.contractAddress), block: Number(BigInt(receipt.blockNumber)) }
}

function poolEvents(logs, eventName) {
  const [topic] = encodeEventTopics({ abi: POOL_ABI, eventName })
  return logs
    .filter((log) => getAddress(log.address) === state.pool && log.topics[0] === topic)
    .map((log) => decodeEventLog({ abi: POOL_ABI, eventName, data: log.data, topics: log.topics }).args)
}

/** Every commitment the pool queued (deposits and settlement outputs), in queue order: the leaves of its tree. */
async function queuedLeaves() {
  const pool = requirePool()
  const block = await rpc(GATEWAY, 'eth_blockNumber', [])
  const [topic] = encodeEventTopics({ abi: POOL_ABI, eventName: 'DepositQueued' })
  const logs = await rpc(GATEWAY, 'eth_getLogs', [{ address: pool, topics: [topic], fromBlock: toHex(state.deployBlock), toBlock: block }])
  const queued = poolEvents(logs, 'DepositQueued').sort((a, b) => Number(a.queueIndex - b.queueIndex))
  const tail = Number(await read(pool, POOL_ABI, 'depositQueueTail', [], block))
  if (queued.length !== tail || queued.some((q, i) => Number(q.queueIndex) !== i)) {
    throw new Error(`found ${queued.length} DepositQueued events up to block ${BigInt(block)}, the pool queued ${tail}`)
  }
  return queued.map((q) => BigInt(q.commitment))
}

async function postRoot(account) {
  const pool = requirePool()
  const root = toBytes32(merkleTree(await queuedLeaves()).root)
  if (await read(pool, POOL_ABI, 'isKnownRoot', [root])) {
    console.log(`root ${root} is already posted`)
    return
  }
  await sendLegacy(account, `updateRoot ${root}`, { to: pool, data: encodeFunctionData({ abi: POOL_ABI, functionName: 'updateRoot', args: [root] }) })
}

async function deploy() {
  if (state.pool) throw new Error(`pool already deployed at ${state.pool}; delete ${STATE_FILE} to start over`)
  const account = signer()
  const balance = BigInt(await rpc(GATEWAY, 'eth_getBalance', [account.address, 'latest']))
  if (balance < STAKE * 2n) {
    throw new Error(`${account.address} holds ${formatEther(balance)} ETH: fund it with skandha_explorer_faucet on ${GATEWAY}`)
  }

  const poseidon = await deployContract(account, 'PoseidonT3.sol/PoseidonT3')
  const verifier = await deployContract(account, 'FFLONKVerifier.sol/FflonkVerifier')
  const splitVerifier = await deployContract(account, 'FFLONKSplitVerifier.sol/FflonkSplitVerifier')
  const pool = await deployContract(
    account,
    'DustPoolV2Frame.sol/DustPoolV2Frame',
    [verifier.address, splitVerifier.address, zeroAddress, STAKING_REGISTRY],
    { PoseidonT3: poseidon.address },
  )
  Object.assign(state, {
    pool: pool.address,
    deployBlock: pool.block,
    owner: account.address,
    verifier: verifier.address,
    splitVerifier: splitVerifier.address,
    poseidonT3: poseidon.address,
  })
  saveState()

  const call = (functionName, args) => encodeFunctionData({ abi: POOL_ABI, functionName, args })
  await sendLegacy(account, 'setRelayer', { to: pool.address, data: call('setRelayer', [account.address, true]) })
  // The registry stakes msg.sender, so the pool makes the call and the sidecar sees a staked sender
  await sendLegacy(account, 'addStake', { to: pool.address, value: STAKE, data: call('addStake', [UNSTAKE_DELAY_SEC]) })
  await status()
}

async function deposit(amountEth) {
  const account = signer()
  const pool = requirePool()
  const amount = parseEther(amountEth)
  const seed = randomBytes(32).toString('hex')
  const blindingLabel = `${seed}:blinding`
  const commitment = toBytes32(commitmentOf(createNote(deriveKeys(seed), CHAIN_ID, amount, blindingLabel)))
  const receipt = await sendLegacy(account, `deposit ${amountEth} ETH`, {
    to: pool,
    value: amount,
    data: encodeFunctionData({ abi: POOL_ABI, functionName: 'deposit', args: [commitment] }),
  })
  const queued = poolEvents(receipt.logs, 'DepositQueued').find((q) => q.commitment === commitment)
  if (!queued) throw new Error(`deposit ${receipt.transactionHash} queued no ${commitment}`)
  state.notes.push({ seed, blindingLabel, amount: amount.toString(), commitment, leafIndex: Number(queued.queueIndex), spent: false })
  saveState()
  await postRoot(account)
}

function decodeRevert(data) {
  try {
    const { errorName, args } = decodeErrorResult({ abi: POOL_ABI, data })
    return `${errorName}(${(args ?? []).join(', ')})`
  } catch {
    return `revert data ${data} matches no pool error`
  }
}

async function simulate(tx) {
  const sim = await rpc(ETHREX, 'ethrex_simulateFrameTransaction', [encodeTx(profile, tx), 'latest', { trace: false }])
  if (sim.gasUsed == null || sim.executionStatus !== 'success') {
    const reason = sim.revertData && sim.revertData !== '0x' ? `${decodeRevert(sim.revertData)}; ` : ''
    throw new Error(`simulation failed: ${reason}${JSON.stringify(sim)}`)
  }
  return sim
}

async function canonicalVerdict(raw) {
  try {
    return { accepted: true, hash: await rpc(GATEWAY, 'eth_sendRawTransaction', [raw]) }
  } catch (e) {
    if (!(e instanceof RpcError) || e.code === 'RPC_UNREACHABLE' || e.code === 'RPC_BAD_RESPONSE') throw e
    return { accepted: false, reason: e.message }
  }
}

async function waitForFrameTx(hash) {
  const deadline = Date.now() + RECEIPT_TIMEOUT_MS
  let lastStatus
  while (Date.now() < deadline) {
    const receipt = await rpc(GATEWAY, 'eth_getTransactionReceipt', [hash])
    if (receipt) return receipt
    const reply = await rpc(GATEWAY, 'skandha_frameTransactionStatus', [hash])
    const status = typeof reply?.status === 'string' ? reply.status : JSON.stringify(reply)
    if (status !== lastStatus) console.log(`  alt mempool status: ${status}`)
    lastStatus = status
    // skandha's terminal states for a transaction that will not be mined
    if (/Cancelled|Reverted/.test(status)) throw new Error(`${hash} ended ${status}: ${explorerLink(hash)}`)
    await sleep(2_000)
  }
  throw new Error(`${hash} was not mined within ${RECEIPT_TIMEOUT_MS / 1000}s: ${explorerLink(hash)}`)
}

async function withdraw(recipientArg, amountEth, options) {
  const pool = requirePool()
  const recipient = getAddress(recipientArg)
  const amount = parseEther(amountEth)
  const feeCap = parseEther(options['fee-cap'] ?? DEFAULT_FEE_CAP_ETH)
  const entry = state.notes.findLast((n) => !n.spent)
  if (!entry) throw new Error('no unspent note: run deposit first')
  const keys = deriveKeys(entry.seed)
  const note = createNote(keys, CHAIN_ID, BigInt(entry.amount), entry.blindingLabel)
  if (toBytes32(commitmentOf(note)) !== entry.commitment) throw new Error(`note ${entry.commitment} does not match its secrets`)

  const tree = merkleTree(await queuedLeaves())
  const root = toBytes32(tree.root)
  if (!(await read(pool, POOL_ABI, 'isKnownRoot', [root]))) throw new Error(`root ${root} is not posted yet: run root first`)
  const recipientSignal = frameRecipientSignal({ chainId: CHAIN_ID, pool, recipient, feeCap })
  const poolSignal = await read(pool, POOL_ABI, 'frameRecipientSignal', [recipient, feeCap])
  if (poolSignal !== recipientSignal) throw new Error(`recipient signal ${recipientSignal} differs from the pool's ${poolSignal}`)

  const changeLabel = `${entry.commitment}:change`
  const { input } = frameWithdrawalInput({ keys, note, leafIndex: entry.leafIndex, tree, amount, recipientSignal, changeLabel })
  const started = Date.now()
  const { proof, publicSignals } = await proveTransaction(input)
  const nullifier0 = BigInt(publicSignals[1])
  console.log(`proved in ${((Date.now() - started) / 1000).toFixed(1)}s; nullifier0 ${toBytes32(nullifier0)}`)

  const calldata = frameCalldata({ proof, publicSignals, recipient, feeCap })
  const [settlementExecutionGas, settlementStateGas] = await Promise.all([
    read(pool, POOL_ABI, 'settlementExecutionGas'),
    read(pool, POOL_ABI, 'settlementStateGas'),
  ])
  // validateFrameWithdrawal requires the nonzero nullifiers as the nonce keys, in increasing order, at sequence 0
  const nonceKeys = [nullifier0, BigInt(publicSignals[2])].filter((key) => key !== 0n).sort((a, b) => (a < b ? -1 : 1))
  const frameTx = (verifyGas) =>
    newTx({
      chainId: CHAIN_ID,
      sender: pool,
      nonceKeys,
      nonceSeq: 0n,
      signatures: [],
      fees: { maxFeePerGas: MAX_FEE_PER_GAS },
      frames: [
        frame(profile, 'VERIFY', { scope: 'EXECUTION_AND_PAYMENT', execution: verifyGas, data: calldata.verify }),
        frame(profile, 'SENDER', { target: pool, execution: settlementExecutionGas, state: settlementStateGas, data: calldata.settle }),
      ],
    })

  // Every frame limit counts toward MAX_COST, which must fit under the fee cap, so size VERIFY from a measurement
  const probe = await simulate(frameTx(VERIFY_GAS_PROBE))
  const verifyGas = roundUp((BigInt(probe.frames[0].gasUsed) * 12n) / 10n, 10_000n)
  const tx = frameTx(verifyGas)
  const sim = await simulate(tx)
  console.log(`VERIFY frame: ${BigInt(sim.frames[0].gasUsed)} gas used, limit ${verifyGas}`)
  console.log(`settlement frame: ${BigInt(sim.frames[1].gasUsed)} gas used, limits ${settlementExecutionGas} execution + ${settlementStateGas} state`)
  console.log(`max cost ${formatEther(BigInt(sim.maxCost))} ETH, fee cap ${formatEther(feeCap)} ETH, payer ${sim.payer}`)
  console.log(`canonical mempool policy: ${sim.canonicalMempoolValid ? 'accepts' : `rejects (${sim.canonicalMempoolViolation})`}`)

  if (options['show-canonical-rejection']) {
    if (sim.canonicalMempoolValid) throw new Error('the canonical mempool would accept this transaction; there is no rejection to show')
    const verdict = await canonicalVerdict(encodeTx(profile, tx))
    if (verdict.accepted) throw new Error(`the canonical mempool accepted ${verdict.hash} despite its policy check: ${explorerLink(verdict.hash)}`)
    console.log(`eth_sendRawTransaction (canonical mempool): rejected: ${verdict.reason}`)
  }

  const hash = await rpc(GATEWAY, 'eth_sendFrameTransaction', [toWire(tx)])
  const expected = txHash(profile, tx)
  if (hash.toLowerCase() !== expected.toLowerCase()) throw new Error(`gateway returned ${hash}, the transaction hashes to ${expected}`)
  console.log(`eth_sendFrameTransaction (alternative mempool): admitted ${hash}`)

  const receipt = await waitForFrameTx(hash)
  const failedFrames = (receipt.frameReceipts ?? []).flatMap((f, i) => (f.status === '0x1' ? [] : [i]))
  if (receipt.status !== '0x1' || failedFrames.length) {
    throw new Error(`${hash} was mined with failed frame(s) [${failedFrames.join(', ')}]: ${explorerLink(hash)}`)
  }
  const [settled] = poolEvents(receipt.logs, 'FrameWithdrawalSettled')
  if (!settled) throw new Error(`${hash} emitted no FrameWithdrawalSettled`)
  const deferred = poolEvents(receipt.logs, 'WithdrawalDeferred').length > 0

  entry.spent = true
  const changeAmount = BigInt(entry.amount) - amount
  if (changeAmount > 0n) {
    const commitment = toBytes32(commitmentOf(createNote(keys, CHAIN_ID, changeAmount, changeLabel)))
    const queued = poolEvents(receipt.logs, 'DepositQueued').find((q) => q.commitment === commitment)
    if (!queued) throw new Error(`${hash} queued no change commitment ${commitment}`)
    state.notes.push({ seed: entry.seed, blindingLabel: changeLabel, amount: changeAmount.toString(), commitment, leafIndex: Number(queued.queueIndex), spent: false })
  }
  state.withdrawals.push({
    hash,
    explorer: explorerLink(hash),
    block: Number(BigInt(receipt.blockNumber)),
    recipient,
    amount: amount.toString(),
    feeCap: feeCap.toString(),
    payout: settled.amount.toString(),
    deferred,
    nullifier0: toBytes32(nullifier0),
    verifyGasLimit: verifyGas.toString(),
    gasUsed: BigInt(receipt.gasUsed).toString(),
  })
  saveState()

  try {
    const admission = await rpc(GATEWAY, 'skandha_explorer_getTransaction', [hash])
    writeFileSync(resolve(HERE, `../.devnet-admission-${hash.slice(0, 10)}.json`), `${JSON.stringify(admission, null, 2)}\n`)
  } catch (e) {
    console.warn(`admission report unavailable: ${e.message}`)
  }

  console.log(`settled in block ${BigInt(receipt.blockNumber)}: ${formatEther(settled.amount)} ETH to ${recipient}${deferred ? ' (deferred: claim it)' : ''}`)
  console.log(explorerLink(hash))
}

async function status() {
  const pool = requirePool()
  const [stake, unstakeDelaySec] = await read(STAKING_REGISTRY, REGISTRY_ABI, 'getDepositInfo', [pool])
  const balance = BigInt(await rpc(GATEWAY, 'eth_getBalance', [pool, 'latest']))
  console.log(`pool ${pool}: ${formatEther(balance)} ETH; stake ${formatEther(stake)} ETH, unstake delay ${unstakeDelaySec}s`)
  for (const n of state.notes) {
    console.log(`  note ${n.commitment} at leaf ${n.leafIndex}: ${formatEther(BigInt(n.amount))} ETH${n.spent ? ', spent' : ''}`)
  }
  for (const w of state.withdrawals) console.log(`  withdrawal ${w.explorer}`)
}

function parseArgs(argv) {
  const positional = []
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fee-cap') options['fee-cap'] = argv[++i]
    else if (argv[i] === '--show-canonical-rejection') options['show-canonical-rejection'] = true
    else if (argv[i].startsWith('--')) throw new Error(`unknown option ${argv[i]}`)
    else positional.push(argv[i])
  }
  return { positional, options }
}

const USAGE = `usage: node contracts/framepool/scripts/devnet.mjs <command>
  deploy
  deposit <eth>
  root
  withdraw <recipient> <eth> [--fee-cap <eth>] [--show-canonical-rejection]
  status`

const { positional, options } = parseArgs(process.argv.slice(2))
const [command, ...args] = positional
const required = (value, name) => {
  if (value === undefined) throw new Error(`missing ${name}\n${USAGE}`)
  return value
}
const commands = {
  deploy: () => deploy(),
  deposit: () => deposit(required(args[0], 'amount in ETH')),
  root: () => postRoot(signer()),
  withdraw: () => withdraw(required(args[0], 'recipient'), required(args[1], 'amount in ETH'), options),
  status: () => status(),
}
if (!commands[command]) {
  console.error(USAGE)
  process.exit(1)
}
await commands[command]()
// snarkjs leaves worker threads running
process.exit(0)
