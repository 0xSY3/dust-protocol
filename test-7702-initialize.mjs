/**
 * End-to-end test: EIP-7702 initialize flow
 *
 * Architecture:
 * - SPONSOR (test key from env) = relayer who submits the type-4 tx
 * - STEALTH (fresh random key) = the stealth EOA that gets delegated
 * - OWNER (sponsor address) = set as the owner of the delegated account
 *
 * Steps:
 * 1. Generate fresh stealth address
 * 2. Fund stealth address from sponsor
 * 3. Build EIP-7702 authorization (stealth key signs delegation)
 * 4. Sign initialize message (stealth key authorizes owner)
 * 5. Submit type-4 tx from sponsor
 * 6. Verify delegation and initialization
 * 7. Test sub-account operations as owner
 */

import { ethers } from 'ethers';
import { createWalletClient, createPublicClient, http, encodeFunctionData } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { sepolia } from 'viem/chains';

// ─── Config ─────────────────────────────────────────────────────────────
const CHAIN_ID = 11155111;
const RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com';
const IMPL_ADDRESS = '0xdf34D138d1E0beC7127c32E9Aa1273E8B4DE7dFF';

// Sponsor/relayer key (from env — this is the account that pays gas)
const SPONSOR_KEY_RAW = process.env.RELAYER_PRIVATE_KEY;

const SUB_ACCOUNT_ABI = [
  'function initialize(address _owner, bytes sig) external',
  'function drain(address to, bytes sig) external',
  'function createSubAccount(address delegate, uint256 dailyLimit) external returns (uint256)',
  'function executeFromSub(uint256 subId, address to, uint256 value, bytes data) external',
  'function execute(address to, uint256 value, bytes data) external',
  'function revokeSubAccount(uint256 subId) external',
  'function updateSubAccountLimit(uint256 subId, uint256 newLimit) external',
  'function owner() view returns (address)',
  'function initialized() view returns (bool)',
  'function drainNonce() view returns (uint256)',
  'function subAccounts(uint256) view returns (address delegate, uint256 dailyLimit, uint256 spentToday, uint256 lastResetDay, bool active)',
  'function subAccountCount() view returns (uint256)',
];

// ─── Helpers ────────────────────────────────────────────────────────────
function log(step, msg) {
  console.log(`\n[${'STEP ' + step}] ${msg}`);
}
function success(msg) { console.log(`  ✅ ${msg}`); }
function fail(msg) { console.error(`  ❌ ${msg}`); process.exit(1); }

