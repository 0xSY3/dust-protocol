"use client";

import { useState, useEffect, ChangeEvent } from "react";
import { Box, Text, VStack, HStack, Input, Spinner, Flex } from "@chakra-ui/react";
import { Button } from "../ui/button";
import { keyframes, Keyframes } from "@emotion/react";
import {
  useStealthAddress,
  useStealthScanner,
  useStealthSend,
  useStealthName,
} from "@/hooks/stealth";
import { useAuth } from "@/contexts/AuthContext";
import { useWalletConnect } from "@/hooks/wallet-connect/useWalletConnect";
import { isStealthName, NAME_SUFFIX, GeneratedStealthAddress, ScanResult } from "@/lib/stealth";
import { getChainConfig, MIN_CLAIMABLE_BALANCE } from "@/config/chains";
import { isPrivyEnabled } from "@/config/privy";
import { useLogin } from "@privy-io/react-auth";
import { useConnect } from "wagmi";
import { injected } from "wagmi/connectors";
import {
  ShieldIcon, LockIcon, SendIcon, InboxIcon, SettingsIcon, HomeIcon,
  CopyIcon, CheckIcon, CheckCircleIcon, AlertCircleIcon, InfoIcon,
  WalletIcon, RefreshIcon, ArrowUpRightIcon, ArrowDownLeftIcon,
  TagIcon, TrashIcon, KeyIcon, HistoryIcon, MailIcon,
} from "./icons";

interface ColorTokens {
  bg: { page: string; card: string; input: string; elevated: string; hover: string };
  border: { default: string; light: string; accent: string; accentGreen: string };
  text: { primary: string; secondary: string; tertiary: string; muted: string };
  accent: { indigo: string; indigoBright: string; indigoDark: string; green: string; greenBright: string; greenDark: string; red: string; redDark: string; amber: string };
  glow: { indigo: string; green: string };
}

interface RadiusTokens {
  xl: string; lg: string; md: string; sm: string; xs: string;
}

interface OwnedName {
  name: string;
  fullName: string;
}

interface ClaimAddress {
  address: string;
  label?: string;
  balance?: string;
}

interface StealthPayment extends ScanResult {
  balance?: string;
  claimed?: boolean;
  keyMismatch?: boolean;
}

const colors: ColorTokens = {
  bg: { page: "#07070a", card: "#0d0d12", input: "#12121a", elevated: "#1a1a24", hover: "#22222e" },
  border: { default: "#2d2d3a", light: "#3d3d4a", accent: "#6366f1", accentGreen: "#10b981" },
  text: { primary: "#ffffff", secondary: "#e2e2e8", tertiary: "#a0a0b0", muted: "#6b6b7a" },
  accent: {
    indigo: "#7c7fff", indigoBright: "#9b9eff", indigoDark: "#5b5edd",
    green: "#00d68f", greenBright: "#00ffaa", greenDark: "#00b377",
    red: "#ff6b6b", redDark: "#ff4757", amber: "#ffbe0b",
  },
  glow: { indigo: "0 0 30px rgba(124, 127, 255, 0.3)", green: "0 0 30px rgba(0, 214, 143, 0.3)" },
};

