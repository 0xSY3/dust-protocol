/**
 * Redeploy only the StealthNameRegistry contract (fresh, no old names)
 * Keeps existing announcer and ERC6538 registry intact.
 */

const { ethers } = require('ethers');
const solc = require('solc');
const fs = require('fs');
const path = require('path');

const RPC_URL = 'https://rpc.thanos-sepolia.tokamak.network';
const PRIVATE_KEY = 'a596d50f8da618b4de7f9fab615f708966bcc51d3e5b183ae773eab00ea69f02';

const source = fs.readFileSync(
  path.join(__dirname, '../contracts/StealthNameRegistry.sol'),
  'utf8'
);

function compile(source, name) {
  const input = {
    language: 'Solidity',
    sources: { [`${name}.sol`]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  if (output.errors?.some(e => e.severity === 'error')) {
    output.errors.filter(e => e.severity === 'error').forEach(e => console.error(e.formattedMessage));
    throw new Error('Compilation failed');
  }
  const contract = output.contracts[`${name}.sol`][name];
  return { abi: contract.abi, bytecode: '0x' + contract.evm.bytecode.object };
}

async function main() {
  console.log('Compiling StealthNameRegistry...');
  const compiled = compile(source, 'StealthNameRegistry');

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  console.log(`Deployer: ${wallet.address}`);

  const balance = await wallet.getBalance();
  console.log(`Balance: ${ethers.utils.formatEther(balance)} TON`);

  console.log('\nDeploying fresh StealthNameRegistry...');
  const factory = new ethers.ContractFactory(compiled.abi, compiled.bytecode, wallet);
  const contract = await factory.deploy();
  console.log(`Tx: ${contract.deployTransaction.hash}`);
  await contract.deployed();
  console.log(`\nNew StealthNameRegistry: ${contract.address}`);

  // Update stealth-deployment.json
  const deployPath = path.join(__dirname, '../stealth-deployment.json');
  const deployment = JSON.parse(fs.readFileSync(deployPath, 'utf8'));
  deployment.nameRegistry = contract.address;
  deployment.timestamp = new Date().toISOString();
  fs.writeFileSync(deployPath, JSON.stringify(deployment, null, 2));
  console.log('Updated stealth-deployment.json');

  // Update .env.local
  const envPath = path.join(__dirname, '../.env.local');
  let env = fs.readFileSync(envPath, 'utf8');
  env = env.replace(
    /NEXT_PUBLIC_STEALTH_NAME_REGISTRY_ADDRESS=.*/,
    `NEXT_PUBLIC_STEALTH_NAME_REGISTRY_ADDRESS=${contract.address}`
  );
  fs.writeFileSync(envPath, env);
  console.log('Updated .env.local');

  console.log('\nDone! Restart dev server to pick up new address.');
}

main().catch(e => { console.error(e); process.exit(1); });