async function waitForTx(provider, txHash, label) {
  console.log(`  ⏳ Waiting for ${label}: ${txHash}`);
  const receipt = await provider.waitForTransaction(txHash, 1, 120_000);
  if (receipt.status !== 1) fail(`${label} reverted!`);
  success(`${label} confirmed in block ${receipt.blockNumber}`);
  return receipt;
}

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  EIP-7702 Initialize Flow — End-to-End Test');
  console.log('═══════════════════════════════════════════════════════════');

  if (!SPONSOR_KEY_RAW) fail('Set RELAYER_PRIVATE_KEY env var');
  const sponsorKey = SPONSOR_KEY_RAW.startsWith('0x') ? SPONSOR_KEY_RAW : `0x${SPONSOR_KEY_RAW}`;

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  console.log(`\nChain: ${network.name} (${network.chainId})`);

  // Sponsor setup
  const sponsorAccount = privateKeyToAccount(sponsorKey);
  const sponsorWallet = new ethers.Wallet(sponsorKey, provider);
  console.log(`Sponsor: ${sponsorAccount.address}`);
  const sponsorBal = await provider.getBalance(sponsorAccount.address);
  console.log(`Sponsor balance: ${ethers.utils.formatEther(sponsorBal)} ETH`);

  // ── Step 1: Generate fresh stealth address ──────────────────────────
  log(1, 'Generate fresh stealth address');
  const stealthKey = generatePrivateKey();
  const stealthViemAccount = privateKeyToAccount(stealthKey);
  const stealthAddress = stealthViemAccount.address;
  const stealthWallet = new ethers.Wallet(stealthKey, provider);
  success(`Stealth address: ${stealthAddress}`);
  console.log(`  Stealth key: ${stealthKey.slice(0, 10)}...${stealthKey.slice(-6)}`);
  console.log(`  (Fresh EOA, nonce should be 0)`);

  // ── Step 2: Fund stealth address ────────────────────────────────────
  log(2, 'Fund stealth address with 0.001 ETH');
  const fundTx = await sponsorWallet.sendTransaction({
    to: stealthAddress,
    value: ethers.utils.parseEther('0.001'),
  });
  await waitForTx(provider, fundTx.hash, 'Funding tx');
  const balance = await provider.getBalance(stealthAddress);
  success(`Balance: ${ethers.utils.formatEther(balance)} ETH`);

  // ── Step 3: Build EIP-7702 authorization ────────────────────────────
  log(3, 'Build EIP-7702 signed authorization');
  const stealthClient = createWalletClient({
    account: stealthViemAccount,
    chain: sepolia,
    transport: http(RPC_URL),
  });

  const authorization = await stealthClient.signAuthorization({
    contractAddress: IMPL_ADDRESS,
  });
  success(`Authorization signed for impl: ${IMPL_ADDRESS}`);
  console.log(`  Authorization nonce: ${authorization.nonce}`);

  // ── Step 4: Sign initialize message ─────────────────────────────────
  log(4, 'Sign initialize message');
  // Set sponsor as the owner of the delegated stealth account
  const ownerAddress = sponsorAccount.address;

  const innerHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint256'],
      [stealthAddress, ownerAddress, CHAIN_ID]
    )
  );
  const initSig = await stealthWallet.signMessage(ethers.utils.arrayify(innerHash));
  success(`Initialize sig signed`);
  console.log(`  Stealth (signer): ${stealthAddress}`);
  console.log(`  Owner (to be set): ${ownerAddress}`);

  // ── Step 5: Submit type-4 tx from sponsor ───────────────────────────
  log(5, 'Submit type-4 delegation + initialize tx');

  const sponsorViemClient = createWalletClient({
    account: sponsorAccount,
    chain: sepolia,
    transport: http(RPC_URL),
  });

  const calldata = encodeFunctionData({
    abi: [{
      name: 'initialize',
      type: 'function',
      inputs: [{ name: '_owner', type: 'address' }, { name: 'sig', type: 'bytes' }],
      outputs: [],
      stateMutability: 'nonpayable',
    }],
    functionName: 'initialize',
    args: [ownerAddress, initSig],
  });

  let txHash;
  try {
    txHash = await sponsorViemClient.sendTransaction({
      authorizationList: [authorization],
      to: stealthAddress,
      data: calldata,
      gas: 300000n,
    });
  } catch (txErr) {
    console.error(`  TX ERROR: ${txErr.shortMessage || txErr.message}`);
    if (txErr.details) console.error(`  Details: ${txErr.details}`);
    fail('Transaction submission failed');
  }
  success(`Tx hash: ${txHash}`);

  // ── Step 6: Verify delegation and initialization ────────────────────
  log(6, 'Verify delegation and initialization');
  const receipt = await waitForTx(provider, txHash, 'Initialize tx');
  console.log(`  Gas used: ${receipt.gasUsed.toString()}`);
  console.log(`  Tx: https://sepolia.etherscan.io/tx/${txHash}`);

  // Check delegation bytecode
  const code = await provider.getCode(stealthAddress);
  const hasDelegation = code !== '0x' && code.length > 2;
  if (!hasDelegation) {
    console.log(`  Bytecode after tx: ${code}`);
    fail('Delegation failed — no bytecode on stealth address');
  }
  success(`Delegation active — bytecode: ${code.slice(0, 50)}...`);

  // Verify initialized state
  const contract = new ethers.Contract(stealthAddress, SUB_ACCOUNT_ABI, provider);

  const isInitialized = await contract.initialized();
  if (!isInitialized) fail('initialized() returned false');
  success('initialized() = true');

  const setOwner = await contract.owner();
  if (setOwner.toLowerCase() !== ownerAddress.toLowerCase()) {
    fail(`owner() = ${setOwner}, expected ${ownerAddress}`);
  }
  success(`owner() = ${setOwner} ✓`);

  const drainN = await contract.drainNonce();
  success(`drainNonce() = ${drainN.toString()}`);

  // ── Step 7: Test sub-account operations ─────────────────────────────
  log(7, 'Test sub-account operations as owner');

  const ownerContract = new ethers.Contract(stealthAddress, SUB_ACCOUNT_ABI, sponsorWallet);

  // 7a. createSubAccount
  console.log('\n  7a. createSubAccount()');
  const delegateAddr = ethers.Wallet.createRandom().address;
  const dailyLimit = ethers.utils.parseEther('0.0001');
  const createTx = await ownerContract.createSubAccount(delegateAddr, dailyLimit);
  const createRcpt = await createTx.wait();
  success(`createSubAccount tx: ${createTx.hash}`);
  console.log(`    Gas: ${createRcpt.gasUsed.toString()}`);

  const subCount = await contract.subAccountCount();
  success(`subAccountCount() = ${subCount.toString()}`);

  const subId = subCount.sub(1);
  const sub = await contract.subAccounts(subId);
  console.log(`    Sub #${subId}: delegate=${sub.delegate}`);
  console.log(`    dailyLimit=${ethers.utils.formatEther(sub.dailyLimit)} ETH, active=${sub.active}`);

  // 7b. execute() — owner sends 0 ETH call to self
  console.log('\n  7b. execute() as owner');
  const execTx = await ownerContract.execute(stealthAddress, 0, '0x');
  const execRcpt = await execTx.wait();
  success(`execute() tx: ${execTx.hash}`);
  console.log(`    Gas: ${execRcpt.gasUsed.toString()}`);

  // 7c. updateSubAccountLimit
  console.log('\n  7c. updateSubAccountLimit()');
  const newLimit = ethers.utils.parseEther('0.001');
  const updateTx = await ownerContract.updateSubAccountLimit(subId, newLimit);
  const updateRcpt = await updateTx.wait();
  success(`updateSubAccountLimit tx: ${updateTx.hash}`);
  console.log(`    Gas: ${updateRcpt.gasUsed.toString()}`);

  const updatedSub = await contract.subAccounts(subId);
  success(`New dailyLimit: ${ethers.utils.formatEther(updatedSub.dailyLimit)} ETH`);

  // 7d. revokeSubAccount
  console.log('\n  7d. revokeSubAccount()');
  const revokeTx = await ownerContract.revokeSubAccount(subId);
  const revokeRcpt = await revokeTx.wait();
  success(`revokeSubAccount tx: ${revokeTx.hash}`);
  console.log(`    Gas: ${revokeRcpt.gasUsed.toString()}`);

  const revokedSub = await contract.subAccounts(subId);
  if (revokedSub.active) fail('Sub-account still active after revoke!');
  success(`Sub #${subId} active=${revokedSub.active} (revoked)`);

  // ── Summary ─────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  ✅ ALL TESTS PASSED');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('\n  Transaction Hashes:');
  console.log(`  • Fund:              ${fundTx.hash}`);
  console.log(`  • Delegate+Init:     ${txHash}`);
  console.log(`  • createSubAccount:  ${createTx.hash}`);
  console.log(`  • execute:           ${execTx.hash}`);
  console.log(`  • updateLimit:       ${updateTx.hash}`);
  console.log(`  • revokeSubAccount:  ${revokeTx.hash}`);
  console.log(`\n  Stealth address: ${stealthAddress}`);
  console.log(`  Owner: ${ownerAddress}`);
  console.log(`  Explorer: https://sepolia.etherscan.io/address/${stealthAddress}\n`);
}

main().catch((err) => {
  console.error('\n❌ UNHANDLED ERROR:', err);
  process.exit(1);
});
