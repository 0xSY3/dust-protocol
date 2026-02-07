/**
 * Redeploy ALL stealth contracts fresh (announcer, registry, name registry)
 * Clean slate — no old test data.
 */

const { ethers } = require('ethers');
const solc = require('solc');
const fs = require('fs');
const path = require('path');

const RPC_URL = 'https://rpc.thanos-sepolia.tokamak.network';
const PRIVATE_KEY = 'a596d50f8da618b4de7f9fab615f708966bcc51d3e5b183ae773eab00ea69f02';

function readContract(name) {
  return fs.readFileSync(path.join(__dirname, `../contracts/${name}.sol`), 'utf8');
}

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
    throw new Error(`Compilation of ${name} failed`);
  }
  const contract = output.contracts[`${name}.sol`][name];
  return { abi: contract.abi, bytecode: '0x' + contract.evm.bytecode.object };
}

async function deploy(wallet, compiled, name) {
  console.log(`\nDeploying ${name}...`);
  const factory = new ethers.ContractFactory(compiled.abi, compiled.bytecode, wallet);
  const contract = await factory.deploy();
  console.log(`  Tx: ${contract.deployTransaction.hash}`);
  await contract.deployed();
  console.log(`  Address: ${contract.address}`);
  return contract;
}

async function main() {
  console.log('Compiling all contracts...');
  const announcerCompiled = compile(readContract('ERC5564Announcer'), 'ERC5564Announcer');
  const registryCompiled = compile(readContract('ERC6538Registry'), 'ERC6538Registry');
  const nameRegistryCompiled = compile(readContract('StealthNameRegistry'), 'StealthNameRegistry');
  console.log('Compilation done.');

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  console.log(`Deployer: ${wallet.address}`);
  const balance = await wallet.getBalance();
  console.log(`Balance: ${ethers.utils.formatEther(balance)} TON`);

  const announcer = await deploy(wallet, announcerCompiled, 'ERC5564Announcer');
  const registry = await deploy(wallet, registryCompiled, 'ERC6538Registry');
  const nameRegistry = await deploy(wallet, nameRegistryCompiled, 'StealthNameRegistry');

  // Get deployment block
  const deployBlock = await provider.getBlockNumber();

  // Update stealth-deployment.json
  const deployInfo = {
    chainId: 111551119090,
    announcer: announcer.address,
    registry: registry.address,
    nameRegistry: nameRegistry.address,
    deployer: wallet.address,
    deploymentBlock: deployBlock,
    timestamp: new Date().toISOString(),
  };
  const deployPath = path.join(__dirname, '../stealth-deployment.json');
  fs.writeFileSync(deployPath, JSON.stringify(deployInfo, null, 2));
  console.log('\nUpdated stealth-deployment.json');

  // Update .env.local
  const envPath = path.join(__dirname, '../.env.local');
  let env = fs.readFileSync(envPath, 'utf8');
  env = env.replace(/NEXT_PUBLIC_STEALTH_ANNOUNCER_ADDRESS=.*/, `NEXT_PUBLIC_STEALTH_ANNOUNCER_ADDRESS=${announcer.address}`);
  env = env.replace(/NEXT_PUBLIC_STEALTH_REGISTRY_ADDRESS=.*/, `NEXT_PUBLIC_STEALTH_REGISTRY_ADDRESS=${registry.address}`);
  env = env.replace(/NEXT_PUBLIC_STEALTH_NAME_REGISTRY_ADDRESS=.*/, `NEXT_PUBLIC_STEALTH_NAME_REGISTRY_ADDRESS=${nameRegistry.address}`);
  fs.writeFileSync(envPath, env);
  console.log('Updated .env.local');

  console.log('\n' + '='.repeat(50));
  console.log('ALL CONTRACTS REDEPLOYED');
  console.log('='.repeat(50));
  console.log(`Announcer:     ${announcer.address}`);
  console.log(`Registry:      ${registry.address}`);
  console.log(`NameRegistry:  ${nameRegistry.address}`);
  console.log(`Deploy Block:  ${deployBlock}`);
  console.log('\nIMPORTANT: Update DEPLOYMENT_BLOCK in src/lib/stealth/types.ts');
  console.log(`           Set to: ${deployBlock}`);
  console.log('\nThen restart the dev server and clear browser localStorage.');
}

main().catch(e => { console.error(e); process.exit(1); });
