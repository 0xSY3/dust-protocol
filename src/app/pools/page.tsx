"use client";

import { useState, useCallback, useEffect } from "react";
import { Box, Text, VStack, HStack, Spinner } from "@chakra-ui/react";
import { type Address } from "viem";
import { useAccount, useSwitchChain, useChainId } from "wagmi";
import { useAuth } from "@/contexts/AuthContext";
import {
  colors,
  radius,
  shadows,
  glass,
  buttonVariants,
  transitions,
  typography,
  getExplorerBase,
} from "@/lib/design/tokens";
import {
  SUPPORTED_TOKENS,
  getSwapContracts,
  isSwapSupported,
  getPoolForToken,
  type SwapToken,
} from "@/lib/swap/constants";
import { useDustSwapPool } from "@/hooks/swap";
import { useSwapNotes } from "@/hooks/swap";
import {
  ShieldIcon,
  ShieldCheckIcon,
  AlertCircleIcon,
  ExternalLinkIcon,
  PlusIcon,
  XIcon,
  RefreshIcon,
} from "@/components/stealth/icons";

// ─── Inline SVG Icons ────────────────────────────────────────────────────────

const CoinsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="6" />
    <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
    <path d="M7 6h1v4" />
    <path d="m16.71 13.88.7.71-2.82 2.82" />
  </svg>
);

const DropletsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z" />
    <path d="M12.56 14.69c1.46 0 2.64-1.22 2.64-2.7 0-.78-.38-1.51-1.13-2.13C13.32 9.23 12.77 8.6 12.56 7.94c-.19.67-.75 1.3-1.51 1.92-.75.62-1.13 1.35-1.13 2.13 0 1.48 1.18 2.7 2.64 2.7z" />
  </svg>
);

const BarChartIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" />
  </svg>
);

const LockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

// ─── Pool Info Type ──────────────────────────────────────────────────────────

