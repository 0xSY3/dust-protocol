import { ethers } from 'ethers';

export interface V2ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  dustPoolV2Address: string;
  verifierAddress: string;
  /** Block number to start scanning from (contract deployment block) */
  startBlock: number;
}

// DustPoolV2 ABI — matches contracts/dustpool/src/DustPoolV2.sol
export const DUST_POOL_V2_ABI = [
  'event DepositQueued(bytes32 indexed commitment, uint256 queueIndex, uint256 amount, address asset, uint256 timestamp)',
  'event RootUpdated(bytes32 newRoot, uint256 index, address relayer)',
  'event Withdrawal(bytes32 indexed nullifier, address indexed recipient, uint256 amount, address asset)',
  'function deposit(bytes32 commitment) payable',
  'function depositERC20(bytes32 commitment, address token, uint256 amount)',
  'function withdraw(bytes calldata proof, bytes32 merkleRoot, bytes32 nullifier0, bytes32 nullifier1, bytes32 outCommitment0, bytes32 outCommitment1, uint256 publicAmount, uint256 publicAsset, address recipient, address tokenAddress)',
  'function updateRoot(bytes32 newRoot)',
  'function isKnownRoot(bytes32 root) view returns (bool)',
  'function nullifiers(bytes32) view returns (bool)',
  'function depositQueueTail() view returns (uint256)',
  'function currentRootIndex() view returns (uint256)',
  'function roots(uint256) view returns (bytes32)',
  'function relayers(address) view returns (bool)',
];

function getChainConfigs(): V2ChainConfig[] {
  const chains: V2ChainConfig[] = [];

  // Thanos Sepolia
  const thanosAddress = process.env.DUST_POOL_V2_THANOS;
  if (thanosAddress) {
    chains.push({
      chainId: 111551119090,
      name: 'Thanos Sepolia',
      rpcUrl: process.env.THANOS_RPC_URL || 'https://rpc.thanos-sepolia.tokamak.network',
      dustPoolV2Address: thanosAddress,
      verifierAddress: process.env.VERIFIER_THANOS || '',
      startBlock: parseInt(process.env.THANOS_START_BLOCK || '0', 10),
    });
  }

  // Ethereum Sepolia
  const sepoliaAddress = process.env.DUST_POOL_V2_SEPOLIA;
  if (sepoliaAddress) {
    chains.push({
      chainId: 11155111,
      name: 'Ethereum Sepolia',
      rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://sepolia.drpc.org',
      dustPoolV2Address: sepoliaAddress,
      verifierAddress: process.env.VERIFIER_SEPOLIA || '',
      startBlock: parseInt(process.env.SEPOLIA_START_BLOCK || '0', 10),
    });
  }

  if (chains.length === 0) {
    console.error('ERROR: No chains configured. Set DUST_POOL_V2_THANOS and/or DUST_POOL_V2_SEPOLIA.');
    process.exit(1);
  }

  return chains;
}

// Cached provider instances per chain
const providers = new Map<number, ethers.providers.JsonRpcProvider>();

export function getProvider(chainConfig: V2ChainConfig): ethers.providers.JsonRpcProvider {
  let provider = providers.get(chainConfig.chainId);
  if (!provider) {
    provider = new ethers.providers.JsonRpcProvider(chainConfig.rpcUrl);
    providers.set(chainConfig.chainId, provider);
  }
  return provider;
}

export function getWallet(
  privateKey: string,
  chainConfig: V2ChainConfig
): ethers.Wallet {
  return new ethers.Wallet(privateKey, getProvider(chainConfig));
}

export const chainConfigs = getChainConfigs();
