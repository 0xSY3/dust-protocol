"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { useAccount } from "wagmi";
import { useStealthAddress, useStealthName, usePin } from "@/hooks/stealth";
import { DEFAULT_CHAIN_ID, isChainSupported } from "@/config/chains";
import type { StealthKeyPair } from "@/lib/stealth";
import type { OwnedName } from "@/lib/design/types";

const CHAIN_STORAGE_KEY = 'dust_active_chain';
const ONBOARDED_STORAGE_PREFIX = 'dust_onboarded_';

interface AuthState {
  // Connection
  isConnected: boolean;
  address: string | undefined;
  // Chain
  activeChainId: number;
  setActiveChain: (chainId: number) => void;
  // Hydration — true once localStorage has been read
  isHydrated: boolean;
  // PIN
  hasPin: boolean;
  isPinVerified: boolean;
  verifiedPin: string | null;
  setPin: (pin: string, signature: string) => Promise<boolean>;
  verifyPin: (pin: string) => Promise<boolean>;
  clearPin: () => void;
  pinLoading: boolean;
  pinError: string | null;
  // Stealth keys
  stealthKeys: StealthKeyPair | null;
  metaAddress: string | null;
  deriveKeysFromWallet: (pin?: string) => Promise<string | null>;
  clearKeys: () => void;
  isRegistered: boolean;
  registerMetaAddress: () => Promise<string | null>;
  isKeyLoading: boolean;
  isSigningMessage: boolean;
  keyError: string | null;
  // Claim addresses
  claimAddresses: Array<{ address: string; label?: string; balance?: string; privateKey: string; path: string; index: number }>;
  selectedClaimAddress: { address: string; label?: string; balance?: string; privateKey: string; path: string; index: number } | null;
  selectedClaimIndex: number;
  claimAddressesInitialized: boolean;
  selectClaimAddress: (idx: number) => void;
  refreshClaimBalances: () => Promise<void>;
  // Names
  ownedNames: OwnedName[];
  registerName: (name: string, metaAddress: string) => Promise<string | null>;
  formatName: (name: string) => string;
  isOnboarded: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();

  // Active chain state — persisted in localStorage (must be declared before hooks that use it)
  const [activeChainId, setActiveChainIdState] = useState(DEFAULT_CHAIN_ID);

  const stealthAddr = useStealthAddress();
  const nameHook = useStealthName(stealthAddr.metaAddress, activeChainId);
  const pinHook = usePin();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem(CHAIN_STORAGE_KEY);
    if (stored) {
      const id = parseInt(stored, 10);
      if (isChainSupported(id)) setActiveChainIdState(id);
    }
  }, []);

  const setActiveChain = useCallback((chainId: number) => {
    if (!isChainSupported(chainId)) return;
    setActiveChainIdState(chainId);
    if (typeof window !== 'undefined') {
      localStorage.setItem(CHAIN_STORAGE_KEY, chainId.toString());
    }
  }, []);

  // Explicit onboarded flag — synchronous localStorage check, survives cleanup and race conditions
  const hasOnboardedFlag = address
    ? typeof window !== 'undefined' && !!localStorage.getItem(ONBOARDED_STORAGE_PREFIX + address.toLowerCase())
    : false;

  // User is onboarded if the explicit flag is set, OR they have a PIN stored,
  // OR they have stealth keys + claim addresses (legacy fallback)
  const isOnboarded = stealthAddr.isHydrated && (
    hasOnboardedFlag || pinHook.hasPin ||
    (!!stealthAddr.stealthKeys && stealthAddr.claimAddressesInitialized)
  );

  const value: AuthState = {
    isConnected,
    address,
    activeChainId,
    setActiveChain,
    isHydrated: stealthAddr.isHydrated,
    hasPin: pinHook.hasPin,
    isPinVerified: pinHook.isPinVerified,
    verifiedPin: pinHook.verifiedPin,
    setPin: pinHook.setPin,
    verifyPin: pinHook.verifyPin,
    clearPin: pinHook.clearPin,
    pinLoading: pinHook.isLoading,
    pinError: pinHook.error,
    stealthKeys: stealthAddr.stealthKeys,
    metaAddress: stealthAddr.metaAddress,
    deriveKeysFromWallet: stealthAddr.deriveKeysFromWallet,
    clearKeys: stealthAddr.clearKeys,
    isRegistered: stealthAddr.isRegistered,
    registerMetaAddress: stealthAddr.registerMetaAddress,
    isKeyLoading: stealthAddr.isLoading,
    isSigningMessage: stealthAddr.isSigningMessage,
    keyError: stealthAddr.error,
    claimAddresses: stealthAddr.claimAddresses,
    selectedClaimAddress: stealthAddr.selectedClaimAddress,
    selectedClaimIndex: stealthAddr.selectedClaimIndex,
    claimAddressesInitialized: stealthAddr.claimAddressesInitialized,
    selectClaimAddress: stealthAddr.selectClaimAddress,
    refreshClaimBalances: stealthAddr.refreshClaimBalances,
    ownedNames: nameHook.ownedNames,
    registerName: nameHook.registerName,
    formatName: nameHook.formatName,
    isOnboarded,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
