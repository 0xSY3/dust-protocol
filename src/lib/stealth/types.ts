// Stealth address types (ERC-5564/6538)

import { getChainConfig, DEFAULT_CHAIN_ID, type ChainConfig } from '@/config/chains';

export type { ChainConfig };
export { getChainConfig, DEFAULT_CHAIN_ID };

export interface StealthKeyPair {
  spendingPrivateKey: string;
  spendingPublicKey: string;
  viewingPrivateKey: string;
  viewingPublicKey: string;
}

export interface StealthMetaAddress {
  prefix: string;
  spendingPublicKey: string;
  viewingPublicKey: string;
  raw: string;
}

export interface GeneratedStealthAddress {
  stealthAddress: string;         // CREATE2 wallet address (payment destination)
  stealthEOAAddress: string;      // EOA address (the "owner", for signing)
  ephemeralPublicKey: string;
  viewTag: string;
  stealthPublicKey: string;
}

export interface StealthAnnouncement {
  schemeId: number;
  stealthAddress: string;
  ephemeralPublicKey: string;
  viewTag: string;
  metadata: string;
  linkSlug?: string;
  caller: string;
  blockNumber: number;
  txHash: string;
}

export interface ScanResult {
  announcement: StealthAnnouncement;
  stealthPrivateKey: string;
  isMatch: boolean;
  privateKeyVerified?: boolean;
  derivedAddress?: string;
  walletType?: 'eoa' | 'create2' | 'account';
}

export const SCHEME_ID = { SECP256K1: 1 } as const;

export interface StealthContractAddresses {
  announcer: string;
  registry: string;
}

// ─── Backward-compatible defaults (Thanos Sepolia) ─────────────────────────────
// These are kept so existing code that imports directly still works.
// New code should use getChainConfig(chainId) instead.

const defaultConfig = getChainConfig(DEFAULT_CHAIN_ID);

export const CANONICAL_ADDRESSES: StealthContractAddresses = {
  announcer: defaultConfig.contracts.announcer,
  registry: defaultConfig.contracts.registry,
};

export const DEPLOYMENT_BLOCK = defaultConfig.deploymentBlock;

export const STEALTH_WALLET_FACTORY = defaultConfig.contracts.walletFactory;
export const STEALTH_WALLET_CREATION_CODE = defaultConfig.creationCodes.wallet;

export const LEGACY_STEALTH_WALLET_FACTORY = defaultConfig.contracts.legacyWalletFactory;
export const LEGACY_STEALTH_WALLET_CREATION_CODE = defaultConfig.creationCodes.legacyWallet;

export const STEALTH_WALLET_FACTORY_ABI = [
  'function computeAddress(address _owner) view returns (address)',
  'function deploy(address _owner) returns (address wallet)',
  'function deployAndDrain(address _owner, address _to, bytes _sig)',
];

export const ENTRY_POINT_ADDRESS = defaultConfig.contracts.entryPoint;
export const STEALTH_ACCOUNT_FACTORY = defaultConfig.contracts.accountFactory;
export const DUST_PAYMASTER_ADDRESS = defaultConfig.contracts.paymaster;
export const STEALTH_ACCOUNT_CREATION_CODE = defaultConfig.creationCodes.account;

export const LEGACY_STEALTH_ACCOUNT_FACTORY = defaultConfig.contracts.legacyAccountFactory;
export const LEGACY_STEALTH_ACCOUNT_CREATION_CODE = defaultConfig.creationCodes.legacyAccount;

export const STEALTH_ACCOUNT_FACTORY_ABI = [
  'function createAccount(address _owner, uint256 _salt) returns (address account)',
  'function getAddress(address _owner, uint256 _salt) view returns (address)',
];

export const ENTRY_POINT_ABI = [
  'function handleOps(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)',
  'function getUserOpHash(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature) userOp) view returns (bytes32)',
  'function getNonce(address sender, uint192 key) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function depositTo(address account) payable',
];

export const DUST_PAYMASTER_ABI = [
  'function getHash(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature) userOp, uint48 validUntil, uint48 validAfter) view returns (bytes32)',
  'function verifyingSigner() view returns (address)',
];

export const DUST_POOL_ADDRESS = defaultConfig.contracts.dustPool ?? '';
export const DUST_POOL_DEPLOYMENT_BLOCK = defaultConfig.dustPoolDeploymentBlock ?? 0;

export const DUST_POOL_ABI = [
  'function deposit(bytes32 commitment) payable',
  'function withdraw(bytes proof, bytes32 root, bytes32 nullifierHash, address recipient, uint256 amount)',
  'function commitments(bytes32) view returns (bool)',
  'function nullifierHashes(bytes32) view returns (bool)',
  'function isKnownRoot(bytes32 root) view returns (bool)',
  'function getLastRoot() view returns (bytes32)',
  'function nextIndex() view returns (uint256)',
  'event Deposit(bytes32 indexed commitment, uint256 leafIndex, uint256 amount, uint256 timestamp)',
  'event Withdrawal(address indexed recipient, bytes32 nullifierHash, uint256 amount)',
];
