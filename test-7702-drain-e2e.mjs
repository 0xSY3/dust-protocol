/**
 * E2E Test: EIP-7702 Drain Flow on Ethereum Sepolia
 *
 * Tests the complete drain lifecycle:
 * 1. Generate fresh stealth key
 * 2. Fund stealth address with 0.001 ETH
 * 3. Build EIP-7702 authorization (delegate to StealthSubAccount7702)
 * 4. Sign drain message
 * 5. Submit type-4 tx (delegation + drain in one tx)
 * 6. Verify funds drained to destination
 * 7. Verify Drained event emitted
 */

import { ethers } from 'ethers';
import { createWalletClient, createPublicClient, http, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

// ─── Config ──────────────────────────────────────────────────────────────────

const CHAIN_ID = 11155111;
const RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com';
const SUB_ACCOUNT_7702 = '0xdf34D138d1E0beC7127c32E9Aa1273E8B4DE7dFF';
const SPONSOR_KEY = 'a596d50f8da618b4de7f9fab615f708966bcc51d3e5b183ae773eab00ea69f02';
const FUND_AMOUNT = '0.001';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(step, msg) {
  console.log(`\n[Step ${step}] ${msg}`);
}

function detail(label, value) {
  console.log(`  ${label}: ${value}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  EIP-7702 Drain Flow — End-to-End Test');
  console.log('  Chain: Ethereum Sepolia (11155111)');
  console.log('  SubAccount7702: ' + SUB_ACCOUNT_7702);
  console.log('═══════════════════════════════════════════════════════');

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });

  // Sponsor = the relayer who pays gas and funds the stealth address
  const sponsorEthers = new ethers.Wallet(SPONSOR_KEY, provider);
  const sponsorViem = privateKeyToAccount(`0x${SPONSOR_KEY}`);
  const sponsorClient = createWalletClient({
    account: sponsorViem,
    chain: sepolia,
    transport: http(RPC_URL),
  });
  const destinationAddress = sponsorEthers.address; // drain back to sponsor

  // ─── Step 1: Generate fresh stealth key ──────────────────────────────────
  log(1, 'Generating fresh stealth key...');
  const stealthEthers = ethers.Wallet.createRandom();
  const stealthKey = stealthEthers.privateKey.slice(2);
  const stealthAddress = stealthEthers.address;
  detail('Stealth address', stealthAddress);
  detail('Destination', destinationAddress);

  // ─── Step 2: Fund stealth address ────────────────────────────────────────
  log(2, `Funding stealth address with ${FUND_AMOUNT} ETH...`);
  const fundTx = await sponsorEthers.sendTransaction({
    to: stealthAddress,
    value: ethers.utils.parseEther(FUND_AMOUNT),
  });
  detail('Fund tx', fundTx.hash);
  const fundReceipt = await fundTx.wait();
  detail('Confirmed', fundReceipt.status === 1 ? 'YES' : 'FAILED');

  const balBefore = await provider.getBalance(stealthAddress);
  const destBalBefore = await provider.getBalance(destinationAddress);
  detail('Stealth balance', ethers.utils.formatEther(balBefore) + ' ETH');
  detail('Dest balance before', ethers.utils.formatEther(destBalBefore) + ' ETH');

  // ─── Step 3: Build EIP-7702 authorization ────────────────────────────────
  log(3, 'Signing EIP-7702 authorization...');
  const stealthViem = privateKeyToAccount(`0x${stealthKey}`);
  const stealthClient = createWalletClient({
    account: stealthViem,
    chain: sepolia,
    transport: http(RPC_URL),
  });

  const authorization = await stealthClient.signAuthorization({
    contractAddress: SUB_ACCOUNT_7702,
  });
  detail('Delegation target', authorization.address);
  detail('Chain ID', authorization.chainId);
  detail('Nonce', authorization.nonce);

  // ─── Step 4: Sign drain message ──────────────────────────────────────────
  log(4, 'Signing drain message...');
  const drainNonce = 0; // fresh address, never drained
  const innerHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint256', 'uint256'],
      [stealthAddress, destinationAddress, drainNonce, CHAIN_ID]
    )
  );
  const drainSig = await stealthEthers.signMessage(ethers.utils.arrayify(innerHash));
  detail('Drain nonce', drainNonce);
  detail('Inner hash', innerHash);
  detail('Signature', drainSig.slice(0, 20) + '...');

  // ─── Step 5: Submit type-4 transaction ───────────────────────────────────
  log(5, 'Submitting type-4 tx (delegation + drain)...');
  const calldata = encodeFunctionData({
    abi: [{
      name: 'drain',
      type: 'function',
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'sig', type: 'bytes' },
      ],
      outputs: [],
      stateMutability: 'nonpayable',
    }],
    functionName: 'drain',
    args: [destinationAddress, drainSig],
  });
  detail('Calldata', calldata.slice(0, 30) + '...');

  // EIP-7702 type-4 txs need extra gas for the authorization list overhead.
  // viem's gas estimation doesn't always account for this correctly.
  const txHash = await sponsorClient.sendTransaction({
    authorizationList: [authorization],
    to: stealthAddress,
    data: calldata,
    gas: 200_000n, // generous limit for delegation + drain execution
  });
  detail('Tx hash', txHash);

  // ─── Step 6: Wait & verify ───────────────────────────────────────────────
  log(6, 'Waiting for confirmation...');
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  detail('Block', receipt.blockNumber.toString());
  detail('Status', receipt.status === 'success' ? 'SUCCESS' : 'REVERTED');
  detail('Gas used', receipt.gasUsed.toString());

  if (receipt.status !== 'success') {
    console.error('\n  ✗ TRANSACTION REVERTED');
    process.exit(1);
  }

  // ─── Step 7: Verify balances ─────────────────────────────────────────────
  log(7, 'Verifying balances...');
  const balAfter = await provider.getBalance(stealthAddress);
  const destBalAfter = await provider.getBalance(destinationAddress);
  detail('Stealth balance after', ethers.utils.formatEther(balAfter) + ' ETH');
  detail('Dest balance after', ethers.utils.formatEther(destBalAfter) + ' ETH');

  const drained = balBefore.sub(balAfter);
  detail('Amount drained', ethers.utils.formatEther(drained) + ' ETH');

  const stealthEmpty = balAfter.lt(ethers.utils.parseEther('0.00001'));
  detail('Stealth emptied?', stealthEmpty ? 'YES' : 'NO');

  // Destination gained: subtract gas cost the sponsor spent on the drain tx
  const destGained = destBalAfter.sub(destBalBefore);
  detail('Net dest change', ethers.utils.formatEther(destGained) + ' ETH');
  // The destination IS the sponsor, so it lost gas but gained drain amount.
  // Net should be positive (0.001 drained - ~gas cost)
  const destNetPositive = destGained.gt(0);
  detail('Destination net positive?', destNetPositive ? 'YES (drain > gas)' : 'NO');

  // ─── Step 8: Verify Drained event ────────────────────────────────────────
  log(8, 'Verifying Drained event...');
  const drainedTopic = ethers.utils.id('Drained(address,uint256)');
  const drainedLogs = receipt.logs.filter(l => l.topics[0] === drainedTopic);
  detail('Drained events found', drainedLogs.length);

  let eventMatch = false;
  if (drainedLogs.length > 0) {
    const evt = drainedLogs[0];
    const evtTo = ethers.utils.defaultAbiCoder.decode(['address'], evt.topics[1])[0];
    const evtAmount = ethers.utils.defaultAbiCoder.decode(['uint256'], evt.data)[0];
    detail('Event to', evtTo);
    detail('Event amount', ethers.utils.formatEther(evtAmount) + ' ETH');
    eventMatch = evtTo.toLowerCase() === destinationAddress.toLowerCase();
    detail('Event matches dest?', eventMatch ? 'YES' : 'NO');
  }

  // ─── Step 9: Verify key zeroization logic ────────────────────────────────
  log(9, 'Key zeroization verification (code review)...');
  detail('Note', 'Key zeroization happens in useStealthScanner.ts');
  detail('Mechanism', 'delete privateKeysRef.current[stealthAddress] after successful drain');
  detail('Testable on-chain?', 'No — React ref lifecycle, verified by code inspection');

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  RESULTS SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  const checks = [
    ['Stealth funded',     balBefore.gt(0)],
    ['Tx succeeded',       receipt.status === 'success'],
    ['Stealth emptied',    stealthEmpty],
    ['Dest net positive',  destNetPositive],
    ['Drained event',      drainedLogs.length > 0],
    ['Event matches dest', eventMatch],
  ];

  for (const [name, pass] of checks) {
    console.log(`  ${pass ? '✓' : '✗'} ${name}`);
  }

  const allPassed = checks.every(([, p]) => p);
  console.log(`\n  Stealth:     ${stealthAddress}`);
  console.log(`  Destination: ${destinationAddress}`);
  console.log(`  Fund tx:     ${fundTx.hash}`);
  console.log(`  Drain tx:    ${txHash}`);
  console.log(`  Drained:     ${ethers.utils.formatEther(drained)} ETH`);
  console.log(`\n  OVERALL: ${allPassed ? '✓ ALL CHECKS PASSED' : '✗ SOME CHECKS FAILED'}`);
  console.log('═══════════════════════════════════════════════════════');

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('\nFATAL:', err.message || err);
  if (err.cause) console.error('CAUSE:', err.cause.message || err.cause);
  process.exit(1);
});