const radius: RadiusTokens = { xl: "20px", lg: "16px", md: "12px", sm: "8px", xs: "6px" };

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
`;

type ViewType = "home" | "send" | "inbox" | "history" | "settings";

export const PrivateWallet = () => {
  const { isConnected, address } = useWalletConnect();
  const { ownedNames: authOwnedNames } = useAuth();
  const {
    stealthKeys, metaAddress, deriveKeysFromWallet, clearKeys,
    registerMetaAddress, isRegistered, isLoading: isKeyLoading,
    isSigningMessage, error: keyError,
    // Unified claim addresses
    claimAddresses, selectedClaimAddress, selectedClaimIndex, claimAddressesInitialized,
    selectClaimAddress,
  } = useStealthAddress();

  const { payments, scan, isScanning, claimPayment, error: scanError } = useStealthScanner(stealthKeys);
  const { generateAddressFor, sendEthToStealth, lastGeneratedAddress, isLoading: isSendLoading, error: sendError } = useStealthSend();
  const { ownedNames: _hookNames, registerName, checkAvailability, resolveName, validateName, formatName, isConfigured: nameRegistryConfigured, isLoading: isNameLoading } = useStealthName();
  const { login: privyLogin } = useLogin();
  const { connect } = useConnect();
  // Use AuthContext's ownedNames — it has discovery via metaAddress, whereas the local hook does not
  const ownedNames = authOwnedNames.length > 0 ? authOwnedNames : _hookNames;
  const [view, setView] = useState<ViewType>("home");
  const [copied, setCopied] = useState(false);
  const [setupStep, setSetupStep] = useState<"welcome" | "signing" | "ready">("welcome");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [sendStep, setSendStep] = useState<"input" | "confirm" | "success">("input");
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [resolvedLinkSlug, setResolvedLinkSlug] = useState<string | undefined>(undefined);
  const [isResolving, setIsResolving] = useState(false);
  const [sendTxHash, setSendTxHash] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [isNameAvailable, setIsNameAvailable] = useState<boolean | null>(null);
  const [isCheckingName, setIsCheckingName] = useState(false);
  const [claimingIndex, setClaimingIndex] = useState<number | null>(null);
  const [claimedTx, setClaimedTx] = useState<string | null>(null);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);

  const pendingPayments = payments.filter(p => {
    if (p.claimed || p.keyMismatch) return false;
    const bal = parseFloat(p.balance || "0");
    // Sponsored wallet types (create2, account, eip7702) can claim any amount
    // Only apply minimum balance check for EOA wallets where user pays gas
    if (p.walletType && p.walletType !== 'eoa') return bal > 0;
    return bal >= MIN_CLAIMABLE_BALANCE;
  });

  useEffect(() => {
    const resolve = async () => {
      setResolvedLinkSlug(undefined);
      if (!recipient) { setResolvedAddress(null); return; }
      if (recipient.startsWith("st:")) { setResolvedAddress(recipient); return; }
      if (nameRegistryConfigured && isStealthName(recipient)) {
        setIsResolving(true);
        let nameToResolve = recipient;
        const normalized = recipient.toLowerCase().trim();
        if (normalized.endsWith('.tok')) {
          const withoutSuffix = normalized.slice(0, -4);
          const parts = withoutSuffix.split(".");
          if (parts.length > 1) {
            nameToResolve = parts[parts.length - 1] + '.tok';
            setResolvedLinkSlug(parts[0]);
          }
        }
        const resolved = await resolveName(nameToResolve);
        setIsResolving(false);
        if (resolved) {
          setResolvedAddress(`st:thanos:${resolved}`);
        } else {
          setResolvedAddress(null);
          setResolvedLinkSlug(undefined);
        }
        return;
      }
      setResolvedAddress(null);
    };
    const t = setTimeout(resolve, 300);
    return () => clearTimeout(t);
  }, [recipient, nameRegistryConfigured, resolveName]);

  useEffect(() => {
    const check = async () => {
      if (!nameInput || !nameRegistryConfigured) { setIsNameAvailable(null); return; }
      if (!validateName(nameInput).valid) { setIsNameAvailable(null); return; }
      setIsCheckingName(true);
      const available = await checkAvailability(nameInput);
      setIsNameAvailable(available);
      setIsCheckingName(false);
    };
    const t = setTimeout(check, 500);
    return () => clearTimeout(t);
  }, [nameInput, nameRegistryConfigured, validateName, checkAvailability]);

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSetup = async () => {
    setSetupStep("signing");
    try {
      const result = await deriveKeysFromWallet();
      if (!result) {
        // Signature was rejected or failed — go back to welcome
        setSetupStep("welcome");
        return;
      }
      setSetupStep("ready");
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes('User rejected') || errMsg.includes('user_rejected') || errMsg.includes('ACTION_REJECTED')) {
        // User cancelled — don't show error toast, just reset
        setSetupStep("welcome");
        return;
      }
      console.error('[PrivateWallet] Signature failed:', errMsg);
      setSetupStep("welcome");
    }
  };

  const handleSendPreview = () => {
    const addr = resolvedAddress || recipient;
    if (!addr || !amount) return;
    if (generateAddressFor(addr)) setSendStep("confirm");
  };

  const handleSend = async () => {
    try {
      const hash = await sendEthToStealth(resolvedAddress || recipient, amount, resolvedLinkSlug);
      if (hash) { setSendTxHash(hash); setSendStep("success"); }
    } catch {
      // Error state already set by sendEthToStealth
    }
  };

  const handleClaim = async (index: number) => {
    setClaimingIndex(index);
    try {
      const payment = payments[index];
      const claimTo = claimAddressesInitialized && selectedClaimAddress ? selectedClaimAddress.address : address;
      if (!claimTo) return;

      // Always use standard claim path — relayer mode deprecated (keys must stay client-side)
      const txHash = await claimPayment(payment, claimTo);
      if (txHash) setClaimedTx(txHash);
    } catch {
      // Error state already set by claimPayment
    } finally {
      setClaimingIndex(null);
    }
  };

  const handleRegisterName = async () => {
    if (!metaAddress || !nameInput) return;
    const txHash = await registerName(nameInput, metaAddress);
    if (txHash) {
      setNameInput(""); setIsNameAvailable(null);
      // Also register on-chain (ERC-6538) so people can find you by wallet address too
      if (!isRegistered) {
        try { await registerMetaAddress(); } catch { /* non-critical */ }
      }
      setRegistrationSuccess(true);
      setTimeout(() => setRegistrationSuccess(false), 5000);
    }
  };

  const resetSendFlow = () => {
    setRecipient(""); setAmount(""); setSendStep("input");
    setSendTxHash(null); setResolvedAddress(null);
  };

  if (!isConnected) {
    return (
      <Box w="100%" p="48px 32px" bgColor={colors.bg.card} borderRadius={radius.xl} border={`1px solid ${colors.border.default}`} textAlign="center">
        <VStack gap="24px">
          <Box color={colors.accent.indigo} opacity={0.9}><ShieldIcon size={48} /></Box>
          <VStack gap="8px">
            <Text fontSize="20px" fontWeight={600} color={colors.text.primary}>Private Wallet</Text>
            <Text fontSize="14px" color={colors.text.muted} maxW="280px" lineHeight="1.6">
              Send and receive payments that cannot be traced to your identity
            </Text>
          </VStack>

          <VStack gap="12px" w="100%" maxW="320px">
            {/* Social login buttons — only when Privy is configured */}
            {isPrivyEnabled && (
              <>
                <Button
                  w="100%" h="46px"
                  bgColor={colors.bg.input}
                  borderRadius={radius.sm}
                  border={`1px solid ${colors.border.default}`}
                  fontWeight={500} fontSize="14px"
                  color={colors.text.primary}
                  _hover={{ bgColor: colors.bg.elevated, borderColor: colors.border.light }}
                  onClick={() => privyLogin({ loginMethods: ['google'] })}
                >
                  <HStack gap="10px">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    <Text>Continue with Google</Text>
                  </HStack>
                </Button>

                <Button
                  w="100%" h="46px"
                  bgColor={colors.bg.input}
                  borderRadius={radius.sm}
                  border={`1px solid ${colors.border.default}`}
                  fontWeight={500} fontSize="14px"
                  color={colors.text.primary}
                  _hover={{ bgColor: colors.bg.elevated, borderColor: colors.border.light }}
                  onClick={() => privyLogin({ loginMethods: ['email'] })}
                >
                  <HStack gap="10px">
                    <MailIcon size={18} color={colors.text.tertiary} />
                    <Text>Continue with Email</Text>
                  </HStack>
                </Button>

                <Button
                  w="100%" h="46px"
                  bgColor={colors.bg.input}
                  borderRadius={radius.sm}
                  border={`1px solid ${colors.border.default}`}
                  fontWeight={500} fontSize="14px"
                  color={colors.text.primary}
                  _hover={{ bgColor: colors.bg.elevated, borderColor: colors.border.light }}
                  onClick={() => privyLogin({ loginMethods: ['farcaster'] })}
                >
                  <HStack gap="10px">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M5.5 3h13v18h-2.25v-7.5a4.25 4.25 0 0 0-8.5 0V21H5.5V3z" fill="#855DCD"/>
                      <path d="M3 5.5L5.5 3h13L21 5.5H3z" fill="#855DCD"/>
                    </svg>
                    <Text>Continue with Farcaster</Text>
                  </HStack>
                </Button>

                {/* Divider */}
                <HStack w="100%" gap="12px" align="center" py="4px">
                  <Box flex={1} h="1px" bgColor={colors.border.default} />
                  <Text fontSize="11px" color={colors.text.muted} textTransform="uppercase" letterSpacing="0.1em" fontWeight={500}>or</Text>
                  <Box flex={1} h="1px" bgColor={colors.border.default} />
                </HStack>
              </>
            )}

            {/* Wallet connect button */}
            <Button
              w="100%" h="46px"
              bgColor={colors.accent.indigoDark}
              borderRadius={radius.sm}
              fontWeight={500} fontSize="14px"
              color="#fff"
              _hover={{ bgColor: colors.accent.indigo }}
              onClick={() => connect({ connector: injected() })}
            >
              <HStack gap="10px">
                <WalletIcon size={18} />
                <Text>Connect Wallet</Text>
              </HStack>
            </Button>
          </VStack>
        </VStack>
      </Box>
    );
  }

  if (!stealthKeys) {
    return (
      <Box w="100%" p="48px 32px" bgColor={colors.bg.card} borderRadius={radius.xl} border={`1px solid ${colors.border.default}`} animation={`${fadeIn} 0.4s ease-out`}>
        <VStack gap="32px">
          <VStack gap="16px" textAlign="center">
            <Box color={colors.accent.indigo} opacity={0.9}><KeyIcon size={44} /></Box>
            <VStack gap="8px">
              <Text fontSize="20px" fontWeight={600} color={colors.text.primary}>Activate Private Mode</Text>
              <Text fontSize="14px" color={colors.text.muted} maxW="320px" lineHeight="1.6">
                Create your private receiving address. Anyone can send to it, but only you can access the funds.
              </Text>
            </VStack>
          </VStack>

          {setupStep === "welcome" && (
            <Button h="46px" px="28px" bgColor={colors.accent.indigoDark} borderRadius={radius.sm} fontWeight={500} fontSize="14px" color="#fff"
              _hover={{ bgColor: colors.accent.indigo }} onClick={handleSetup} disabled={isKeyLoading || isSigningMessage}>
              Create Private Address
            </Button>
          )}

          {setupStep === "signing" && (
            <VStack gap="12px">
              <Spinner size="md" color={colors.accent.indigo} />
              <Text fontSize="13px" color={colors.text.muted}>Sign the message in your wallet...</Text>
            </VStack>
          )}

          {keyError && (
            <HStack gap="8px" p="12px 16px" bgColor="rgba(248, 113, 113, 0.08)" borderRadius={radius.xs}>
              <AlertCircleIcon size={16} color={colors.accent.red} />
              <Text fontSize="13px" color={colors.accent.red}>{keyError}</Text>
            </HStack>
          )}

          <Box p="14px 16px" bgColor={colors.bg.input} borderRadius={radius.sm} border={`1px solid ${colors.border.default}`}>
            <HStack gap="12px" align="flex-start">
              <Box color={colors.text.muted} flexShrink={0} mt="1px"><InfoIcon size={14} /></Box>
              <Text fontSize="12px" color={colors.text.muted} lineHeight="1.5">
                Your private address is derived from your wallet signature. You can recover it anytime by signing the same message.
              </Text>
            </HStack>
          </Box>
        </VStack>
      </Box>
    );
  }

  return (
    <Box w="100%" bgColor={colors.bg.card} borderRadius={radius.xl} border={`1.5px solid ${colors.border.default}`} overflow="hidden"
      animation={`${fadeIn} 0.3s ease-out`} boxShadow="0 8px 32px rgba(0, 0, 0, 0.4)">

      {/* Header */}
      <Box p="24px" borderBottom={`1px solid ${colors.border.default}`} bgGradient="linear(180deg, rgba(124, 127, 255, 0.04) 0%, transparent 100%)">
        <Flex justify="space-between" align="flex-start">
          <VStack align="flex-start" gap="10px">
            <Text fontSize="11px" color={colors.accent.indigo} textTransform="uppercase" letterSpacing="0.12em" fontWeight={700}>Private Wallet</Text>
            <HStack gap="14px" align="center">
              {ownedNames.length > 0 ? (
                <Text fontSize="20px" fontWeight={700} color={colors.text.primary}>{ownedNames[0].fullName}</Text>
              ) : (
                <Text fontSize="14px" color={colors.text.secondary} fontFamily="'JetBrains Mono', monospace">{metaAddress?.slice(0, 18)}...</Text>
              )}
              <Button h="32px" px="14px" bgColor={copied ? "rgba(0, 214, 143, 0.2)" : colors.bg.elevated} borderRadius={radius.xs}
                border={`1.5px solid ${copied ? colors.accent.green : colors.border.light}`} fontSize="12px" fontWeight={600}
                color={copied ? colors.accent.greenBright : colors.text.secondary}
                _hover={{ bgColor: colors.accent.indigo, borderColor: colors.accent.indigo, color: "#fff" }}
                onClick={() => handleCopy(ownedNames.length > 0 ? ownedNames[0].fullName : metaAddress || "")}>
                <HStack gap="6px">
                  {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                  <Text>{copied ? "Copied" : "Copy"}</Text>
                </HStack>
              </Button>
            </HStack>
            {isRegistered && (
              <HStack gap="6px">
                <CheckCircleIcon size={13} color={colors.accent.greenBright} />
                <Text fontSize="12px" color={colors.accent.greenBright} fontWeight={600}>Registered on-chain</Text>
              </HStack>
            )}
          </VStack>
          {pendingPayments.length > 0 && (
            <Button h="36px" px="16px" bgGradient="linear(135deg, rgba(255, 190, 11, 0.15) 0%, rgba(255, 190, 11, 0.05) 100%)"
              borderRadius={radius.sm} border="1.5px solid rgba(255, 190, 11, 0.5)"
              _hover={{ bgGradient: "linear(135deg, rgba(255, 190, 11, 0.25) 0%, rgba(255, 190, 11, 0.1) 100%)" }}
              onClick={() => setView("inbox")}>
              <HStack gap="8px">
                <InboxIcon size={16} color={colors.accent.amber} />
                <Text fontSize="13px" fontWeight={700} color={colors.accent.amber}>{pendingPayments.length} pending</Text>
              </HStack>
            </Button>
          )}
        </Flex>
      </Box>

      {/* Navigation */}
      <Flex p="10px 12px" gap="4px" borderBottom={`1px solid ${colors.border.default}`} bgColor={colors.bg.input} justify="space-between">
        {([
          { id: "home", label: "Home", Icon: HomeIcon },
          { id: "send", label: "Send", Icon: SendIcon },
          { id: "inbox", label: "Inbox", Icon: InboxIcon },
          { id: "history", label: "History", Icon: HistoryIcon },
          { id: "settings", label: "", Icon: SettingsIcon },
        ] as const).map((item) => (
          <Button
            key={item.id}
            h="36px"
            px={item.label ? "12px" : "10px"}
            minW={item.label ? "auto" : "36px"}
            bgColor={view === item.id ? colors.bg.elevated : "transparent"}
            borderRadius={radius.xs}
            border={view === item.id ? `1.5px solid ${colors.accent.indigo}` : "1.5px solid transparent"}
            fontWeight={view === item.id ? 600 : 500}
            fontSize="12px"
            color={view === item.id ? colors.text.primary : colors.text.tertiary}
            _hover={{ bgColor: colors.bg.elevated, color: colors.text.primary }}
            onClick={() => setView(item.id)}
            position="relative"
          >
            <HStack gap="6px">
              <item.Icon size={16} color={view === item.id ? colors.accent.indigo : colors.text.tertiary} />
              {item.label && <Text>{item.label}</Text>}
            </HStack>
            {item.id === "inbox" && pendingPayments.length > 0 && (
              <Box
                position="absolute"
                top="-4px"
                right="-4px"
                minW="18px"
                h="18px"
                px="5px"
                borderRadius="9px"
                bgColor={colors.accent.amber}
                display="flex"
                alignItems="center"
                justifyContent="center"
              >
                <Text fontSize="10px" fontWeight={700} color="#000">{pendingPayments.length}</Text>
              </Box>
            )}
          </Button>
        ))}
      </Flex>

      {/* Content */}
      <Box p="20px">
        {view === "home" && <HomeView {...{ colors, radius, fadeIn, ownedNames, nameRegistryConfigured, nameInput, setNameInput, isCheckingName, isNameAvailable, formatName, validateName, handleRegisterName, isNameLoading, setView, scan, isRegistered, isKeyLoading, registrationSuccess, handleCopy }} />}
        {view === "send" && <SendView {...{ colors, radius, fadeIn, sendStep, recipient, setRecipient, amount, setAmount, isResolving, resolvedAddress, handleSendPreview, handleSend, setSendStep, lastGeneratedAddress, isSendLoading, sendTxHash, resetSendFlow, sendError }} />}
        {view === "inbox" && <InboxView {...{ colors, radius, fadeIn, payments, isScanning, scan, claimAddressesInitialized, claimAddresses, selectedIndex: selectedClaimIndex, selectAddress: selectClaimAddress, handleClaim, claimingIndex, claimedTx, scanError }} />}
        {view === "history" && <HistoryView {...{ colors, radius, fadeIn, payments }} />}
        {view === "settings" && <SettingsView {...{ colors, radius, fadeIn, metaAddress, handleCopy, copied, claimAddressesInitialized, claimAddresses, clearKeys }} />}
      </Box>
    </Box>
  );
};

// Sub-component interfaces
interface HomeViewProps {
  colors: ColorTokens;
  radius: RadiusTokens;
  fadeIn: Keyframes;
  ownedNames: OwnedName[];
  nameRegistryConfigured: boolean;
  nameInput: string;
  setNameInput: (v: string) => void;
  isCheckingName: boolean;
  isNameAvailable: boolean | null;
  formatName: (name: string) => string;
  validateName: (name: string) => { valid: boolean; error?: string };
  handleRegisterName: () => void;
  isNameLoading: boolean;
  setView: (v: ViewType) => void;
  scan: () => void;
  isRegistered: boolean;
  isKeyLoading: boolean;
  registrationSuccess: boolean;
  handleCopy: (text: string) => void;
}

interface SendViewProps {
  colors: ColorTokens;
  radius: RadiusTokens;
  fadeIn: Keyframes;
  sendStep: "input" | "confirm" | "success";
  recipient: string;
  setRecipient: (v: string) => void;
  amount: string;
  setAmount: (v: string) => void;
  isResolving: boolean;
  resolvedAddress: string | null;
  handleSendPreview: () => void;
  handleSend: () => Promise<void>;
  setSendStep: (v: "input" | "confirm" | "success") => void;
  lastGeneratedAddress: GeneratedStealthAddress | null;
  isSendLoading: boolean;
  sendTxHash: string | null;
  resetSendFlow: () => void;
  sendError: string | null;
}

interface InboxViewProps {
  colors: ColorTokens;
  radius: RadiusTokens;
  fadeIn: Keyframes;
  payments: StealthPayment[];
  isScanning: boolean;
  scan: () => void;
  claimAddressesInitialized: boolean;
  claimAddresses: ClaimAddress[];
  selectedIndex: number;
  selectAddress: (idx: number) => void;
  handleClaim: (idx: number) => Promise<void>;
  claimingIndex: number | null;
  claimedTx: string | null;
  scanError: string | null;
}

interface SettingsViewProps {
  colors: ColorTokens;
  radius: RadiusTokens;
  fadeIn: Keyframes;
  metaAddress: string | null;
  handleCopy: (text: string) => void;
  copied: boolean;
  claimAddressesInitialized: boolean;
  claimAddresses: ClaimAddress[];
  clearKeys: () => void;
}

interface HistoryViewProps {
  colors: ColorTokens;
  radius: RadiusTokens;
  fadeIn: Keyframes;
  payments: StealthPayment[];
}

// Sub-components
const HomeView = ({ colors, radius, fadeIn, ownedNames, nameRegistryConfigured, nameInput, setNameInput, isCheckingName, isNameAvailable, formatName, validateName, handleRegisterName, isNameLoading, setView, scan, isRegistered, isKeyLoading, registrationSuccess, handleCopy }: HomeViewProps) => (
  <VStack gap="16px" align="stretch" animation={`${fadeIn} 0.25s ease-out`}>
    <Box p="20px" bgGradient="linear(180deg, rgba(124, 127, 255, 0.06) 0%, transparent 100%)" borderRadius={radius.md} border={`1.5px solid ${colors.border.default}`}>
      <VStack gap="16px" align="stretch">
        <HStack justify="space-between">
          <HStack gap="10px">
            <TagIcon size={17} color={colors.accent.indigo} />
            <Text fontSize="15px" fontWeight={600} color={colors.text.primary}>Your Private Name</Text>
          </HStack>
          {ownedNames.length > 0 && (
            <Box px="10px" py="4px" bgColor="rgba(0, 214, 143, 0.15)" borderRadius={radius.xs} border="1px solid rgba(0, 214, 143, 0.4)">
              <Text fontSize="11px" color={colors.accent.greenBright} fontWeight={600}>Registered</Text>
            </Box>
          )}
        </HStack>
        {ownedNames.length > 0 ? (
          <VStack gap="10px" align="stretch">
            {ownedNames.map((name: OwnedName) => (
              <HStack key={name.name} p="14px 16px" bgColor={colors.bg.input} borderRadius={radius.sm} justify="space-between" border={`1px solid ${colors.border.default}`}>
                <Text fontSize="17px" fontWeight={700} color={colors.text.primary}>{name.fullName}</Text>
              </HStack>
            ))}
          </VStack>
        ) : nameRegistryConfigured ? (
          <VStack gap="14px" align="stretch">
            <Text fontSize="13px" color={colors.text.tertiary}>Register a name so others can send to you easily</Text>
            <HStack gap="12px">
              <Box position="relative" flex={1}>
                <Input placeholder="yourname" value={nameInput} onChange={(e: ChangeEvent<HTMLInputElement>) => setNameInput(e.target.value)} h="48px" bgColor={colors.bg.input}
                  border={`1.5px solid ${colors.border.default}`} borderRadius={radius.sm} color={colors.text.primary} fontSize="15px" px="16px" pr="55px"
                  _placeholder={{ color: colors.text.muted }} _focus={{ borderColor: colors.accent.indigo, boxShadow: colors.glow.indigo }} />
                <Text position="absolute" right="16px" top="50%" transform="translateY(-50%)" fontSize="15px" fontWeight={600} color={colors.accent.indigo}>{NAME_SUFFIX}</Text>
              </Box>
              <Button h="48px" px="24px" bgColor={colors.bg.elevated} borderRadius={radius.sm} border={`1.5px solid ${colors.border.light}`}
                fontWeight={600} fontSize="14px" color={colors.text.primary} _hover={{ bgColor: colors.accent.indigo, borderColor: colors.accent.indigo }}
                onClick={handleRegisterName} disabled={!isNameAvailable || isNameLoading || isCheckingName}>
                {isNameLoading ? <Spinner size="sm" /> : "Register"}
              </Button>
            </HStack>
            {isCheckingName && <HStack gap="6px"><Spinner size="xs" color={colors.accent.indigo} /><Text fontSize="12px" color={colors.text.secondary}>Checking...</Text></HStack>}
            {!isCheckingName && isNameAvailable === true && nameInput && (
              <HStack gap="6px"><CheckCircleIcon size={14} color={colors.accent.greenBright} /><Text fontSize="13px" color={colors.accent.greenBright} fontWeight={600}>{formatName(nameInput)} is available</Text></HStack>
            )}
            {!isCheckingName && isNameAvailable === false && nameInput && (
              <HStack gap="6px"><AlertCircleIcon size={14} color={colors.accent.red} /><Text fontSize="13px" color={colors.accent.red} fontWeight={600}>{formatName(nameInput)} is already taken</Text></HStack>
            )}
            {!isCheckingName && isNameAvailable === null && nameInput && validateName(nameInput).valid && (
              <HStack gap="6px"><AlertCircleIcon size={14} color={colors.accent.amber} /><Text fontSize="13px" color={colors.accent.amber} fontWeight={500}>Could not check availability</Text></HStack>
            )}
          </VStack>
        ) : <Text fontSize="13px" color={colors.text.muted}>Name registry not available</Text>}
      </VStack>
    </Box>

    <HStack gap="14px">
      <Button flex={1} h="72px" bgGradient="linear(135deg, rgba(124, 127, 255, 0.1) 0%, rgba(124, 127, 255, 0.02) 100%)"
        borderRadius={radius.md} border={`1.5px solid ${colors.accent.indigo}`}
        _hover={{ bgGradient: "linear(135deg, rgba(124, 127, 255, 0.18) 0%, rgba(124, 127, 255, 0.05) 100%)", boxShadow: colors.glow.indigo }}
        onClick={() => setView("send")}>
        <HStack gap="12px"><ArrowUpRightIcon size={24} color={colors.accent.indigoBright} /><Text fontSize="16px" fontWeight={600} color={colors.text.primary}>Send</Text></HStack>
      </Button>
      <Button flex={1} h="72px" bgGradient="linear(135deg, rgba(0, 214, 143, 0.1) 0%, rgba(0, 214, 143, 0.02) 100%)"
        borderRadius={radius.md} border={`1.5px solid ${colors.accent.green}`}
        _hover={{ bgGradient: "linear(135deg, rgba(0, 214, 143, 0.18) 0%, rgba(0, 214, 143, 0.05) 100%)", boxShadow: colors.glow.green }}
        onClick={() => { setView("inbox"); scan(); }}>
        <HStack gap="12px"><ArrowDownLeftIcon size={24} color={colors.accent.greenBright} /><Text fontSize="16px" fontWeight={600} color={colors.text.primary}>Receive</Text></HStack>
      </Button>
    </HStack>

    {registrationSuccess && (
      <Box p="14px 18px" bgColor="rgba(0, 214, 143, 0.1)" borderRadius={radius.md} border="1.5px solid rgba(0, 214, 143, 0.4)" animation={`${fadeIn} 0.3s ease-out`}>
        <HStack gap="10px">
          <CheckCircleIcon size={18} color={colors.accent.greenBright} />
          <VStack align="flex-start" gap="2px">
            <Text fontSize="13px" fontWeight={600} color={colors.accent.greenBright}>Registered successfully</Text>
            <Text fontSize="12px" color={colors.text.secondary}>Name and on-chain identity are both live</Text>
          </VStack>
        </HStack>
      </Box>
    )}

    <Box p="18px 20px" bgColor={colors.bg.input} borderRadius={radius.md} border={`1px solid ${colors.border.default}`}>
      <VStack gap="14px" align="stretch">
        <HStack gap="10px">
          <LockIcon size={16} color={colors.accent.indigo} />
          <Text fontSize="13px" fontWeight={600} color={colors.text.secondary}>How it works</Text>
        </HStack>
        <VStack gap="10px" align="stretch">
          <HStack gap="10px" align="flex-start">
            <Text fontSize="12px" color={colors.text.muted} minW="18px" textAlign="center" fontWeight={600}>1</Text>
            <Text fontSize="12px" color={colors.text.tertiary} lineHeight="1.5">Share your <Text as="span" color={colors.accent.indigoBright} fontWeight={600}>.tok</Text> name or address with the sender</Text>
          </HStack>
          <HStack gap="10px" align="flex-start">
            <Text fontSize="12px" color={colors.text.muted} minW="18px" textAlign="center" fontWeight={600}>2</Text>
            <Text fontSize="12px" color={colors.text.tertiary} lineHeight="1.5">Each payment generates a unique stealth address</Text>
          </HStack>
          <HStack gap="10px" align="flex-start">
            <Text fontSize="12px" color={colors.text.muted} minW="18px" textAlign="center" fontWeight={600}>3</Text>
            <Text fontSize="12px" color={colors.text.tertiary} lineHeight="1.5">Only you can discover and claim the funds</Text>
          </HStack>
        </VStack>
      </VStack>
    </Box>
  </VStack>
);

const SendView = ({ colors, radius, fadeIn, sendStep, recipient, setRecipient, amount, setAmount, isResolving, resolvedAddress, handleSendPreview, handleSend, setSendStep, lastGeneratedAddress, isSendLoading, sendTxHash, resetSendFlow, sendError }: SendViewProps) => {
  const { activeChainId } = useAuth();
  const chainConfig = getChainConfig(activeChainId);
  const symbol = chainConfig.nativeCurrency.symbol;
  return (
  <VStack gap="20px" align="stretch" animation={`${fadeIn} 0.25s ease-out`}>
    {sendStep === "input" && (
      <>
        <VStack gap="4px" align="flex-start">
          <Text fontSize="16px" fontWeight={600} color={colors.text.primary}>Send Private Payment</Text>
          <Text fontSize="13px" color={colors.text.muted}>Only the recipient can access these funds</Text>
        </VStack>
        <VStack gap="16px" align="stretch">
          <Box>
            <Text fontSize="12px" color={colors.text.tertiary} mb="8px" fontWeight={500}>Recipient</Text>
            <Input placeholder={`alice${NAME_SUFFIX} or st:thanos:0x...`} value={recipient} onChange={(e: ChangeEvent<HTMLInputElement>) => setRecipient(e.target.value)}
              h="48px" bgColor={colors.bg.input} border={`1px solid ${colors.border.default}`} borderRadius={radius.sm}
              color={colors.text.primary} fontSize="14px" px="14px" _placeholder={{ color: colors.text.muted }}
              _focus={{ borderColor: colors.accent.indigo, boxShadow: colors.glow.indigo }} />
            <Box h="20px" mt="6px">
              {isResolving && <HStack gap="5px"><Spinner size="xs" color={colors.text.muted} /><Text fontSize="11px" color={colors.text.muted}>Resolving...</Text></HStack>}
              {!isResolving && resolvedAddress && !recipient.startsWith("st:") && (
                <HStack gap="5px"><CheckCircleIcon size={11} color={colors.accent.green} /><Text fontSize="11px" color={colors.accent.green}>Resolved: {resolvedAddress.slice(0, 28)}...</Text></HStack>
              )}
            </Box>
          </Box>
          <Box>
            <Text fontSize="12px" color={colors.text.tertiary} mb="8px" fontWeight={500}>Amount</Text>
            <Input placeholder="0.0" type="number" step="0.001" value={amount} onChange={(e: ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
              h="56px" bgColor={colors.bg.input} border={`1px solid ${colors.border.default}`} borderRadius={radius.sm}
              color={colors.text.primary} fontSize="24px" fontWeight={500} fontFamily="'JetBrains Mono', monospace" px="14px"
              _placeholder={{ color: colors.text.muted }} _focus={{ borderColor: colors.accent.indigo, boxShadow: colors.glow.indigo }} />
            <Text fontSize="11px" color={colors.text.muted} mt="6px">{symbol} on {chainConfig.name}</Text>
          </Box>
        </VStack>
        <Button h="48px" bgColor={colors.accent.indigoDark} borderRadius={radius.sm} fontWeight={500} fontSize="14px" color="#fff"
          _hover={{ bgColor: colors.accent.indigo }} onClick={handleSendPreview}
          disabled={(!resolvedAddress && !recipient.startsWith("st:")) || !amount || isSendLoading || isResolving}>
          Preview Payment
        </Button>
      </>
    )}

    {sendStep === "confirm" && lastGeneratedAddress && (
      <>
        <VStack gap="4px" align="flex-start">
          <Text fontSize="16px" fontWeight={600} color={colors.text.primary}>Confirm Payment</Text>
          <Text fontSize="13px" color={colors.text.muted}>Review before sending</Text>
        </VStack>
        <Box p="20px" bgColor={colors.bg.input} borderRadius={radius.md} border={`1px solid ${colors.border.default}`}>
          <VStack gap="16px" align="stretch">
            <HStack justify="space-between">
              <Text fontSize="13px" color={colors.text.muted}>Amount</Text>
              <Text fontSize="18px" fontWeight={600} color={colors.text.primary} fontFamily="'JetBrains Mono', monospace">{amount} {symbol}</Text>
            </HStack>
            <Box h="1px" bgColor={colors.border.default} />
            <HStack justify="space-between">
              <Text fontSize="13px" color={colors.text.muted}>To</Text>
              <Text fontSize="13px" color={colors.text.primary} fontFamily="'JetBrains Mono', monospace">{recipient.includes(".tok") ? recipient : `${recipient.slice(0, 14)}...`}</Text>
            </HStack>
          </VStack>
        </Box>
        <Box p="14px 16px" bgColor="rgba(52, 211, 153, 0.04)" borderRadius={radius.sm} border="1px solid rgba(52, 211, 153, 0.1)">
          <HStack gap="10px"><LockIcon size={16} color={colors.accent.green} /><Text fontSize="12px" color={colors.text.tertiary}>This payment is private. Only the recipient can access these funds.</Text></HStack>
        </Box>
        <HStack gap="10px">
          <Button flex={1} h="44px" bgColor={colors.bg.elevated} borderRadius={radius.sm} border={`1px solid ${colors.border.default}`}
            fontWeight={500} fontSize="13px" color={colors.text.primary} _hover={{ bgColor: colors.bg.hover }} onClick={() => setSendStep("input")}>Back</Button>
          <Button flex={2} h="44px" bgColor={colors.accent.indigoDark} borderRadius={radius.sm} fontWeight={500} fontSize="13px" color="#fff"
            _hover={{ bgColor: colors.accent.indigo }} onClick={handleSend} disabled={isSendLoading}>
            {isSendLoading ? <Spinner size="sm" /> : "Send Payment"}
          </Button>
        </HStack>
      </>
    )}

    {sendStep === "success" && (
      <VStack gap="24px" py="28px" animation={`${fadeIn} 0.3s ease-out`}>
        <Box p="16px" bgColor="rgba(52, 211, 153, 0.08)" borderRadius="50%"><CheckCircleIcon size={32} color={colors.accent.green} /></Box>
        <VStack gap="6px">
          <Text fontSize="18px" fontWeight={600} color={colors.text.primary}>Payment Sent</Text>
          <Text fontSize="13px" color={colors.text.muted} textAlign="center">{amount} {symbol} sent privately to {recipient.includes(".tok") ? recipient : "recipient"}</Text>
        </VStack>
        {sendTxHash && (
          <VStack gap="10px" w="100%" maxW="360px">
            <Box p="10px 12px" bgColor={colors.bg.input} borderRadius={radius.xs} border={`1px solid ${colors.border.default}`} w="100%">
              <Text fontSize="11px" color={colors.text.secondary} fontFamily="'JetBrains Mono', monospace" wordBreak="break-all" lineHeight="1.5">{sendTxHash}</Text>
            </Box>
            <a href={`${getChainConfig(activeChainId).blockExplorerUrl}/tx/${sendTxHash}`} target="_blank" rel="noopener noreferrer">
              <HStack gap="6px" px="12px" py="6px" bgColor={colors.bg.elevated} borderRadius={radius.xs} border={`1px solid ${colors.border.light}`} _hover={{ bgColor: colors.bg.hover, borderColor: colors.accent.indigo }}>
                <ArrowUpRightIcon size={13} color={colors.accent.indigo} />
                <Text fontSize="12px" color={colors.accent.indigo} fontWeight={500}>View on Explorer</Text>
              </HStack>
            </a>
          </VStack>
        )}
        <Button h="44px" px="28px" bgColor={colors.accent.indigoDark} borderRadius={radius.sm} fontWeight={500} fontSize="13px" color="#fff"
          _hover={{ bgColor: colors.accent.indigo }} onClick={resetSendFlow}>Send Another</Button>
      </VStack>
    )}

    {sendError && (
      <HStack gap="6px" p="12px 14px" bgColor="rgba(248, 113, 113, 0.08)" borderRadius={radius.xs}>
        <AlertCircleIcon size={14} color={colors.accent.red} /><Text fontSize="12px" color={colors.accent.red}>{sendError}</Text>
      </HStack>
    )}
  </VStack>
  );
};

const InboxView = ({ colors, radius, fadeIn, payments, isScanning, scan, claimAddressesInitialized, claimAddresses, selectedIndex, selectAddress, handleClaim, claimingIndex, claimedTx, scanError }: InboxViewProps) => {
  const { activeChainId } = useAuth();
  const symbol = getChainConfig(activeChainId).nativeCurrency.symbol;
  const accentColor = colors.accent.green;
  const accentBright = colors.accent.greenBright;
  const accentDark = colors.accent.greenDark;
  const glowColor = colors.glow.green;

  return (
    <VStack gap="16px" align="stretch" animation={`${fadeIn} 0.25s ease-out`}>
      {/* Header with Mode Toggle */}
      <Flex justify="space-between" align="center" pb="12px" borderBottom={`1px solid ${colors.border.default}`}>
        <VStack gap="2px" align="flex-start">
          <Text fontSize="18px" fontWeight={600} color={colors.text.primary}>Inbox</Text>
          <Text fontSize="12px" color={colors.text.muted}>Receiving payments</Text>
        </VStack>
        <HStack gap="10px">
          {/* Scan Button */}
          <Button
            h="38px" px="14px"
            bgColor={colors.bg.elevated}
            borderRadius={radius.xs}
            border={`1px solid ${colors.border.light}`}
            fontWeight={500} fontSize="12px"
            color={colors.text.secondary}
            _hover={{ bgColor: colors.bg.hover, borderColor: accentColor }}
            onClick={() => scan()}
            disabled={isScanning}
          >
            {isScanning ? <Spinner size="xs" /> : <RefreshIcon size={14} />}
          </Button>
        </HStack>
      </Flex>

      {/* Claim Address Selector */}
      {claimAddressesInitialized && claimAddresses.length > 0 && (
        <HStack gap="8px" flexWrap="wrap">
          <Text fontSize="11px" color={colors.text.muted} fontWeight={500}>Claim to:</Text>
          {claimAddresses.slice(0, 3).map((addr: ClaimAddress, idx: number) => (
            <Button
              key={addr.address}
              h="28px" px="12px"
              bgColor={selectedIndex === idx ? accentColor : "transparent"}
              borderRadius={radius.xs}
              border={`1px solid ${selectedIndex === idx ? accentColor : colors.border.default}`}
              fontSize="11px" fontWeight={500}
              color={selectedIndex === idx ? colors.bg.page : colors.text.muted}
              _hover={{ borderColor: accentColor }}
              onClick={() => selectAddress(idx)}
            >
              {addr.label || `Wallet ${idx + 1}`}
            </Button>
          ))}
        </HStack>
      )}

      {/* Success State */}
      {claimedTx && (
        <Box
          p="20px"
          bgGradient="linear(135deg, rgba(0, 214, 143, 0.1) 0%, rgba(0, 214, 143, 0.02) 100%)"
          borderRadius={radius.lg}
          border="1px solid rgba(0, 214, 143, 0.3)"
        >
          <VStack gap="16px" align="stretch">
            <HStack gap="12px">
              <Box p="10px" bgColor="rgba(0, 214, 143, 0.15)" borderRadius="50%">
                <CheckCircleIcon size={20} color={accentBright} />
              </Box>
              <VStack align="flex-start" gap="2px">
                <Text fontSize="15px" fontWeight={600} color={colors.text.primary}>Payment Claimed!</Text>
                <Text fontSize="12px" color={colors.text.muted}>Funds sent to your wallet</Text>
              </VStack>
            </HStack>

            <Box p="12px 14px" bgColor="rgba(0, 0, 0, 0.25)" borderRadius={radius.sm}>
              <Text fontSize="10px" color={colors.text.muted} mb="6px" fontWeight={500}>Transaction Hash</Text>
              <Text fontSize="11px" color={accentBright} fontFamily="'JetBrains Mono', monospace" wordBreak="break-all" lineHeight="1.6">
                {claimedTx}
              </Text>
            </Box>

            <a href={`${getChainConfig(activeChainId).blockExplorerUrl}/tx/${claimedTx}`} target="_blank" rel="noopener noreferrer">
              <Button
                w="100%" h="40px"
                bgColor="rgba(0, 214, 143, 0.15)"
                borderRadius={radius.sm}
                border="1px solid rgba(0, 214, 143, 0.3)"
                fontWeight={500} fontSize="13px"
                color={accentBright}
                _hover={{ bgColor: "rgba(0, 214, 143, 0.25)" }}
              >
                <HStack gap="8px">
                  <ArrowUpRightIcon size={14} color={accentBright} />
                  <Text>View on Explorer</Text>
                </HStack>
              </Button>
            </a>
          </VStack>
        </Box>
      )}

      {/* Payments List - Only show unclaimed payments */}
      {(() => {
        const pendingList = payments.filter(p => !p.claimed);
        return pendingList.length === 0 ? (
          <Box
            p="48px 24px"
            bgColor={colors.bg.input}
            borderRadius={radius.lg}
            border={`1px solid ${colors.border.default}`}
            textAlign="center"
          >
            <VStack gap="14px">
              <Box p="16px" bgColor={colors.bg.elevated} borderRadius="50%">
                <InboxIcon size={32} color={colors.text.muted} />
              </Box>
              <VStack gap="6px">
                <Text fontSize="15px" fontWeight={500} color={colors.text.primary}>No pending payments</Text>
                <Text fontSize="13px" color={colors.text.muted} maxW="240px" lineHeight="1.5">
                  When someone sends you a private payment, it will appear here
                </Text>
              </VStack>
            </VStack>
          </Box>
        ) : (
          <VStack gap="10px" align="stretch">
            {pendingList.map((payment: StealthPayment) => {
              const index = payments.indexOf(payment);
              const balance = parseFloat(payment.balance || "0");
            // Sponsored wallet types (create2, account, eip7702) can claim any amount
            // Only apply dust check for EOA wallets where user pays their own gas
            const isTooLowForGas = balance > 0 && balance < MIN_CLAIMABLE_BALANCE && (!payment.walletType || payment.walletType === 'eoa');
            const canClaim = !payment.claimed && !payment.keyMismatch && !isTooLowForGas;

            return (
              <Box
                key={payment.announcement.txHash}
                p="18px"
                bgColor={colors.bg.input}
                borderRadius={radius.md}
                border={`1px solid ${canClaim ? "rgba(0, 214, 143, 0.3)" : colors.border.default}`}
                opacity={payment.claimed || isTooLowForGas ? 0.5 : 1}
                transition="all 0.2s ease"
                _hover={canClaim ? { borderColor: accentColor, boxShadow: glowColor } : {}}
              >
                <HStack justify="space-between" align="center">
                  <HStack gap="14px">
                    <Box
                      p="10px"
                      bgColor={payment.claimed ? "rgba(0, 214, 143, 0.1)" : canClaim ? "rgba(0, 214, 143, 0.1)" : colors.bg.elevated}
                      borderRadius={radius.sm}
                    >
                      {payment.claimed ? (
                        <CheckCircleIcon size={18} color={colors.accent.green} />
                      ) : canClaim ? (
                        <ArrowDownLeftIcon size={18} color={colors.accent.green} />
                      ) : (
                        <AlertCircleIcon size={18} color={colors.text.muted} />
                      )}
                    </Box>
                    <VStack align="flex-start" gap="2px">
                      <Text fontSize="18px" fontWeight={600} color={colors.text.primary} fontFamily="'JetBrains Mono', monospace">
                        {balance.toFixed(4)} {symbol}
                      </Text>
                      <Text fontSize="11px" color={colors.text.muted}>
                        Block #{payment.announcement.blockNumber.toLocaleString()}
                      </Text>
                    </VStack>
                  </HStack>

                  {payment.claimed ? (
                    <HStack gap="6px" px="12px" py="6px" bgColor="rgba(0, 214, 143, 0.1)" borderRadius={radius.xs}>
                      <CheckCircleIcon size={12} color={colors.accent.green} />
                      <Text fontSize="12px" fontWeight={500} color={colors.accent.green}>Claimed</Text>
                    </HStack>
                  ) : payment.keyMismatch ? (
                    <HStack gap="6px" px="12px" py="6px" bgColor="rgba(255, 107, 107, 0.1)" borderRadius={radius.xs}>
                      <AlertCircleIcon size={12} color={colors.accent.red} />
                      <Text fontSize="12px" fontWeight={500} color={colors.accent.red}>Key Mismatch</Text>
                    </HStack>
                  ) : isTooLowForGas ? (
                    <HStack gap="6px" px="12px" py="6px" bgColor="rgba(255, 190, 11, 0.1)" borderRadius={radius.xs}>
                      <Text fontSize="12px" fontWeight={500} color={colors.accent.amber}>Dust</Text>
                    </HStack>
                  ) : (
                    <Button
                      h="38px" px="20px"
                      bgColor={accentColor}
                      borderRadius={radius.sm}
                      fontWeight={500} fontSize="13px"
                      color={colors.bg.page}
                      _hover={{ bgColor: accentDark }}
                      onClick={() => handleClaim(index)}
                      disabled={claimingIndex === index}
                    >
                      {claimingIndex === index ? (
                        <HStack gap="8px">
                          <Spinner size="sm" />
                          <Text>Claiming...</Text>
                        </HStack>
                      ) : (
                        <HStack gap="6px">
                          <Text>Claim</Text>
                        </HStack>
                      )}
                    </Button>
                  )}
                </HStack>

                {payment.keyMismatch && (
                  <Text fontSize="11px" color={colors.accent.red} mt="10px" pl="52px">
                    Your current keys don&apos;t match this payment
                  </Text>
                )}
              </Box>
            );
            })}
          </VStack>
        );
      })()}

      {scanError && (
        <Box p="12px 14px" bgColor="rgba(255, 107, 107, 0.08)" borderRadius={radius.xs}>
          <HStack gap="8px">
            <AlertCircleIcon size={14} color={colors.accent.red} />
            <Text fontSize="12px" color={colors.accent.red}>{scanError}</Text>
          </HStack>
        </Box>
      )}
    </VStack>
  );
};

const HistoryView = ({ colors, radius, fadeIn, payments }: HistoryViewProps) => {
  const { activeChainId } = useAuth();
  const claimedPayments = payments.filter(p => p.claimed);
  const EXPLORER_BASE = getChainConfig(activeChainId).blockExplorerUrl;

  return (
    <VStack gap="16px" align="stretch" animation={`${fadeIn} 0.25s ease-out`}>
      <VStack gap="4px" align="flex-start">
        <Text fontSize="18px" fontWeight={600} color={colors.text.primary}>History</Text>
        <Text fontSize="13px" color={colors.text.muted}>Your claimed payments</Text>
      </VStack>

      {claimedPayments.length === 0 ? (
        <Box
          p="48px 24px"
          bgColor={colors.bg.input}
          borderRadius={radius.lg}
          border={`1px solid ${colors.border.default}`}
          textAlign="center"
        >
          <VStack gap="14px">
            <Box p="16px" bgColor={colors.bg.elevated} borderRadius="50%">
              <HistoryIcon size={32} color={colors.text.muted} />
            </Box>
            <VStack gap="6px">
              <Text fontSize="15px" fontWeight={500} color={colors.text.primary}>No history yet</Text>
              <Text fontSize="13px" color={colors.text.muted} maxW="240px" lineHeight="1.5">
                Claimed payments will appear here
              </Text>
            </VStack>
          </VStack>
        </Box>
      ) : (
        <VStack gap="10px" align="stretch">
          {claimedPayments.map((payment: StealthPayment) => (
              <Box
                key={payment.announcement.txHash}
                p="16px"
                bgColor={colors.bg.input}
                borderRadius={radius.md}
                border={`1px solid ${colors.border.default}`}
              >
                <HStack justify="space-between" align="center">
                  <HStack gap="12px">
                    <Box p="10px" bgColor="rgba(0, 214, 143, 0.1)" borderRadius={radius.sm}>
                      <CheckCircleIcon size={18} color={colors.accent.green} />
                    </Box>
                    <VStack align="flex-start" gap="2px">
                      <HStack gap="6px">
                        <Text fontSize="14px" fontWeight={600} color={colors.accent.green}>Claimed</Text>
                      </HStack>
                      <Text fontSize="11px" color={colors.text.muted}>
                        Block #{payment.announcement.blockNumber.toLocaleString()}
                      </Text>
                    </VStack>
                  </HStack>
                  <a href={`${EXPLORER_BASE}/tx/${payment.announcement.txHash}`} target="_blank" rel="noopener noreferrer">
                    <Button
                      h="32px" px="12px"
                      bgColor={colors.bg.elevated}
                      borderRadius={radius.xs}
                      border={`1px solid ${colors.border.light}`}
                      fontWeight={500} fontSize="11px"
                      color={colors.text.secondary}
                      _hover={{ borderColor: colors.accent.indigo, color: colors.accent.indigo }}
                    >
                      <HStack gap="5px">
                        <ArrowUpRightIcon size={12} />
                        <Text>Explorer</Text>
                      </HStack>
                    </Button>
                  </a>
                </HStack>
              </Box>
          ))}
        </VStack>
      )}

      {claimedPayments.length > 0 && (
        <Box p="12px 16px" bgColor={colors.bg.input} borderRadius={radius.sm} border={`1px solid ${colors.border.default}`}>
          <HStack justify="space-between" align="center">
            <Text fontSize="12px" color={colors.text.muted}>Total payments claimed</Text>
            <Text fontSize="14px" fontWeight={600} color={colors.accent.green}>
              {claimedPayments.length}
            </Text>
          </HStack>
        </Box>
      )}
    </VStack>
  );
};

const SettingsView = ({ colors, radius, fadeIn, metaAddress, handleCopy, copied, claimAddressesInitialized, claimAddresses, clearKeys }: SettingsViewProps) => {
  const { activeChainId } = useAuth();
  const symbol = getChainConfig(activeChainId).nativeCurrency.symbol;
  return (
  <VStack gap="20px" align="stretch" animation={`${fadeIn} 0.25s ease-out`}>
    <VStack gap="4px" align="flex-start">
      <Text fontSize="18px" fontWeight={600} color={colors.text.primary}>Settings</Text>
      <Text fontSize="14px" color={colors.text.muted}>Manage your private wallet</Text>
    </VStack>

    <Box p="20px" bgColor={colors.bg.input} borderRadius={radius.lg} border={`1px solid ${colors.border.default}`}>
      <VStack gap="14px" align="stretch">
        <HStack gap="10px"><KeyIcon size={16} color={colors.text.muted} /><Text fontSize="13px" color={colors.text.muted} fontWeight={500}>Private Address</Text></HStack>
        <Box p="14px 16px" bgColor={colors.bg.page} borderRadius={radius.md} border={`1px solid ${colors.border.default}`}>
          <Text fontSize="12px" color={colors.text.tertiary} fontFamily="'JetBrains Mono', monospace" wordBreak="break-all" lineHeight="1.6">{metaAddress}</Text>
        </Box>
        <Button h="40px" bgColor={colors.bg.page} borderRadius={radius.xs} border={`1px solid ${colors.border.default}`}
          fontWeight={500} fontSize="13px" color={colors.text.primary} _hover={{ bgColor: colors.bg.hover }} onClick={() => handleCopy(metaAddress || "")}>
          <HStack gap="8px">{copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}<Text>{copied ? "Copied" : "Copy Address"}</Text></HStack>
        </Button>
      </VStack>
    </Box>

    {claimAddressesInitialized && (
      <Box p="20px" bgColor={colors.bg.input} borderRadius={radius.lg} border={`1px solid ${colors.border.default}`}>
        <VStack gap="14px" align="stretch">
          <HStack gap="10px"><WalletIcon size={16} color={colors.text.muted} /><Text fontSize="13px" color={colors.text.muted} fontWeight={500}>Claim Addresses</Text></HStack>
          {claimAddresses.map((addr: ClaimAddress, idx: number) => (
            <HStack key={addr.address} p="14px 16px" bgColor={colors.bg.page} borderRadius={radius.md} justify="space-between">
              <VStack align="flex-start" gap="3px">
                <Text fontSize="14px" fontWeight={500} color={colors.text.primary}>{addr.label || `Wallet ${idx + 1}`}</Text>
                <Text fontSize="11px" color={colors.text.muted} fontFamily="'JetBrains Mono', monospace">{addr.address.slice(0, 14)}...{addr.address.slice(-10)}</Text>
              </VStack>
              <Text fontSize="14px" fontWeight={500} color={colors.accent.green} fontFamily="'JetBrains Mono', monospace">{parseFloat(addr.balance || "0").toFixed(4)} {symbol}</Text>
            </HStack>
          ))}
        </VStack>
      </Box>
    )}

    <Box p="20px" bgColor="rgba(239, 68, 68, 0.03)" borderRadius={radius.lg} border="1px solid rgba(239, 68, 68, 0.12)">
      <VStack gap="14px" align="stretch">
        <HStack gap="10px"><TrashIcon size={16} color={colors.accent.red} /><Text fontSize="13px" color={colors.accent.red} fontWeight={500}>Danger Zone</Text></HStack>
        <Button h="44px" bgColor="rgba(239, 68, 68, 0.1)" borderRadius={radius.xs} fontWeight={500} fontSize="14px" color={colors.accent.red}
          border="1px solid rgba(239, 68, 68, 0.2)" _hover={{ bgColor: "rgba(239, 68, 68, 0.15)" }} onClick={clearKeys}>Reset Private Wallet</Button>
        <Text fontSize="12px" color={colors.text.muted}>This will clear your keys. You can recover them by signing with the same wallet.</Text>
      </VStack>
    </Box>
  </VStack>
  );
};
