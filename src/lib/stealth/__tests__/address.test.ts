import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ec as EC } from 'elliptic';
import { ethers } from 'ethers';

const secp256k1 = new EC('secp256k1');

// Mock getChainConfig — avoid importing real chain config (hits process.env, viem defineChain, etc.)
vi.mock('@/config/chains', () => {
  const MOCK_WALLET_FACTORY = '0x1c65a6F830359f207e593867B78a303B9D757453';
  const MOCK_ACCOUNT_FACTORY = '0xc73fce071129c7dD7f2F930095AfdE7C1b8eA82A';
  const MOCK_ENTRY_POINT = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';

  // Minimal creation codes (just enough to produce deterministic CREATE2 addresses)
  const MOCK_WALLET_CREATION_CODE = '0x60a060405234801561000f575f80fd5b50';
  const MOCK_ACCOUNT_CREATION_CODE = '0x60c060405234801561000f575f80fd5b50';

  const nonEip7702Config = {
    id: 111551119090,
    name: 'Thanos Sepolia',
    supportsEIP7702: false,
    contracts: {
      walletFactory: MOCK_WALLET_FACTORY,
      accountFactory: MOCK_ACCOUNT_FACTORY,
      entryPoint: MOCK_ENTRY_POINT,
      subAccount7702: null,
      legacyWalletFactory: '',
      legacyAccountFactory: '',
    },
    creationCodes: {
      wallet: MOCK_WALLET_CREATION_CODE,
      account: MOCK_ACCOUNT_CREATION_CODE,
      legacyWallet: '',
      legacyAccount: '',
    },
  };

  const eip7702Config = {
    ...nonEip7702Config,
    id: 11155111,
    name: 'Ethereum Sepolia',
    supportsEIP7702: true,
    contracts: {
      ...nonEip7702Config.contracts,
      subAccount7702: '0xdf34D138d1E0beC7127c32E9Aa1273E8B4DE7dFF',
    },
  };

  return {
    DEFAULT_CHAIN_ID: 11155111,
    getChainConfig: (chainId?: number) => {
      if (chainId === 111551119090) return nonEip7702Config;
      return eip7702Config;
    },
  };
});

import {
  generateStealthAddress,
  computeStealthPrivateKey,
  computeViewTag,
  computeStealthWalletAddress,
  computeStealthAccountAddress,
  getAddressFromPrivateKey,
  verifyStealthAddress,
} from '../address';
import type { StealthMetaAddress } from '../types';

// ── Test fixtures ──────────────────────────────────────────────────────────

function generateTestKeyPair() {
  const kp = secp256k1.genKeyPair();
  return {
    privateKey: kp.getPrivate('hex').padStart(64, '0'),
    publicKey: kp.getPublic(true, 'hex'),
  };
}

function makeMetaAddress(
  spendingPub: string,
  viewingPub: string,
): StealthMetaAddress {
  return {
    prefix: 'eth',
    spendingPublicKey: spendingPub,
    viewingPublicKey: viewingPub,
    raw: `st:eth:0x${spendingPub}${viewingPub}`,
  };
}

// ── generateStealthAddress ──────────────────────────────────────────────────

