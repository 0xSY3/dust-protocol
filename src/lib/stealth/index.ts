// Stealth address library (ERC-5564/6538)

export type { StealthKeyPair, StealthMetaAddress, GeneratedStealthAddress, StealthAnnouncement, ScanResult, StealthContractAddresses, TokenBalance } from './types';
export { SCHEME_ID, CANONICAL_ADDRESSES, STEALTH_WALLET_FACTORY, STEALTH_WALLET_FACTORY_ABI, ENTRY_POINT_ADDRESS, STEALTH_ACCOUNT_FACTORY, STEALTH_ACCOUNT_FACTORY_ABI, ENTRY_POINT_ABI, DUST_PAYMASTER_ABI, DUST_POOL_ABI } from './types';

export { generateStealthKeyPair, deriveStealthKeyPairFromSignature, deriveStealthKeyPairFromSignatureAndPin, formatStealthMetaAddress, parseStealthMetaAddress, isValidCompressedPublicKey, getPublicKeyFromPrivate, decompressPublicKey, getKeyVersion, setKeyVersion, STEALTH_KEY_DERIVATION_MESSAGE } from './keys';

export { generateStealthAddress, computeStealthPrivateKey, verifyStealthAddress, computeViewTag, getAddressFromPrivateKey, computeStealthWalletAddress, computeStealthAccountAddress, signWalletDrain, signWalletExecute, signUserOp } from './address';

export { scanAnnouncements, scanAnnouncementsViewOnly, getLastScannedBlock, setLastScannedBlock, getAnnouncementCount } from './scanner';

export { registerStealthMetaAddress, registerStealthMetaAddressOnBehalf, lookupStealthMetaAddress, getRegistryNonce, signRegistration, isRegistered, formatBytesToUri } from './registry';

export type { DerivedClaimAddress } from './hdWallet';
export { deriveClaimAddresses, deriveClaimAddressesWithPin, deriveClaimAddressAtIndex, deriveSeedFromSignature, deriveSeedFromSignatureAndPin, getNextClaimAddress, verifyClaimAddressDerivation, saveClaimAddressesToStorage, loadClaimAddressesFromStorage, saveSignatureHash, verifySignatureHash, updateClaimAddressLabel, CLAIM_ADDRESS_DERIVATION_MESSAGE } from './hdWallet';

export { validatePin, encryptPin, decryptPin, deriveSpendingSeed, deriveViewingSeed, deriveClaimSeed, hasPinStored, getStoredPin, storeEncryptedPin, clearStoredPin } from './pin';

export { registerStealthName, resolveStealthName, isNameAvailable, getNameOwner, getNamesOwnedBy, updateNameMetaAddress, transferStealthName, discoverNameByMetaAddress, discoverNameByWalletHistory, setNameRegistryAddress, getNameRegistryAddress, isNameRegistryConfigured, normalizeName, stripNameSuffix, formatNameWithSuffix, isValidName, isStealthName, NAME_SUFFIX } from './names';

export type { RelayerInfo, FeeCalculation, WithdrawResponse, JobStatus } from './relayer';
export { checkRelayerHealth, getRelayerInfo, calculateRelayerFee, submitRelayerWithdraw, getJobStatus, waitForJobCompletion, getRelayerUrl } from './relayer';
