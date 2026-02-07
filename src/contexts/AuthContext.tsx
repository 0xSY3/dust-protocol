"use client";

import { createContext, useContext, ReactNode } from "react";
import { useAccount } from "wagmi";
import { useStealthAddress, useStealthName, usePin } from "@/hooks/stealth";
import type { StealthKeyPair } from "@/lib/stealth";
import type { OwnedName } from "@/lib/design/types";

interface AuthState {
  // Connection
  isConnected: boolean;
  address: string | undefined;
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
  isOnboarded: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();
  const stealthAddr = useStealthAddress();
  const nameHook = useStealthName(stealthAddr.metaAddress);
  const pinHook = usePin();

  // User is onboarded if they have stealth keys + claim addresses, OR if they have a PIN stored
  // (PIN is only set during onboarding activation, so it's a reliable signal)
  const isOnboarded = stealthAddr.isHydrated && (
    (!!stealthAddr.stealthKeys && stealthAddr.claimAddressesInitialized) || pinHook.hasPin
  );

  const value: AuthState = {
    isConnected,
    address,
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
    isOnboarded,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