describe('generateStealthAddress', () => {
  const spending = generateTestKeyPair();
  const viewing = generateTestKeyPair();
  const meta = makeMetaAddress(spending.publicKey, viewing.publicKey);

  it('given valid spending+viewing public keys, when called, then returns a valid Ethereum address + ephemeral public key + view tag', () => {
    // #given — valid meta address with spending and viewing public keys
    // #when
    const result = generateStealthAddress(meta);

    // #then — stealthAddress is a valid checksummed Ethereum address
    expect(result.stealthAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(ethers.utils.isAddress(result.stealthAddress)).toBe(true);

    // ephemeralPublicKey is a valid compressed secp256k1 public key (33 bytes = 66 hex chars)
    expect(result.ephemeralPublicKey).toMatch(/^0[23][0-9a-fA-F]{64}$/);

    // viewTag is a single byte in hex (2 hex chars)
    expect(result.viewTag).toMatch(/^[0-9a-fA-F]{2}$/);
    const tagValue = parseInt(result.viewTag, 16);
    expect(tagValue).toBeGreaterThanOrEqual(0);
    expect(tagValue).toBeLessThanOrEqual(255);

    // stealthEOAAddress is also a valid address
    expect(ethers.utils.isAddress(result.stealthEOAAddress)).toBe(true);

    // stealthPublicKey is a compressed public key
    expect(result.stealthPublicKey).toMatch(/^0[23][0-9a-fA-F]{64}$/);
  });

  it('given same inputs called twice, then output is NOT deterministic because ephemeral key is random', () => {
    // #given — same meta address
    // #when — generate two stealth addresses
    const a = generateStealthAddress(meta);
    const b = generateStealthAddress(meta);

    // #then — different ephemeral keys produce different results
    expect(a.ephemeralPublicKey).not.toBe(b.ephemeralPublicKey);
    expect(a.stealthEOAAddress).not.toBe(b.stealthEOAAddress);
  });

  it('given a non-EIP-7702 chain, then stealthAddress is a CREATE2 account address (not the EOA)', () => {
    // #given — Thanos Sepolia (non-EIP-7702)
    // #when
    const result = generateStealthAddress(meta, 111551119090);

    // #then — stealthAddress differs from stealthEOAAddress (it's the account factory CREATE2)
    expect(result.stealthAddress).not.toBe(result.stealthEOAAddress);
    expect(ethers.utils.isAddress(result.stealthAddress)).toBe(true);
  });

  it('given an EIP-7702 chain, then stealthAddress equals the stealthEOAAddress', () => {
    // #given — Ethereum Sepolia (EIP-7702 enabled)
    // #when
    const result = generateStealthAddress(meta, 11155111);

    // #then — on EIP-7702 chains, payment goes directly to the stealth EOA
    expect(result.stealthAddress).toBe(result.stealthEOAAddress);
  });
});

// ── computeStealthPrivateKey + round-trip ──────────────────────────────────

describe('computeStealthPrivateKey', () => {
  const spending = generateTestKeyPair();
  const viewing = generateTestKeyPair();
  const meta = makeMetaAddress(spending.publicKey, viewing.publicKey);

  it('given spending private key and shared secret params, then derives a valid 64-hex stealth private key', () => {
    // #given
    const ephemeral = secp256k1.genKeyPair();
    const ephemeralPub = ephemeral.getPublic(true, 'hex');

    // #when
    const stealthPrivKey = computeStealthPrivateKey(
      spending.privateKey,
      viewing.privateKey,
      ephemeralPub,
    );

    // #then — 64-char lowercase hex string (32 bytes)
    expect(stealthPrivKey).toMatch(/^[0-9a-fA-F]{64}$/);
  });

  it('given the stealth private key, when getAddressFromPrivateKey called, then it matches the stealthEOAAddress from generateStealthAddress (round-trip)', () => {
    // #given — generate a stealth address with a known ephemeral key
    const ephemeral = secp256k1.genKeyPair();
    const ephemeralPub = ephemeral.getPublic(true, 'hex');

    // Manually compute what generateStealthAddress does, but with our known ephemeral key
    const sharedSecret = computeSharedSecretHelper(
      ephemeral.getPrivate('hex'),
      viewing.publicKey,
    );
    const secretHash = ethers.utils.keccak256('0x' + sharedSecret);

    const spendingKey = secp256k1.keyFromPublic(spending.publicKey, 'hex');
    const hashKey = secp256k1.keyFromPrivate(secretHash.slice(2), 'hex');
    const stealthPubPoint = spendingKey.getPublic().add(hashKey.getPublic());
    const uncompressed = stealthPubPoint.encode('hex', false).slice(2);
    const expectedEOA = ethers.utils.getAddress(
      '0x' + ethers.utils.keccak256('0x' + uncompressed).slice(-40),
    );

    // #when — derive stealth private key from the recipient's side
    const stealthPrivKey = computeStealthPrivateKey(
      spending.privateKey,
      viewing.privateKey,
      ephemeralPub,
    );
    const derivedAddress = getAddressFromPrivateKey(stealthPrivKey);

    // #then — the address from the private key matches the expected stealth EOA
    expect(derivedAddress.toLowerCase()).toBe(expectedEOA.toLowerCase());
  });

  it('given different ephemeral keys, then different stealth private keys are produced', () => {
    // #given
    const ephA = secp256k1.genKeyPair();
    const ephB = secp256k1.genKeyPair();

    // #when
    const privA = computeStealthPrivateKey(
      spending.privateKey,
      viewing.privateKey,
      ephA.getPublic(true, 'hex'),
    );
    const privB = computeStealthPrivateKey(
      spending.privateKey,
      viewing.privateKey,
      ephB.getPublic(true, 'hex'),
    );

    // #then
    expect(privA).not.toBe(privB);
  });
});

// ── computeViewTag ──────────────────────────────────────────────────────────

describe('computeViewTag', () => {
  const viewing = generateTestKeyPair();
  const ephemeral = secp256k1.genKeyPair();
  const ephemeralPub = ephemeral.getPublic(true, 'hex');

  it('given a shared secret, then view tag is a single byte (0-255)', () => {
    // #given — viewing private key + ephemeral public key
    // #when
    const tag = computeViewTag(viewing.privateKey, ephemeralPub);

    // #then — 2 hex chars representing a byte
    expect(tag).toMatch(/^[0-9a-fA-F]{2}$/);
    const value = parseInt(tag, 16);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(255);
  });

  it('given same shared secret, then view tag is deterministic', () => {
    // #given — same inputs
    // #when
    const tag1 = computeViewTag(viewing.privateKey, ephemeralPub);
    const tag2 = computeViewTag(viewing.privateKey, ephemeralPub);

    // #then
    expect(tag1).toBe(tag2);
  });

  it('given different ephemeral keys, then view tags differ (with high probability)', () => {
    // #given
    const eph2 = secp256k1.genKeyPair();

    // #when
    const tag1 = computeViewTag(viewing.privateKey, ephemeralPub);
    const tag2 = computeViewTag(viewing.privateKey, eph2.getPublic(true, 'hex'));

    // #then — statistically almost certain to differ (1/256 collision chance)
    // Run multiple times to reduce flakiness
    const tags = new Set<string>();
    tags.add(tag1);
    tags.add(tag2);
    for (let i = 0; i < 10; i++) {
      const eph = secp256k1.genKeyPair();
      tags.add(computeViewTag(viewing.privateKey, eph.getPublic(true, 'hex')));
    }
    // At least some distinct tags in 12 samples (virtually guaranteed)
    expect(tags.size).toBeGreaterThan(1);
  });

  it('given invalid inputs, then returns empty string', () => {
    // #given — garbage input
    // #when
    const tag = computeViewTag('invalid', 'alsobad');

    // #then
    expect(tag).toBe('');
  });
});

// ── computeStealthWalletAddress / computeStealthAccountAddress ──────────────

describe('computeStealthWalletAddress', () => {
  const ownerEOA = '0x1234567890abcdef1234567890abcdef12345678';

  it('given an owner address, then CREATE2 wallet address is deterministic', () => {
    // #given — same owner address
    // #when
    const addr1 = computeStealthWalletAddress(ownerEOA);
    const addr2 = computeStealthWalletAddress(ownerEOA);

    // #then
    expect(addr1).toBe(addr2);
    expect(ethers.utils.isAddress(addr1)).toBe(true);
  });

  it('given different owner addresses, then different wallet addresses are produced', () => {
    // #given
    const otherOwner = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

    // #when
    const addr1 = computeStealthWalletAddress(ownerEOA);
    const addr2 = computeStealthWalletAddress(otherOwner);

    // #then
    expect(addr1).not.toBe(addr2);
  });

  it('given a chain ID, then uses chain-specific factory (still deterministic)', () => {
    // #given — Thanos Sepolia chainId
    // #when
    const addr1 = computeStealthWalletAddress(ownerEOA, 111551119090);
    const addr2 = computeStealthWalletAddress(ownerEOA, 111551119090);

    // #then
    expect(addr1).toBe(addr2);
    expect(ethers.utils.isAddress(addr1)).toBe(true);
  });
});

describe('computeStealthAccountAddress', () => {
  const ownerEOA = '0x1234567890abcdef1234567890abcdef12345678';

  it('given an owner address, then ERC-4337 account address is deterministic', () => {
    // #given — same owner address
    // #when
    const addr1 = computeStealthAccountAddress(ownerEOA);
    const addr2 = computeStealthAccountAddress(ownerEOA);

    // #then
    expect(addr1).toBe(addr2);
    expect(ethers.utils.isAddress(addr1)).toBe(true);
  });

  it('given different owner addresses, then different account addresses are produced', () => {
    // #given
    const otherOwner = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

    // #when
    const addr1 = computeStealthAccountAddress(ownerEOA);
    const addr2 = computeStealthAccountAddress(otherOwner);

    // #then
    expect(addr1).not.toBe(addr2);
  });

  it('given a chain ID, then uses chain-specific factory (still deterministic)', () => {
    // #given
    // #when
    const addr1 = computeStealthAccountAddress(ownerEOA, 111551119090);
    const addr2 = computeStealthAccountAddress(ownerEOA, 111551119090);

    // #then
    expect(addr1).toBe(addr2);
    expect(ethers.utils.isAddress(addr1)).toBe(true);
  });

  it('wallet address and account address for same owner are different', () => {
    // #given — same owner
    // #when
    const wallet = computeStealthWalletAddress(ownerEOA);
    const account = computeStealthAccountAddress(ownerEOA);

    // #then — different factories/creation codes produce different addresses
    expect(wallet).not.toBe(account);
  });
});

// ── getAddressFromPrivateKey ──────────────────────────────────────────────────

describe('getAddressFromPrivateKey', () => {
  it('given a valid private key hex, then returns a checksummed Ethereum address', () => {
    // #given — a known private key
    const kp = secp256k1.genKeyPair();
    const privKey = kp.getPrivate('hex').padStart(64, '0');

    // #when
    const address = getAddressFromPrivateKey(privKey);

    // #then
    expect(ethers.utils.isAddress(address)).toBe(true);
    // Verify it's checksummed (getAddress returns checksummed)
    expect(address).toBe(ethers.utils.getAddress(address));
  });

  it('given a deterministic private key, then address is deterministic', () => {
    // #given — fixed private key
    const fixedPrivKey = 'a'.repeat(64);

    // #when
    const addr1 = getAddressFromPrivateKey(fixedPrivKey);
    const addr2 = getAddressFromPrivateKey(fixedPrivKey);

    // #then
    expect(addr1).toBe(addr2);
  });

  it('given different private keys, then different addresses are produced', () => {
    // #given
    const keyA = 'a'.repeat(64);
    const keyB = 'b'.repeat(64);

    // #when
    const addrA = getAddressFromPrivateKey(keyA);
    const addrB = getAddressFromPrivateKey(keyB);

    // #then
    expect(addrA).not.toBe(addrB);
  });
});

// ── verifyStealthAddress ──────────────────────────────────────────────────────

describe('verifyStealthAddress', () => {
  const spending = generateTestKeyPair();
  const viewing = generateTestKeyPair();

  it('given correct inputs, then verification returns true', () => {
    // #given — manually create stealth address the same way generateStealthAddress does
    const ephemeral = secp256k1.genKeyPair();
    const ephemeralPub = ephemeral.getPublic(true, 'hex');
    const sharedSecret = computeSharedSecretHelper(
      ephemeral.getPrivate('hex'),
      viewing.publicKey,
    );
    const secretHash = ethers.utils.keccak256('0x' + sharedSecret);
    const spendingKey = secp256k1.keyFromPublic(spending.publicKey, 'hex');
    const hashKey = secp256k1.keyFromPrivate(secretHash.slice(2), 'hex');
    const stealthPubPoint = spendingKey.getPublic().add(hashKey.getPublic());
    const uncompressed = stealthPubPoint.encode('hex', false).slice(2);
    const stealthEOA = ethers.utils.getAddress(
      '0x' + ethers.utils.keccak256('0x' + uncompressed).slice(-40),
    );

    // #when
    const result = verifyStealthAddress(
      ephemeralPub,
      spending.publicKey,
      stealthEOA,
      viewing.privateKey,
    );

    // #then
    expect(result).toBe(true);
  });

  it('given wrong expected address, then verification returns false', () => {
    // #given
    const ephemeral = secp256k1.genKeyPair();
    const wrongAddress = '0x0000000000000000000000000000000000000001';

    // #when
    const result = verifyStealthAddress(
      ephemeral.getPublic(true, 'hex'),
      spending.publicKey,
      wrongAddress,
      viewing.privateKey,
    );

    // #then
    expect(result).toBe(false);
  });

  it('given invalid inputs, then returns false without throwing', () => {
    // #given — garbage inputs
    // #when
    const result = verifyStealthAddress(
      'invalidpubkey',
      'invalidspending',
      '0x0000000000000000000000000000000000000001',
      'invalidviewing',
    );

    // #then
    expect(result).toBe(false);
  });
});

// ── Full ECDH round-trip integration ──────────────────────────────────────────

describe('full ECDH round-trip', () => {
  it('sender generates stealth address, recipient derives private key, addresses match', () => {
    // #given — recipient key pairs
    const spending = generateTestKeyPair();
    const viewing = generateTestKeyPair();
    const meta = makeMetaAddress(spending.publicKey, viewing.publicKey);

    // #when — sender generates stealth address (non-EIP-7702 chain for account address test)
    const generated = generateStealthAddress(meta, 111551119090);

    // recipient derives stealth private key
    const stealthPrivKey = computeStealthPrivateKey(
      spending.privateKey,
      viewing.privateKey,
      generated.ephemeralPublicKey,
    );

    // recipient derives address from private key
    const derivedAddress = getAddressFromPrivateKey(stealthPrivKey);

    // #then — derived EOA address matches the generated stealthEOAAddress
    expect(derivedAddress.toLowerCase()).toBe(
      generated.stealthEOAAddress.toLowerCase(),
    );

    // Verify the view tag also matches
    const tag = computeViewTag(viewing.privateKey, generated.ephemeralPublicKey);
    expect(tag).toBe(generated.viewTag);

    // verifyStealthAddress should also confirm
    const verified = verifyStealthAddress(
      generated.ephemeralPublicKey,
      spending.publicKey,
      generated.stealthEOAAddress,
      viewing.privateKey,
    );
    expect(verified).toBe(true);
  });
});

// ── Helper: replicates the private computeSharedSecret for test setup ────────

function computeSharedSecretHelper(
  privateKey: string,
  publicKey: string,
): string {
  const priv = secp256k1.keyFromPrivate(privateKey.replace(/^0x/, ''), 'hex');
  const pub = secp256k1.keyFromPublic(publicKey.replace(/^0x/, ''), 'hex');
  return priv.derive(pub.getPublic()).toString('hex').padStart(64, '0');
}