interface PoolInfo {
  id: string;
  token: SwapToken;
  poolAddress: string | null;
  isPrivacy: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatNumber(num: number, decimals: number = 2): string {
  if (num >= 1e9) return `${(num / 1e9).toFixed(decimals)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(decimals)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(decimals)}K`;
  if (num < 0.01 && num > 0) return num.toFixed(6);
  return num.toFixed(decimals);
}

function shortenAddress(addr: string): string {
  return `${addr.slice(0, 10)}...${addr.slice(-8)}`;
}

// ─── Pool Stats Modal ────────────────────────────────────────────────────────

function PoolStatsModal({
  isOpen,
  onClose,
  pool,
  depositCount,
  notesCount,
  notesBalance,
}: {
  isOpen: boolean;
  onClose: () => void;
  pool: PoolInfo | null;
  depositCount: number;
  notesCount: number;
  notesBalance: number;
}) {
  if (!isOpen || !pool) return null;

  const explorerBase = getExplorerBase();

  return (
    <Box
      position="fixed"
      inset={0}
      bg={colors.bg.overlay}
      display="flex"
      alignItems="center"
      justifyContent="center"
      zIndex={200}
      onClick={(e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Box
        w="100%"
        maxW="480px"
        mx="16px"
        bg={glass.modal.bg}
        border={glass.modal.border}
        borderRadius={radius.xl}
        boxShadow={shadows.modal}
        backdropFilter={glass.modal.backdropFilter}
        overflow="hidden"
      >
        {/* Header */}
        <HStack justify="space-between" p="20px 24px" borderBottom={`1px solid ${colors.border.light}`}>
          <HStack gap="12px">
            <Box
              w="36px"
              h="36px"
              borderRadius={radius.md}
              bg={`linear-gradient(135deg, ${colors.accent.indigo}, ${colors.accent.violet})`}
              display="flex"
              alignItems="center"
              justifyContent="center"
            >
              <ShieldIcon size={18} color="#fff" />
            </Box>
            <VStack align="flex-start" gap="0">
              <Text fontSize="16px" fontWeight={700} color={colors.text.primary}>
                {pool.token.symbol} Privacy Pool
              </Text>
              <Text fontSize="11px" color={colors.text.muted}>
                Poseidon commitment-based pool
              </Text>
            </VStack>
          </HStack>
          <Box
            as="button"
            onClick={onClose}
            cursor="pointer"
            p="8px"
            borderRadius={radius.full}
            transition={transitions.fast}
            _hover={{ bg: colors.bg.hover }}
          >
            <XIcon size={15} color={colors.text.muted} />
          </Box>
        </HStack>

        {/* Content */}
        <Box p="24px">
          <VStack gap="16px" align="stretch">
            {/* Pool Type Badge */}
            <Box
              p="12px"
              borderRadius={radius.sm}
              bg={`linear-gradient(135deg, rgba(74,117,240,0.08) 0%, rgba(99,60,255,0.08) 100%)`}
              border="1px solid rgba(74,117,240,0.15)"
            >
              <HStack gap="8px" mb="4px">
                <LockIcon />
                <Text fontSize="11px" color={colors.accent.indigo} fontWeight={600}>
                  Privacy Pool
                </Text>
              </HStack>
              <Text fontSize="12px" color={colors.text.tertiary} lineHeight="1.5">
                Deposits are hidden using Poseidon hash commitments. Withdrawals require ZK-SNARK proofs, ensuring complete sender-receiver unlinkability.
              </Text>
            </Box>

            {/* Stats Grid */}
            <Box display="grid" gridTemplateColumns="1fr 1fr" gap="10px">
              <Box p="12px" borderRadius={radius.sm} bg="rgba(255,255,255,0.02)" border={`1px solid ${colors.border.light}`}>
                <HStack gap="6px" mb="4px">
                  <Box color={colors.accent.cyan}><BarChartIcon /></Box>
                  <Text fontSize="11px" color={colors.text.muted} fontWeight={500}>Total Deposits</Text>
                </HStack>
                <Text fontSize="13px" fontFamily={typography.fontFamily.mono} color={colors.text.primary} fontWeight={500}>
                  {depositCount}
                </Text>
                <Text fontSize="10px" color={colors.text.muted} mt="2px">On-chain commitments</Text>
              </Box>

              <Box p="12px" borderRadius={radius.sm} bg="rgba(255,255,255,0.02)" border={`1px solid ${colors.border.light}`}>
                <HStack gap="6px" mb="4px">
                  <Box color={colors.accent.green}><CoinsIcon /></Box>
                  <Text fontSize="11px" color={colors.text.muted} fontWeight={500}>Your Notes</Text>
                </HStack>
                <Text fontSize="13px" fontFamily={typography.fontFamily.mono} color={colors.text.primary} fontWeight={500}>
                  {notesCount}
                </Text>
                <Text fontSize="10px" color={colors.text.muted} mt="2px">Unspent deposit notes</Text>
              </Box>
            </Box>

            {/* Your Balance */}
            {notesCount > 0 && (
              <Box
                p="12px"
                borderRadius={radius.sm}
                bg={`linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)`}
                border={`1px solid ${colors.border.default}`}
              >
                <HStack justify="space-between">
                  <VStack gap="0" align="flex-start">
                    <Text fontSize="11px" color={colors.text.muted}>Your Balance</Text>
                    <Text fontSize="16px" fontFamily={typography.fontFamily.mono} color={colors.accent.indigo} fontWeight={600}>
                      {formatNumber(notesBalance, pool.token.decimals > 6 ? 4 : 2)} {pool.token.symbol}
                    </Text>
                  </VStack>
                  <VStack gap="0" align="flex-end">
                    <Text fontSize="11px" color={colors.text.muted}>Status</Text>
                    <HStack gap="4px">
                      <Box w="6px" h="6px" borderRadius="50%" bg={colors.accent.green} />
                      <Text fontSize="12px" color={colors.accent.green} fontWeight={600}>
                        Ready
                      </Text>
                    </HStack>
                  </VStack>
                </HStack>
              </Box>
            )}

            {/* Contract Address */}
            {pool.poolAddress && (
              <Box p="12px" borderRadius={radius.sm} bg="rgba(34,197,94,0.04)" border="1px solid rgba(34,197,94,0.12)">
                <Text fontSize="11px" color={colors.text.muted} mb="4px">Pool Contract</Text>
                <a
                  href={`${explorerBase}/address/${pool.poolAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", textDecoration: "none" }}
                >
                  <Text fontSize="12px" fontFamily={typography.fontFamily.mono} color={colors.accent.indigo}>
                    {shortenAddress(pool.poolAddress)}
                  </Text>
                  <ExternalLinkIcon size={12} color={colors.accent.indigo} />
                </a>
              </Box>
            )}
          </VStack>
        </Box>
      </Box>
    </Box>
  );
}

// ─── Pool Row Component ──────────────────────────────────────────────────────

function PoolRow({
  pool,
  depositCount,
  isLoading,
  notesCount,
  notesBalance,
  onDeposit,
  onViewStats,
}: {
  pool: PoolInfo;
  depositCount: number;
  isLoading: boolean;
  notesCount: number;
  notesBalance: number;
  onDeposit: (pool: PoolInfo) => void;
  onViewStats: (pool: PoolInfo) => void;
}) {
  const isActive = pool.poolAddress !== null;

  return (
    <Box
      as="button"
      w="100%"
      textAlign="left"
      cursor="pointer"
      onClick={() => onViewStats(pool)}
    >
      <Box
        p="3px"
        borderRadius={radius.md}
        bg={`linear-gradient(135deg, ${colors.accent.indigoDark}33 0%, ${colors.accent.indigo}22 100%)`}
        transition={transitions.smooth}
        _hover={{
          bg: `linear-gradient(135deg, ${colors.accent.indigoDark}55 0%, ${colors.accent.indigo}44 100%)`,
        }}
      >
        <Box bg={colors.bg.cardSolid} borderRadius="13px" p="16px">
          {/* Mobile + Desktop grid */}
          <Box
            display="grid"
            gridTemplateColumns={{ base: "1fr auto", sm: "2fr 1fr 1fr 1fr auto" }}
            gap="12px"
            alignItems="center"
          >
            {/* Pool Name */}
            <HStack gap="12px">
              <Box
                w="36px"
                h="36px"
                borderRadius="50%"
                bg={colors.bg.elevated}
                display="flex"
                alignItems="center"
                justifyContent="center"
                flexShrink={0}
              >
                <Text fontSize="13px" fontWeight={700} color={colors.text.primary}>
                  {pool.token.symbol === "ETH" ? "E" : "$"}
                </Text>
              </Box>
              <VStack gap="0" align="flex-start">
                <HStack gap="6px">
                  <Text fontSize="14px" fontWeight={600} color={colors.text.primary}>
                    {pool.token.symbol}
                  </Text>
                  <HStack gap="4px" px="6px" py="2px" borderRadius={radius.xs} bg="rgba(74,117,240,0.1)">
                    <ShieldIcon size={10} color={colors.accent.indigo} />
                    <Text fontSize="10px" color={colors.accent.indigo} fontWeight={600}>
                      Privacy
                    </Text>
                  </HStack>
                </HStack>
                <Text fontSize="11px" color={colors.text.muted}>
                  {pool.token.name} Privacy Pool
                </Text>
              </VStack>
            </HStack>

            {/* Deposits (hidden on mobile) */}
            <Box display={{ base: "none", sm: "block" }}>
              {isLoading ? (
                <Spinner size="xs" color={colors.accent.indigo} />
              ) : (
                <VStack gap="0" align="flex-start">
                  <Text fontSize="13px" fontFamily={typography.fontFamily.mono} color={colors.text.primary}>
                    {depositCount}
                  </Text>
                  <Text fontSize="10px" color={colors.text.muted}>Deposits</Text>
                </VStack>
              )}
            </Box>

            {/* Your Notes (hidden on mobile) */}
            <Box display={{ base: "none", sm: "block" }}>
              <VStack gap="0" align="flex-start">
                <Text fontSize="13px" fontFamily={typography.fontFamily.mono} color={notesCount > 0 ? colors.accent.green : colors.text.primary}>
                  {notesCount}
                </Text>
                <Text fontSize="10px" color={colors.text.muted}>Your Notes</Text>
              </VStack>
            </Box>

            {/* Status (hidden on mobile) */}
            <Box display={{ base: "none", sm: "block" }}>
              {isActive ? (
                <HStack gap="4px" px="8px" py="4px" borderRadius={radius.xs} bg="rgba(34,197,94,0.1)" w="fit-content">
                  <Box w="6px" h="6px" borderRadius="50%" bg={colors.accent.green} />
                  <Text fontSize="11px" color={colors.accent.green} fontWeight={600}>Active</Text>
                </HStack>
              ) : (
                <HStack gap="4px" px="8px" py="4px" borderRadius={radius.xs} bg="rgba(239,68,68,0.1)" w="fit-content">
                  <Box w="6px" h="6px" borderRadius="50%" bg={colors.accent.red} />
                  <Text fontSize="11px" color={colors.accent.red} fontWeight={600}>Unavailable</Text>
                </HStack>
              )}
            </Box>

            {/* Action */}
            <Box
              as="button"
              px="14px"
              py="8px"
              borderRadius={radius.sm}
              bg={buttonVariants.secondary.bg}
              border={buttonVariants.secondary.border}
              cursor={isActive ? "pointer" : "not-allowed"}
              opacity={isActive ? 1 : 0.5}
              transition={transitions.fast}
              _hover={isActive ? { bg: buttonVariants.secondary.hover.bg } : {}}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                if (isActive) onDeposit(pool);
              }}
              display="flex"
              alignItems="center"
              gap="6px"
            >
              <DropletsIcon />
              <Text fontSize="12px" fontWeight={600} color={colors.text.primary}>
                Deposit
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

// ─── Deposit Modal ───────────────────────────────────────────────────────────

function PoolDepositModal({
  isOpen,
  onClose,
  pool,
  onDeposit,
  depositState,
  depositError,
  onReset,
  depositNote,
}: {
  isOpen: boolean;
  onClose: () => void;
  pool: PoolInfo | null;
  onDeposit: (amount: string) => void;
  depositState: string;
  depositError: string | null;
  onReset: () => void;
  depositNote: any;
}) {
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (isOpen) {
      setAmount("");
      onReset();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen || !pool) return null;

  const isProcessing = ["generating", "approving", "depositing", "confirming"].includes(depositState);
  const isSuccess = depositState === "success";
  const isError = depositState === "error";

  const denominations =
    pool.token.symbol === "ETH"
      ? ["0.01", "0.1", "0.5", "1"]
      : ["10", "100", "500", "1000"];

  const handleClose = () => {
    if (!isProcessing) {
      setAmount("");
      onReset();
      onClose();
    }
  };

  const stepLabel = (() => {
    switch (depositState) {
      case "generating": return "Generating commitment...";
      case "approving": return "Approving token...";
      case "depositing": return "Depositing to pool...";
      case "confirming": return "Confirming on-chain...";
      default: return "";
    }
  })();

  return (
    <Box
      position="fixed"
      inset={0}
      bg={colors.bg.overlay}
      display="flex"
      alignItems="center"
      justifyContent="center"
      zIndex={200}
      onClick={(e: React.MouseEvent) => {
        if (e.target === e.currentTarget && !isProcessing) handleClose();
      }}
    >
      <Box
        w="100%"
        maxW="440px"
        mx="16px"
        bg={glass.modal.bg}
        border={glass.modal.border}
        borderRadius={radius.xl}
        boxShadow={shadows.modal}
        backdropFilter={glass.modal.backdropFilter}
        overflow="hidden"
      >
        {/* Header */}
        <HStack justify="space-between" p="20px 24px">
          <HStack gap="12px">
            <Box
              w="36px"
              h="36px"
              borderRadius={radius.md}
              bg={`linear-gradient(135deg, ${colors.accent.indigo}, ${colors.accent.violet})`}
              display="flex"
              alignItems="center"
              justifyContent="center"
            >
              <ShieldIcon size={18} color="#fff" />
            </Box>
            <VStack align="flex-start" gap="0">
              <Text fontSize="16px" fontWeight={700} color={colors.text.primary}>
                Deposit {pool.token.symbol}
              </Text>
              <Text fontSize="11px" color={colors.text.muted}>
                Add to the {pool.token.symbol} privacy pool
              </Text>
            </VStack>
          </HStack>
          {!isProcessing && (
            <Box
              as="button"
              onClick={handleClose}
              cursor="pointer"
              p="8px"
              borderRadius={radius.full}
              transition={transitions.fast}
              _hover={{ bg: colors.bg.hover }}
            >
              <XIcon size={15} color={colors.text.muted} />
            </Box>
          )}
        </HStack>

        {/* Content */}
        <Box p="24px" pt="0">
          {/* Input state */}
          {!isProcessing && !isSuccess && !isError && (
            <VStack gap="20px" align="stretch">
              {/* Info */}
              <Box p="12px" borderRadius={radius.sm} bg="rgba(74,117,240,0.06)" border="1px solid rgba(74,117,240,0.15)">
                <HStack gap="8px" align="flex-start">
                  <Box mt="2px" flexShrink={0}><ShieldIcon size={14} color={colors.accent.indigo} /></Box>
                  <Text fontSize="12px" color={colors.text.tertiary} lineHeight="1.5">
                    Deposits are hidden using Poseidon commitments. Your deposit note is stored locally for swap execution.
                  </Text>
                </HStack>
              </Box>

              {/* Quick select */}
              <VStack gap="8px" align="stretch">
                <Text fontSize="11px" color={colors.text.muted} fontWeight={600} textTransform="uppercase" letterSpacing="0.04em">
                  Quick Select
                </Text>
                <HStack gap="8px">
                  {denominations.map((denom) => (
                    <Box
                      key={denom}
                      as="button"
                      flex="1"
                      py="10px"
                      borderRadius={radius.sm}
                      bg={amount === denom ? "rgba(74,117,240,0.12)" : colors.bg.elevated}
                      border={`1px solid ${amount === denom ? "rgba(74,117,240,0.3)" : colors.border.default}`}
                      cursor="pointer"
                      transition={transitions.fast}
                      onClick={() => setAmount(denom)}
                      textAlign="center"
                      _hover={{ bg: amount === denom ? "rgba(74,117,240,0.15)" : colors.bg.hover }}
                    >
                      <Text
                        fontSize="13px"
                        fontFamily={typography.fontFamily.mono}
                        fontWeight={600}
                        color={amount === denom ? colors.accent.indigo : colors.text.primary}
                      >
                        {denom}
                      </Text>
                    </Box>
                  ))}
                </HStack>
              </VStack>

              {/* Custom amount */}
              <VStack gap="8px" align="stretch">
                <Text fontSize="11px" color={colors.text.muted} fontWeight={600} textTransform="uppercase" letterSpacing="0.04em">
                  Or Enter Custom Amount
                </Text>
                <Box
                  as="input"
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setAmount(e.target.value.replace(/[^0-9.]/g, ""));
                  }}
                  placeholder={`0.0 ${pool.token.symbol}`}
                  h="48px"
                  w="100%"
                  bg={glass.input.bg}
                  border={`1px solid ${colors.border.default}`}
                  borderRadius={radius.md}
                  color={colors.text.primary}
                  fontSize="16px"
                  fontFamily={typography.fontFamily.mono}
                  fontWeight={500}
                  px="16px"
                  outline="none"
                  _placeholder={{ color: colors.text.muted }}
                  _focus={{ borderColor: colors.border.focus, boxShadow: shadows.inputFocus }}
                />
              </VStack>

              {/* Deposit button */}
              <Box
                as="button"
                w="100%"
                py="14px"
                borderRadius={radius.full}
                bg={amount && parseFloat(amount) > 0 ? buttonVariants.primary.bg : colors.bg.elevated}
                boxShadow={amount && parseFloat(amount) > 0 ? buttonVariants.primary.boxShadow : "none"}
                cursor={amount && parseFloat(amount) > 0 ? "pointer" : "not-allowed"}
                opacity={amount && parseFloat(amount) > 0 ? 1 : 0.5}
                transition={transitions.base}
                onClick={() => {
                  console.log('[PoolDepositModal] Deposit button clicked, amount:', amount);
                  if (amount && parseFloat(amount) > 0) {
                    console.log('[PoolDepositModal] Amount valid, calling onDeposit');
                    onDeposit(amount);
                  } else {
                    console.log('[PoolDepositModal] Amount invalid or empty');
                  }
                }}
                _hover={
                  amount && parseFloat(amount) > 0
                    ? { boxShadow: buttonVariants.primary.hover.boxShadow, transform: buttonVariants.primary.hover.transform }
                    : {}
                }
              >
                <Text fontSize="15px" fontWeight={700} color="#fff" textAlign="center">
                  {amount && parseFloat(amount) > 0 ? `Deposit ${amount} ${pool.token.symbol}` : "Enter Amount"}
                </Text>
              </Box>
            </VStack>
          )}

          {/* Processing */}
          {isProcessing && (
            <VStack gap="16px" align="center" py="24px">
              <Spinner size="md" color={colors.accent.indigo} />
              <Text fontSize="14px" fontWeight={600} color={colors.text.primary}>
                {stepLabel}
              </Text>
              <Text fontSize="12px" color={colors.text.muted} textAlign="center">
                Please confirm the transaction in your wallet
              </Text>
            </VStack>
          )}

          {/* Success */}
          {isSuccess && (
            <VStack gap="16px" align="stretch">
              <Box textAlign="center" py="8px">
                <Box display="inline-flex" mb="12px">
                  <ShieldCheckIcon size={40} color={colors.accent.green} />
                </Box>
                <Text fontSize="16px" fontWeight={700} color={colors.text.primary} mb="4px">
                  Deposit Successful
                </Text>
                <Text fontSize="13px" color={colors.text.secondary}>
                  {amount} {pool.token.symbol} deposited to privacy pool
                </Text>
              </Box>

              {/* Note Details */}
              {depositNote && (
                <Box p="12px" borderRadius={radius.sm} bg="rgba(74,117,240,0.06)" border="1px solid rgba(74,117,240,0.15)">
                  <Text fontSize="12px" color={colors.accent.indigo} fontWeight={600} mb="8px">
                    Deposit Note Details
                  </Text>
                  <VStack gap="6px" align="stretch">
                    <HStack justify="space-between">
                      <Text fontSize="11px" color={colors.text.muted}>Leaf Index</Text>
                      <Text fontSize="11px" fontFamily={typography.fontFamily.mono} color={colors.text.primary}>
                        #{depositNote.leafIndex ?? 'N/A'}
                      </Text>
                    </HStack>
                    <HStack justify="space-between">
                      <Text fontSize="11px" color={colors.text.muted}>Commitment</Text>
                      <Text fontSize="11px" fontFamily={typography.fontFamily.mono} color={colors.text.primary}>
                        {depositNote.commitment ? (() => {
                          const hex = `0x${depositNote.commitment.toString(16).padStart(64, '0')}`;
                          return `${hex.slice(0, 10)}...${hex.slice(-8)}`;
                        })() : 'N/A'}
                      </Text>
                    </HStack>
                    <HStack justify="space-between">
                      <Text fontSize="11px" color={colors.text.muted}>Secret</Text>
                      <Text fontSize="11px" fontFamily={typography.fontFamily.mono} color={colors.text.primary}>
                        {depositNote.secret ? (() => {
                          const hex = `0x${depositNote.secret.toString(16).padStart(64, '0')}`;
                          return `${hex.slice(0, 10)}...${hex.slice(-8)}`;
                        })() : 'N/A'}
                      </Text>
                    </HStack>
                  </VStack>
                </Box>
              )}

              <Box p="12px" borderRadius={radius.sm} bg="rgba(245,158,11,0.06)" border="1px solid rgba(245,158,11,0.15)">
                <Text fontSize="12px" color={colors.accent.amber} fontWeight={600} mb="4px">
                  Save Your Deposit Note
                </Text>
                <Text fontSize="11px" color={colors.text.tertiary} lineHeight="1.5">
                  Your deposit note has been saved to this browser. If you clear browser data, you will lose access to this deposit.
                </Text>
              </Box>

              <Box
                as="button"
                w="100%"
                py="14px"
                borderRadius={radius.full}
                bg={buttonVariants.primary.bg}
                boxShadow={buttonVariants.primary.boxShadow}
                cursor="pointer"
                transition={transitions.base}
                onClick={handleClose}
                _hover={{ boxShadow: buttonVariants.primary.hover.boxShadow, transform: buttonVariants.primary.hover.transform }}
              >
                <Text fontSize="15px" fontWeight={700} color="#fff" textAlign="center">
                  Done
                </Text>
              </Box>
            </VStack>
          )}

          {/* Error */}
          {isError && (
            <VStack gap="16px" align="stretch">
              <Box textAlign="center" py="8px">
                <Box display="inline-flex" mb="12px">
                  <AlertCircleIcon size={40} color={colors.accent.red} />
                </Box>
                <Text fontSize="16px" fontWeight={700} color={colors.text.primary} mb="4px">
                  Deposit Failed
                </Text>
                <Text fontSize="13px" color={colors.text.secondary}>
                  {depositError}
                </Text>
              </Box>

              <HStack gap="12px">
                <Box
                  as="button"
                  flex="1"
                  py="14px"
                  borderRadius={radius.full}
                  bg={buttonVariants.secondary.bg}
                  border={buttonVariants.secondary.border}
                  cursor="pointer"
                  transition={transitions.base}
                  onClick={handleClose}
                  _hover={{ bg: buttonVariants.secondary.hover.bg }}
                >
                  <Text fontSize="14px" fontWeight={600} color={colors.text.primary} textAlign="center">
                    Cancel
                  </Text>
                </Box>
                <Box
                  as="button"
                  flex="1"
                  py="14px"
                  borderRadius={radius.full}
                  bg={buttonVariants.primary.bg}
                  boxShadow={buttonVariants.primary.boxShadow}
                  cursor="pointer"
                  transition={transitions.base}
                  onClick={onReset}
                  _hover={{ boxShadow: buttonVariants.primary.hover.boxShadow, transform: buttonVariants.primary.hover.transform }}
                >
                  <Text fontSize="14px" fontWeight={700} color="#fff" textAlign="center">
                    Try Again
                  </Text>
                </Box>
              </HStack>
            </VStack>
          )}
        </Box>
      </Box>
    </Box>
  );
}

// ─── Main Pools Page ─────────────────────────────────────────────────────────

export default function PoolsPage() {
  const { isConnected, activeChainId } = useAuth();
  const walletChainId = useChainId(); // Actual wallet chain
  const swapSupported = isSwapSupported(activeChainId);
  const contracts = getSwapContracts(activeChainId);
  const explorerBase = getExplorerBase(activeChainId);
  const { switchChain } = useSwitchChain();

  // Check if wallet is on correct chain
  const isWalletOnCorrectChain = walletChainId === 11155111;

  // Pool definitions
  const pools: PoolInfo[] = [
    {
      id: "eth-privacy",
      token: SUPPORTED_TOKENS.ETH,
      poolAddress: contracts.dustSwapPoolETH,
      isPrivacy: true,
    },
    {
      id: "usdc-privacy",
      token: SUPPORTED_TOKENS.USDC,
      poolAddress: contracts.dustSwapPoolUSDC,
      isPrivacy: true,
    },
  ];

  // Hooks
  const { deposit, state: depositState, error: depositError, reset: resetDeposit, getDepositCount, currentNote } = useDustSwapPool(activeChainId);
  const { unspentNotes, loading: notesLoading } = useSwapNotes();

  // State
  const [selectedPool, setSelectedPool] = useState<PoolInfo | null>(null);
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [statsPool, setStatsPool] = useState<PoolInfo | null>(null);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [ethDepositCount, setEthDepositCount] = useState(0);
  const [usdcDepositCount, setUsdcDepositCount] = useState(0);
  const [countsLoading, setCountsLoading] = useState(true);

  // Fetch deposit counts
  const fetchCounts = useCallback(async () => {
    setCountsLoading(true);
    const [ethCount, usdcCount] = await Promise.all([
      getDepositCount(SUPPORTED_TOKENS.ETH.address as Address),
      getDepositCount(SUPPORTED_TOKENS.USDC.address as Address),
    ]);
    setEthDepositCount(ethCount);
    setUsdcDepositCount(usdcCount);
    setCountsLoading(false);
  }, [getDepositCount]);

  useEffect(() => {
    if (isConnected && swapSupported) {
      fetchCounts();
    }
  }, [isConnected, swapSupported, fetchCounts]);

  // Derive notes per token
  const ethNotes = unspentNotes.filter(
    (n) => n.tokenAddress.toLowerCase() === SUPPORTED_TOKENS.ETH.address.toLowerCase()
  );
  const usdcNotes = unspentNotes.filter(
    (n) => n.tokenAddress.toLowerCase() === SUPPORTED_TOKENS.USDC.address.toLowerCase()
  );
  const ethNotesBalance = ethNotes.reduce((acc, n) => acc + Number(n.amount) / 1e18, 0);
  const usdcNotesBalance = usdcNotes.reduce((acc, n) => acc + Number(n.amount) / 1e6, 0);

  const getPoolDepositCount = (pool: PoolInfo) =>
    pool.token.symbol === "ETH" ? ethDepositCount : usdcDepositCount;
  const getPoolNotes = (pool: PoolInfo) =>
    pool.token.symbol === "ETH" ? ethNotes : usdcNotes;
  const getPoolNotesBalance = (pool: PoolInfo) =>
    pool.token.symbol === "ETH" ? ethNotesBalance : usdcNotesBalance;

  // Summary stats
  const totalDeposits = ethDepositCount + usdcDepositCount;
  const activePools = pools.filter((p) => p.poolAddress !== null).length;
  const totalNotes = ethNotes.length + usdcNotes.length;

  // Auto-switch to Ethereum Sepolia if on wrong chain
  useEffect(() => {
    if (isConnected && !swapSupported && switchChain) {
      const timer = setTimeout(() => {
        switchChain({ chainId: 11155111 });
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isConnected, swapSupported, switchChain]);

  // Handlers
  const handleDeposit = (pool: PoolInfo) => {
    setSelectedPool(pool);
    setIsDepositOpen(true);
  };

  const handleViewStats = (pool: PoolInfo) => {
    setStatsPool(pool);
    setIsStatsOpen(true);
  };

  const handleExecuteDeposit = useCallback(
    async (amount: string) => {
      console.log('[PoolsPage] handleExecuteDeposit called with amount:', amount);
      console.log('[PoolsPage] selectedPool:', selectedPool);
      console.log('[PoolsPage] deposit function:', deposit);
      console.log('[PoolsPage] isConnected:', isConnected);
      console.log('[PoolsPage] walletChainId:', walletChainId);
      console.log('[PoolsPage] isWalletOnCorrectChain:', isWalletOnCorrectChain);

      if (!selectedPool) {
        console.log('[PoolsPage] No selected pool, returning');
        return;
      }

      if (!isConnected) {
        console.error('[PoolsPage] Wallet not connected!');
        return;
      }

      // Force switch to Ethereum Sepolia if on wrong chain
      if (!isWalletOnCorrectChain && switchChain) {
        console.log('[PoolsPage] Wallet on wrong chain, switching to Ethereum Sepolia...');
        try {
          await switchChain({ chainId: 11155111 });
          // Wait a bit for the switch to complete
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (err) {
          console.error('[PoolsPage] Failed to switch chain:', err);
          return;
        }
      }

      const decimals = selectedPool.token.decimals;
      const amountBigInt = BigInt(
        Math.floor(parseFloat(amount) * Math.pow(10, decimals))
      );

      console.log('[PoolsPage] Calling deposit with:', {
        tokenAddress: selectedPool.token.address,
        tokenSymbol: selectedPool.token.symbol,
        amount: amountBigInt.toString(),
      });

      const result = await deposit(
        selectedPool.token.address as Address,
        selectedPool.token.symbol,
        amountBigInt
      );

      console.log('[PoolsPage] Deposit result:', result);
      console.log('[PoolsPage] Deposit error:', depositError);
      console.log('[PoolsPage] Deposit state:', depositState);

      if (result) {
        fetchCounts();
      } else {
        console.error('[PoolsPage] Deposit failed - check depositError state');
      }
    },
    [selectedPool, deposit, fetchCounts, walletChainId, isWalletOnCorrectChain, switchChain]
  );

  return (
    <Box minH="100vh" p={{ base: "16px", md: "32px" }} position="relative">
      <Box maxW="900px" mx="auto">
        <VStack gap="24px" align="stretch">
          {/* Header */}
          <HStack justify="space-between" align={{ base: "flex-start", sm: "center" }} flexDir={{ base: "column", sm: "row" }} gap="12px">
            <Box>
              <Text
                fontSize="28px"
                fontWeight={700}
                color={colors.text.primary}
                fontFamily={typography.fontFamily.heading}
                letterSpacing="-0.02em"
                mb="4px"
              >
                Privacy Pools
              </Text>
              <Text fontSize="14px" color={colors.text.secondary}>
                Deposit to privacy pools and manage your deposit notes
              </Text>
            </Box>
            {swapSupported && (
              <Box
                as="button"
                px="16px"
                py="10px"
                borderRadius={radius.full}
                bg={buttonVariants.primary.bg}
                boxShadow={buttonVariants.primary.boxShadow}
                cursor="pointer"
                transition={transitions.base}
                onClick={() => handleDeposit(pools[0])}
                _hover={{ boxShadow: buttonVariants.primary.hover.boxShadow, transform: buttonVariants.primary.hover.transform }}
                _active={{ transform: buttonVariants.primary.active.transform }}
                display="flex"
                alignItems="center"
                gap="6px"
                flexShrink={0}
              >
                <PlusIcon size={16} color="#fff" />
                <Text fontSize="14px" fontWeight={700} color="#fff">
                  New Deposit
                </Text>
              </Box>
            )}
          </HStack>

          {/* Info Banner */}
          <Box
            p="16px"
            borderRadius={radius.md}
            bg="rgba(74,117,240,0.06)"
            border="1px solid rgba(74,117,240,0.15)"
          >
            <HStack gap="12px" align="flex-start">
              <Box mt="2px" flexShrink={0}>
                <ShieldIcon size={18} color={colors.accent.indigo} />
              </Box>
              <Box>
                <Text fontSize="14px" fontWeight={600} color={colors.text.primary} mb="4px">
                  DustSwap Privacy Pools
                </Text>
                <Text fontSize="13px" color={colors.text.tertiary} lineHeight="1.6">
                  Privacy pools use Poseidon hash commitments and ZK-SNARK proofs to enable
                  private token swaps. Deposits are anonymized in the pool, and withdrawals
                  produce unlinkable outputs to stealth addresses.
                </Text>
              </Box>
            </HStack>
          </Box>

          {/* Stats Cards */}
          <Box display="grid" gridTemplateColumns={{ base: "1fr", sm: "1fr 1fr 1fr" }} gap="12px">
            {/* Total Deposits */}
            <Box
              p="3px"
              borderRadius={radius.md}
              bg={`linear-gradient(135deg, ${colors.accent.indigoDark} 0%, ${colors.accent.indigo} 50%, ${colors.accent.indigoDark} 100%)`}
            >
              <Box bg={colors.bg.cardSolid} borderRadius="13px" p="16px" textAlign="center">
                <Text fontSize="12px" color={colors.text.muted} mb="4px">Total Deposits</Text>
                <Text fontSize="22px" fontFamily={typography.fontFamily.mono} color={colors.text.primary} fontWeight={700}>
                  {countsLoading ? <Spinner size="sm" color={colors.accent.indigo} /> : totalDeposits}
                </Text>
              </Box>
            </Box>

            {/* Active Pools */}
            <Box
              p="3px"
              borderRadius={radius.md}
              bg={`linear-gradient(135deg, rgba(34,197,94,0.3) 0%, rgba(34,197,94,0.5) 50%, rgba(34,197,94,0.3) 100%)`}
            >
              <Box bg={colors.bg.cardSolid} borderRadius="13px" p="16px" textAlign="center">
                <Text fontSize="12px" color={colors.text.muted} mb="4px">Active Pools</Text>
                <Text fontSize="22px" fontFamily={typography.fontFamily.mono} color={colors.text.primary} fontWeight={700}>
                  {activePools}
                </Text>
              </Box>
            </Box>

            {/* Your Notes */}
            <Box
              p="3px"
              borderRadius={radius.md}
              bg={`linear-gradient(135deg, rgba(99,60,255,0.3) 0%, rgba(99,60,255,0.5) 50%, rgba(99,60,255,0.3) 100%)`}
            >
              <Box bg={colors.bg.cardSolid} borderRadius="13px" p="16px" textAlign="center">
                <Text fontSize="12px" color={colors.text.muted} mb="4px">Your Notes</Text>
                <Text fontSize="22px" fontFamily={typography.fontFamily.mono} color={colors.text.primary} fontWeight={700}>
                  {notesLoading ? <Spinner size="sm" color={colors.accent.violet} /> : totalNotes}
                </Text>
              </Box>
            </Box>
          </Box>

          {/* Pool List */}
          <VStack gap="12px" align="stretch">
            <Text
              fontSize="18px"
              fontWeight={700}
              color={colors.text.primary}
              fontFamily={typography.fontFamily.heading}
              letterSpacing="-0.01em"
            >
              Available Pools
            </Text>

            {/* Table Header (desktop) */}
            <Box
              display={{ base: "none", sm: "grid" }}
              gridTemplateColumns="2fr 1fr 1fr 1fr auto"
              gap="12px"
              px="16px"
              py="8px"
            >
              <Text fontSize="11px" color={colors.text.muted} fontWeight={600} textTransform="uppercase" letterSpacing="0.04em">Pool</Text>
              <Text fontSize="11px" color={colors.text.muted} fontWeight={600} textTransform="uppercase" letterSpacing="0.04em">Deposits</Text>
              <Text fontSize="11px" color={colors.text.muted} fontWeight={600} textTransform="uppercase" letterSpacing="0.04em">Your Notes</Text>
              <Text fontSize="11px" color={colors.text.muted} fontWeight={600} textTransform="uppercase" letterSpacing="0.04em">Status</Text>
              <Box w="90px" />
            </Box>

            {/* Pool Rows */}
            {pools.map((pool) => (
              <PoolRow
                key={pool.id}
                pool={pool}
                depositCount={getPoolDepositCount(pool)}
                isLoading={countsLoading}
                notesCount={getPoolNotes(pool).length}
                notesBalance={getPoolNotesBalance(pool)}
                onDeposit={handleDeposit}
                onViewStats={handleViewStats}
              />
            ))}

            {/* Swap Not Supported */}
            {!swapSupported && isConnected && (
              <Box p="16px" borderRadius={radius.md} bg="rgba(245,158,11,0.08)" border="1px solid rgba(245,158,11,0.2)">
                <VStack gap="12px" align="stretch">
                  <HStack gap="10px" align="flex-start">
                    <Box mt="2px">
                      <AlertCircleIcon size={16} color={colors.accent.amber} />
                    </Box>
                    <VStack gap="6px" align="flex-start" flex="1">
                      <Text fontSize="13px" fontWeight={600} color={colors.accent.amber}>
                        Privacy Pools Only Available on Ethereum Sepolia
                      </Text>
                      <Text fontSize="12px" color={colors.text.tertiary} lineHeight="1.5">
                        DustSwap is currently deployed on Ethereum Sepolia testnet. More chains coming soon!
                      </Text>
                    </VStack>
                  </HStack>
                  <Box
                    as="button"
                    w="100%"
                    py="10px"
                    borderRadius={radius.sm}
                    bg="rgba(245,158,11,0.12)"
                    border="1px solid rgba(245,158,11,0.3)"
                    cursor="pointer"
                    transition={transitions.fast}
                    onClick={() => switchChain?.({ chainId: 11155111 })}
                    _hover={{
                      bg: "rgba(245,158,11,0.18)",
                      borderColor: "rgba(245,158,11,0.4)",
                    }}
                  >
                    <Text fontSize="13px" fontWeight={600} color={colors.accent.amber}>
                      Switch to Ethereum Sepolia
                    </Text>
                  </Box>
                </VStack>
              </Box>
            )}
          </VStack>

          {/* Contract Addresses */}
          {swapSupported && (
            <Box
              p="16px"
              borderRadius={radius.md}
              bg="rgba(255,255,255,0.02)"
              border={`1px solid ${colors.border.light}`}
            >
              <Text fontSize="14px" fontWeight={600} color={colors.text.primary} mb="12px">
                Contract Addresses
              </Text>
              <Box display="grid" gridTemplateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="12px">
                {contracts.dustSwapPoolETH && (
                  <Box>
                    <Text fontSize="11px" color={colors.text.muted} mb="4px">ETH Privacy Pool</Text>
                    <Box
                      as="a"
                      href={`${explorerBase}/address/${contracts.dustSwapPoolETH}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      display="flex"
                      alignItems="center"
                      gap="4px"
                      _hover={{ textDecoration: "underline" }}
                    >
                      <Text fontSize="12px" fontFamily={typography.fontFamily.mono} color={colors.accent.indigo}>
                        {shortenAddress(contracts.dustSwapPoolETH)}
                      </Text>
                      <ExternalLinkIcon size={11} color={colors.accent.indigo} />
                    </Box>
                  </Box>
                )}
                {contracts.dustSwapPoolUSDC && (
                  <Box>
                    <Text fontSize="11px" color={colors.text.muted} mb="4px">USDC Privacy Pool</Text>
                    <Box
                      as="a"
                      href={`${explorerBase}/address/${contracts.dustSwapPoolUSDC}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      display="flex"
                      alignItems="center"
                      gap="4px"
                      _hover={{ textDecoration: "underline" }}
                    >
                      <Text fontSize="12px" fontFamily={typography.fontFamily.mono} color={colors.accent.indigo}>
                        {shortenAddress(contracts.dustSwapPoolUSDC)}
                      </Text>
                      <ExternalLinkIcon size={11} color={colors.accent.indigo} />
                    </Box>
                  </Box>
                )}
                {contracts.dustSwapHook && (
                  <Box>
                    <Text fontSize="11px" color={colors.text.muted} mb="4px">DustSwap Hook</Text>
                    <Box
                      as="a"
                      href={`${explorerBase}/address/${contracts.dustSwapHook}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      display="flex"
                      alignItems="center"
                      gap="4px"
                      _hover={{ textDecoration: "underline" }}
                    >
                      <Text fontSize="12px" fontFamily={typography.fontFamily.mono} color={colors.accent.indigo}>
                        {shortenAddress(contracts.dustSwapHook)}
                      </Text>
                      <ExternalLinkIcon size={11} color={colors.accent.indigo} />
                    </Box>
                  </Box>
                )}
                {contracts.dustSwapVerifier && (
                  <Box>
                    <Text fontSize="11px" color={colors.text.muted} mb="4px">ZK Verifier</Text>
                    <Box
                      as="a"
                      href={`${explorerBase}/address/${contracts.dustSwapVerifier}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      display="flex"
                      alignItems="center"
                      gap="4px"
                      _hover={{ textDecoration: "underline" }}
                    >
                      <Text fontSize="12px" fontFamily={typography.fontFamily.mono} color={colors.accent.indigo}>
                        {shortenAddress(contracts.dustSwapVerifier)}
                      </Text>
                      <ExternalLinkIcon size={11} color={colors.accent.indigo} />
                    </Box>
                  </Box>
                )}
              </Box>
            </Box>
          )}
        </VStack>
      </Box>

      {/* Deposit Modal */}
      <PoolDepositModal
        isOpen={isDepositOpen}
        onClose={() => setIsDepositOpen(false)}
        pool={selectedPool}
        onDeposit={handleExecuteDeposit}
        depositState={depositState}
        depositError={depositError}
        onReset={resetDeposit}
        depositNote={currentNote}
      />

      {/* Stats Modal */}
      <PoolStatsModal
        isOpen={isStatsOpen}
        onClose={() => setIsStatsOpen(false)}
        pool={statsPool}
        depositCount={statsPool ? getPoolDepositCount(statsPool) : 0}
        notesCount={statsPool ? getPoolNotes(statsPool).length : 0}
        notesBalance={statsPool ? getPoolNotesBalance(statsPool) : 0}
      />
    </Box>
  );
}
