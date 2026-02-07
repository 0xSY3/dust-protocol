/**
 * Test script: Send real funds to a stealth address
 * This creates an actual stealth payment that can be claimed
 */

const { ethers } = require('ethers');
const { ec: EC } = require('elliptic');
const fs = require('fs');
const path = require('path');

const secp256k1 = new EC('secp256k1');

// Config
const RPC_URL = 'https://rpc.thanos-sepolia.tokamak.network';
const PRIVATE_KEY = process.env.PRIVATE_KEY || 'a596d50f8da618b4de7f9fab615f708966bcc51d3e5b183ae773eab00ea69f02';

// Load announcer address from deployment file
const deploymentPath = path.join(__dirname, '../stealth-deployment.json');
let ANNOUNCER_ADDRESS;
try {
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  ANNOUNCER_ADDRESS = deployment.announcer;
} catch {
  ANNOUNCER_ADDRESS = '0x2C2a59E9e71F2D1A8A2D447E73813B9F89CBb125';
}
const AMOUNT_TO_SEND = process.argv[3] || '0.01';
const LINK_SLUG = process.argv[4] || '';

const ANNOUNCER_ABI = [
  'function announce(uint256 schemeId, address stealthAddress, bytes calldata ephemeralPubKey, bytes calldata metadata) external',
];

// Generate stealth address from meta-address
function generateStealthAddress(spendingPubKey, viewingPubKey) {
  // Generate ephemeral key
  const ephemeralKeyPair = secp256k1.genKeyPair();
  const ephemeralPublicKey = ephemeralKeyPair.getPublic(true, 'hex');

  // Parse viewing public key
  const viewingKey = secp256k1.keyFromPublic(viewingPubKey, 'hex');

  // ECDH: shared secret
  const sharedPoint = ephemeralKeyPair.derive(viewingKey.getPublic());
  const sharedSecret = sharedPoint.toString('hex').padStart(64, '0');

  // Hash shared secret
  const secretHash = ethers.utils.keccak256('0x' + sharedSecret);
  const viewTag = secretHash.slice(2, 4);

  // Derive stealth public key
  const spendingKey = secp256k1.keyFromPublic(spendingPubKey, 'hex');
  const hashAsPrivateKey = secp256k1.keyFromPrivate(secretHash.slice(2), 'hex');
  const hashTimesG = hashAsPrivateKey.getPublic();
  const stealthPublicKeyPoint = spendingKey.getPublic().add(hashTimesG);

  // Convert to address
  const uncompressedPubKey = stealthPublicKeyPoint.encode('hex', false).slice(2);
  const addressHash = ethers.utils.keccak256('0x' + uncompressedPubKey);
  const stealthAddress = ethers.utils.getAddress('0x' + addressHash.slice(-40));

  return {
    stealthAddress,
    ephemeralPublicKey,
    viewTag,
  };
}

async function main() {
  // Get recipient meta-address from command line or use test one
  let metaAddress = process.argv[2];

  if (!metaAddress) {
    console.log('Usage: node scripts/test-stealth-payment.js <stealth-meta-address>');
    console.log('');
    console.log('Example: node scripts/test-stealth-payment.js "st:thanos:0x02abc...def03ghi...jkl"');
    console.log('');
    console.log('Get your meta-address from the Stealth page -> Setup tab');
    process.exit(1);
  }

  // Parse meta-address
  const match = metaAddress.match(/^st:[a-z]+:0x([0-9a-fA-F]{132})$/);
  if (!match) {
    console.error('Invalid stealth meta-address format');
    process.exit(1);
  }

  const keysHex = match[1];
  const spendingPubKey = keysHex.slice(0, 66);
  const viewingPubKey = keysHex.slice(66, 132);

  console.log('='.repeat(60));
  console.log('STEALTH PAYMENT TEST');
  console.log('='.repeat(60));
  console.log('');

  // Connect
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`Sender: ${wallet.address}`);
  const balance = await wallet.getBalance();
  console.log(`Balance: ${ethers.utils.formatEther(balance)} TOKAMAK`);
  console.log('');

  // Generate stealth address
  console.log('Generating stealth address...');
  const { stealthAddress, ephemeralPublicKey, viewTag } = generateStealthAddress(
    spendingPubKey,
    viewingPubKey
  );

  console.log(`Stealth Address: ${stealthAddress}`);
  console.log(`View Tag: 0x${viewTag}`);
  console.log('');

  // Send funds
  console.log(`Sending ${AMOUNT_TO_SEND} TOKAMAK to stealth address...`);
  const sendTx = await wallet.sendTransaction({
    to: stealthAddress,
    value: ethers.utils.parseEther(AMOUNT_TO_SEND),
  });
  console.log(`Send TX: ${sendTx.hash}`);
  await sendTx.wait();
  console.log('✅ Funds sent!');
  console.log('');

  // Announce
  console.log('Announcing payment...');
  const announcer = new ethers.Contract(ANNOUNCER_ADDRESS, ANNOUNCER_ABI, wallet);
  const announceTx = await announcer.announce(
    1, // schemeId = secp256k1
    stealthAddress,
    '0x' + ephemeralPublicKey,
    '0x' + viewTag + (LINK_SLUG ? Buffer.from(LINK_SLUG, 'utf8').toString('hex') : '')
  );
  console.log(`Announce TX: ${announceTx.hash}`);
  await announceTx.wait();
  console.log('✅ Payment announced!');
  console.log('');

  // Verify balance
  const stealthBalance = await provider.getBalance(stealthAddress);
  console.log(`Stealth address balance: ${ethers.utils.formatEther(stealthBalance)} TOKAMAK`);
  console.log('');

  console.log('='.repeat(60));
  console.log('SUCCESS! Now go to the app:');
  console.log('1. Go to Stealth page -> Scan tab');
  console.log('2. Click "Scan for Payments"');
  console.log('3. You should see the payment with balance');
  console.log('4. Click "Claim" to withdraw funds');
  console.log('='.repeat(60));
}

main().catch(console.error);
