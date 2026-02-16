"use client";

import { useState, useCallback, useEffect } from "react";
import { Box, Text, VStack, HStack, Input, Spinner, Textarea } from "@chakra-ui/react";
import { useAuth } from "@/contexts/AuthContext";
import { useStealthScanner, useUnifiedBalance, useDustPool } from "@/hooks/stealth";
import { useSwapNotes } from "@/hooks/swap";
import { useDustSwapPool } from "@/hooks/swap";
import { colors, radius, glass, shadows, buttonVariants, transitions, typography, getExplorerBase } from "@/lib/design/tokens";
import { getChainConfig } from "@/config/chains";
import { SUPPORTED_TOKENS } from "@/lib/swap/constants";
import { ConsolidateModal } from "@/components/dashboard/ConsolidateModal";
import {
  WalletIcon, ShieldIcon, LockIcon, KeyIcon, RefreshIcon,
  EyeIcon, EyeOffIcon, CopyIcon, CheckIcon, TrashIcon,
  DownloadIcon, UploadIcon, PlusIcon, SendIcon,
  ExternalLinkIcon, AlertCircleIcon, CheckCircleIcon, XIcon,
  ActivityIcon,
} from "@/components/stealth/icons";
import type { StoredSwapNote } from "@/lib/swap/storage/swap-notes";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatNoteAmount(note: StoredSwapNote): string {
  const decimals = note.tokenSymbol === "USDC" ? 6 : 18;
  const raw = BigInt(note.amount.toString());
  const divisor = BigInt(10 ** decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(decimals, "0");
  const display = decimals === 18 ? fracStr.slice(0, 4) : fracStr.slice(0, 2);
  return `${whole}.${display}`;
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  accentColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  accentColor?: string;
}) {
  const borderColor = accentColor
    ? `${accentColor}30`
    : colors.border.default;

  return (
    <Box
      p="16px"
      bg={glass.card.bg}
      borderRadius={radius.lg}
      border={`1.5px solid ${borderColor}`}
      backdropFilter={glass.card.backdropFilter}
    >
      <HStack gap="12px">
        <Box
          w="40px"
          h="40px"
          borderRadius={radius.md}
          bg={accentColor ? `${accentColor}15` : colors.bg.elevated}
          display="flex"
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
        >
          {icon}
        </Box>
        <Box>
          <Text fontSize="11px" color={colors.text.muted} fontWeight={500} mb="2px">
            {label}
          </Text>
          <Text
            fontSize="20px"
            fontWeight={800}
            color={colors.text.primary}
            fontFamily={typography.fontFamily.mono}
            letterSpacing="-0.02em"
            lineHeight="1"
          >
            {value}
          </Text>
        </Box>
      </HStack>
    </Box>
  );
}

// ─── Modal Shell ──────────────────────────────────────────────────────────────

function ModalShell({
  isOpen,
  onClose,
  title,
  preventClose,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  preventClose?: boolean;
  children: React.ReactNode;
}) {
  if (!isOpen) return null;
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
        if (e.target === e.currentTarget && !preventClose) onClose();
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
        <HStack justify="space-between" p="20px 24px">
          <Text fontSize="16px" fontWeight={700} color={colors.text.primary}>
            {title}
          </Text>
          {!preventClose && (
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
          )}
        </HStack>
        <Box p="0 24px 24px">{children}</Box>
      </Box>
    </Box>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WalletPage() {
  const {
    stealthKeys,
    address,
    isConnected,
    claimAddresses,
    refreshClaimBalances,
    claimAddressesInitialized,
    activeChainId,
  } = useAuth();

  const chainConfig = getChainConfig(activeChainId);
  const explorerBase = getExplorerBase(activeChainId);
  const nativeSymbol = chainConfig.nativeCurrency.symbol;

  // ─── Swap Notes (equivalent to grimswap's deposit notes) ──────────────────
  const {
    notes,
    unspentNotes,
    loading: notesLoading,
    count,
    deleteNote,
    exportNotes,
    importNotes,
    clearNotes,
    refresh: refreshNotes,
  } = useSwapNotes();

  // ─── DustSwap Pool (deposit to privacy pool) ─────────────────────────────
  const {
    deposit: swapDeposit,
    state: depositState,
    error: depositError,
    reset: resetDeposit,
  } = useDustSwapPool(activeChainId);

  // ─── Stealth Scanner ──────────────────────────────────────────────────────
  const { payments, scan, isScanning } = useStealthScanner(stealthKeys, { chainId: activeChainId });

  // ─── Unified Balance ──────────────────────────────────────────────────────
  const unified = useUnifiedBalance({
    payments,
    claimAddresses,
    refreshClaimBalances,
    claimAddressesInitialized,
  });

  // ─── Privacy Pool (DustPool) ──────────────────────────────────────────────
  const dustPool = useDustPool(activeChainId);

  // ─── UI State ─────────────────────────────────────────────────────────────
  const [showSecrets, setShowSecrets] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const [showConsolidateModal, setShowConsolidateModal] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositToken, setDepositToken] = useState<"ETH" | "USDC">("ETH");

  // ─── Computed values ──────────────────────────────────────────────────────
  const ethNoteValue = unspentNotes
    .filter((n) => n.tokenSymbol === "ETH" || !n.tokenSymbol)
    .reduce((sum, n) => {
      const raw = BigInt(n.amount.toString());
      return sum + Number(raw) / 1e18;
    }, 0);

  const usdcNoteValue = unspentNotes
    .filter((n) => n.tokenSymbol === "USDC")
    .reduce((sum, n) => {
      const raw = BigInt(n.amount.toString());
      return sum + Number(raw) / 1e6;
    }, 0);

  const hasPoolBalance = parseFloat(dustPool.poolBalance) > 0;

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleRefresh = useCallback(() => {
    refreshNotes();
    scan();
    refreshClaimBalances();
    dustPool.loadPoolDeposits();
  }, [refreshNotes, scan, refreshClaimBalances, dustPool.loadPoolDeposits]);

  const handleDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0) return;
    const token = SUPPORTED_TOKENS[depositToken];
    if (!token) return;

    const decimals = token.decimals;
    const parts = depositAmount.split(".");
    const whole = BigInt(parts[0] || "0");
    const fracStr = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
    const amount = whole * BigInt(10 ** decimals) + BigInt(fracStr);

    await swapDeposit(token.address as `0x${string}`, token.symbol, amount);
    if (depositState === "success") {
      setIsDepositModalOpen(false);
      setDepositAmount("");
      setDepositToken("ETH");
      refreshNotes();
    }
  };

  const handleExport = async () => {
    try {
      const json = await exportNotes();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dust-notes-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Export failed:", error);
    }
  };

  const handleImport = async () => {
    if (!importJson.trim()) return;
    try {
      const imported = await importNotes(importJson);
      setIsImportModalOpen(false);
      setImportJson("");
      // TODO: Replace with toast notification
      console.log(`Successfully imported ${imported} notes`);
    } catch {
      console.error("Failed to import notes. Check the JSON format.");
    }
  };

  const handleClear = async () => {
    await clearNotes();
    setIsClearModalOpen(false);
  };

  const copyNoteSecret = async (note: StoredSwapNote) => {
    const secretData = JSON.stringify({
      secret: note.secret.toString(),
      nullifier: note.nullifier.toString(),
      commitment: note.commitment.toString(),
      amount: note.amount.toString(),
    });
    await navigator.clipboard.writeText(secretData);
    setCopiedId(note.id!);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // ─── Not connected state ──────────────────────────────────────────────────

  if (!isConnected) {
    return (
      <Box minH="100vh" display="flex" alignItems="center" justifyContent="center" p="16px">
        <VStack gap="16px" textAlign="center">
          <Box opacity={0.4}>
            <WalletIcon size={48} color={colors.text.muted} />
          </Box>
          <Text
            fontSize="24px"
            fontWeight={700}
            color={colors.text.primary}
            fontFamily={typography.fontFamily.heading}
          >
            Connect Your Wallet
          </Text>
          <Text fontSize="14px" color={colors.text.secondary}>
            Connect your wallet to manage deposits and stealth payments
          </Text>
        </VStack>
      </Box>
    );
  }

  // ─── Main layout ──────────────────────────────────────────────────────────

  const isDepositing = ["generating", "approving", "depositing", "confirming"].includes(depositState);

  return (
    <Box p={{ base: "16px 14px", md: "28px 24px" }} maxW="720px" mx="auto">
      <VStack gap="20px" align="stretch">
        {/* Page header */}
        <HStack justify="space-between" align="center">
          <Box>
            <Text
              fontSize="28px"
              fontWeight={700}
              color={colors.text.primary}
              fontFamily={typography.fontFamily.heading}
              letterSpacing="-0.02em"
              mb="4px"
            >
              Wallet
            </Text>
            <Text fontSize="13px" color={colors.text.secondary}>
              Manage your private deposits and stealth payments
            </Text>
          </Box>
          <Box
            as="button"
            px="14px"
            py="8px"
            bg={buttonVariants.primary.bg}
            boxShadow={buttonVariants.primary.boxShadow}
            borderRadius={radius.sm}
            cursor="pointer"
            _hover={{
              boxShadow: buttonVariants.primary.hover.boxShadow,
              transform: buttonVariants.primary.hover.transform,
            }}
            _active={{ transform: buttonVariants.primary.active.transform }}
            transition={transitions.fast}
            onClick={() => setIsDepositModalOpen(true)}
            display="flex"
            alignItems="center"
            gap="6px"
          >
            <PlusIcon size={14} color="#fff" />
            <Text fontSize="13px" fontWeight={700} color="#fff">
              New Deposit
            </Text>
          </Box>
        </HStack>

        {/* Stats grid */}
        <Box
          display="grid"
          gridTemplateColumns={{ base: "1fr 1fr", md: "repeat(4, 1fr)" }}
          gap="12px"
        >
          <StatCard
            icon={<KeyIcon size={18} color={colors.accent.green} />}
            label="Active Notes"
            value={count.unspent}
            accentColor={colors.accent.green}
          />
          <StatCard
            icon={<LockIcon size={18} color={colors.accent.indigo} />}
            label="ETH in Pool"
            value={`${ethNoteValue.toFixed(4)}`}
            accentColor={colors.accent.indigo}
          />
          <StatCard
            icon={<ShieldIcon size={18} color={colors.accent.violet} />}
            label="USDC in Pool"
            value={`${usdcNoteValue.toFixed(2)}`}
            accentColor={colors.accent.violet}
          />
          <StatCard
            icon={<SendIcon size={18} color={colors.accent.cyan} />}
            label="Unclaimed"
            value={unified.unclaimedCount}
            accentColor={colors.accent.cyan}
          />
        </Box>

        {/* Privacy Pool balance card */}
        {hasPoolBalance && (
          <Box
            p="16px"
            bg={glass.card.bg}
            borderRadius={radius.lg}
            border={`1.5px solid ${colors.border.accent}`}
            backdropFilter={glass.card.backdropFilter}
          >
            <HStack justify="space-between" align="center">
              <HStack gap="10px">
                <Box color={colors.accent.indigo} opacity={0.7}>
                  <ShieldIcon size={18} />
                </Box>
                <Box>
                  <Text fontSize="13px" fontWeight={700} color={colors.text.primary}>
                    Privacy Pool
                  </Text>
                  <Text fontSize="11px" color={colors.text.muted}>
                    {dustPool.deposits.filter((d) => !d.withdrawn).length} deposits ready to withdraw
                  </Text>
                </Box>
              </HStack>
              <HStack gap="10px">
                <Text
                  fontSize="18px"
                  fontWeight={800}
                  color={colors.text.primary}
                  fontFamily={typography.fontFamily.mono}
                >
                  {parseFloat(dustPool.poolBalance).toFixed(4)} {nativeSymbol}
                </Text>
                <Box
                  as="button"
                  px="12px"
                  py="6px"
                  bg={buttonVariants.primary.bg}
                  boxShadow={buttonVariants.primary.boxShadow}
                  borderRadius={radius.sm}
                  cursor="pointer"
                  _hover={{
                    boxShadow: buttonVariants.primary.hover.boxShadow,
                    transform: buttonVariants.primary.hover.transform,
                  }}
                  transition={transitions.fast}
                  onClick={() => setShowConsolidateModal(true)}
                >
                  <Text fontSize="12px" fontWeight={700} color="#fff">
                    Withdraw
                  </Text>
                </Box>
              </HStack>
            </HStack>
          </Box>
        )}

        {/* ─── Deposit Notes Section ───────────────────────────────────────── */}
        <Box
          p="20px"
          bg={glass.card.bg}
          borderRadius={radius.lg}
          border={glass.card.border}
          backdropFilter={glass.card.backdropFilter}
        >
          <VStack gap="16px" align="stretch">
            {/* Section header */}
            <HStack justify="space-between" align="center">
              <HStack gap="8px">
                <LockIcon size={16} color={colors.accent.indigo} />
                <Text fontSize="15px" fontWeight={700} color={colors.text.primary}>
                  Deposit Notes
                </Text>
                <Box
                  px="8px"
                  py="2px"
                  borderRadius={radius.full}
                  bg={colors.bg.elevated}
                >
                  <Text fontSize="11px" color={colors.text.muted} fontWeight={500}>
                    {count.total} total
                  </Text>
                </Box>
              </HStack>
              <HStack gap="4px">
                <Box
                  as="button"
                  p="6px"
                  borderRadius={radius.full}
                  cursor="pointer"
                  _hover={{ bg: colors.bg.hover }}
                  transition={transitions.fast}
                  onClick={() => setShowSecrets(!showSecrets)}
                >
                  {showSecrets ? (
                    <EyeIcon size={15} color={colors.accent.green} />
                  ) : (
                    <EyeOffIcon size={15} color={colors.text.muted} />
                  )}
                </Box>
                <Box
                  as="button"
                  p="6px"
                  borderRadius={radius.full}
                  cursor="pointer"
                  _hover={{ bg: colors.bg.hover }}
                  transition={transitions.fast}
                  onClick={refreshNotes}
                >
                  {notesLoading ? (
                    <Spinner size="xs" color={colors.accent.indigo} />
                  ) : (
                    <RefreshIcon size={15} color={colors.text.muted} />
                  )}
                </Box>
              </HStack>
            </HStack>

            {/* Notes list */}
            {notesLoading ? (
              <Box textAlign="center" py="40px">
                <Spinner size="md" color={colors.accent.indigo} />
              </Box>
            ) : notes.length === 0 ? (
              <Box textAlign="center" py="40px">
                <Box display="inline-block" opacity={0.3} mb="12px">
                  <KeyIcon size={36} color={colors.text.muted} />
                </Box>
                <Text fontSize="13px" color={colors.text.muted} mb="16px">
                  No deposit notes yet
                </Text>
                <Box
                  as="button"
                  display="inline-flex"
                  alignItems="center"
                  gap="6px"
                  px="16px"
                  py="8px"
                  bg={buttonVariants.secondary.bg}
                  border={buttonVariants.secondary.border}
                  borderRadius={radius.sm}
                  cursor="pointer"
                  _hover={{ bg: buttonVariants.secondary.hover.bg }}
                  transition={transitions.fast}
                  onClick={() => setIsDepositModalOpen(true)}
                >
                  <PlusIcon size={13} color={colors.text.primary} />
                  <Text fontSize="12px" fontWeight={600} color={colors.text.primary}>
                    Make Your First Deposit
                  </Text>
                </Box>
              </Box>
            ) : (
              <VStack gap="8px" align="stretch">
                {notes.map((note) => (
                  <Box
                    key={note.id}
                    p="14px"
                    borderRadius={radius.md}
                    border={`1px solid ${
                      note.spent ? colors.border.light : colors.border.accent
                    }`}
                    bg={note.spent ? "rgba(255,255,255,0.01)" : colors.bg.card}
                    opacity={note.spent ? 0.55 : 1}
                    transition={transitions.fast}
                    _hover={note.spent ? {} : { borderColor: colors.border.focus }}
                  >
                    <HStack justify="space-between" align="flex-start" gap="12px">
                      {/* Left: token + amount */}
                      <HStack gap="10px" flex={1} minW={0}>
                        <Box
                          w="36px"
                          h="36px"
                          borderRadius={radius.full}
                          bg={note.spent ? colors.bg.elevated : "rgba(74,117,240,0.1)"}
                          display="flex"
                          alignItems="center"
                          justifyContent="center"
                          flexShrink={0}
                        >
                          <Text fontSize="12px" fontWeight={700} color={note.spent ? colors.text.muted : colors.accent.indigo}>
                            {note.tokenSymbol?.slice(0, 3) || "??"}
                          </Text>
                        </Box>
                        <Box minW={0}>
                          <HStack gap="8px" align="center">
                            <Text
                              fontSize="14px"
                              fontWeight={700}
                              color={colors.text.primary}
                              fontFamily={typography.fontFamily.mono}
                            >
                              {formatNoteAmount(note)} {note.tokenSymbol}
                            </Text>
                            <Box
                              px="6px"
                              py="1px"
                              borderRadius={radius.full}
                              bg={note.spent ? "rgba(255,255,255,0.05)" : "rgba(34,197,94,0.1)"}
                            >
                              <Text
                                fontSize="10px"
                                fontWeight={600}
                                color={note.spent ? colors.text.muted : colors.accent.green}
                              >
                                {note.spent ? "Spent" : "Active"}
                              </Text>
                            </Box>
                          </HStack>
                          <HStack gap="6px" mt="4px">
                            <Text fontSize="11px" color={colors.text.muted}>
                              {formatDate(note.createdAt)}
                            </Text>
                            {note.leafIndex !== undefined && (
                              <>
                                <Text fontSize="11px" color={colors.text.muted}>
                                  &middot;
                                </Text>
                                <Text
                                  fontSize="11px"
                                  color={colors.text.muted}
                                  fontFamily={typography.fontFamily.mono}
                                >
                                  Leaf #{note.leafIndex}
                                </Text>
                              </>
                            )}
                          </HStack>
                        </Box>
                      </HStack>

                      {/* Right: actions */}
                      <HStack gap="2px" flexShrink={0}>
                        {note.depositTxHash && (
                          <Box
                            as="a"
                            href={`${explorerBase}/tx/${note.depositTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            p="6px"
                            borderRadius={radius.full}
                            cursor="pointer"
                            _hover={{ bg: colors.bg.hover }}
                            transition={transitions.fast}
                          >
                            <ExternalLinkIcon size={14} color={colors.text.muted} />
                          </Box>
                        )}
                        <Box
                          as="button"
                          p="6px"
                          borderRadius={radius.full}
                          cursor="pointer"
                          _hover={{ bg: colors.bg.hover }}
                          transition={transitions.fast}
                          onClick={() => copyNoteSecret(note)}
                        >
                          {copiedId === note.id ? (
                            <CheckIcon size={14} color={colors.accent.green} />
                          ) : (
                            <CopyIcon size={14} color={colors.text.muted} />
                          )}
                        </Box>
                        <Box
                          as="button"
                          p="6px"
                          borderRadius={radius.full}
                          cursor="pointer"
                          _hover={{ bg: "rgba(239,68,68,0.08)" }}
                          transition={transitions.fast}
                          onClick={() => deleteNote(note.id!)}
                        >
                          <TrashIcon size={14} color={colors.text.muted} />
                        </Box>
                      </HStack>
                    </HStack>

                    {/* Secrets reveal */}
                    {showSecrets && !note.spent && (
                      <Box
                        mt="12px"
                        pt="12px"
                        borderTop={`1px solid ${colors.border.light}`}
                      >
                        <Box
                          display="grid"
                          gridTemplateColumns="1fr 1fr"
                          gap="8px"
                        >
                          <Box>
                            <Text fontSize="10px" color={colors.text.muted} mb="2px">
                              Commitment
                            </Text>
                            <Text
                              fontSize="11px"
                              color={colors.text.primary}
                              fontFamily={typography.fontFamily.mono}
                              overflow="hidden"
                              textOverflow="ellipsis"
                              whiteSpace="nowrap"
                            >
                              {note.commitment.toString().slice(0, 20)}...
                            </Text>
                          </Box>
                          <Box>
                            <Text fontSize="10px" color={colors.text.muted} mb="2px">
                              Nullifier Hash
                            </Text>
                            <Text
                              fontSize="11px"
                              color={colors.text.primary}
                              fontFamily={typography.fontFamily.mono}
                              overflow="hidden"
                              textOverflow="ellipsis"
                              whiteSpace="nowrap"
                            >
                              {note.nullifierHash.toString().slice(0, 20)}...
                            </Text>
                          </Box>
                        </Box>
                      </Box>
                    )}
                  </Box>
                ))}
              </VStack>
            )}

            {/* Actions bar */}
            {notes.length > 0 && (
              <HStack
                justify="space-between"
                pt="12px"
                borderTop={`1px solid ${colors.border.light}`}
              >
                <HStack gap="4px">
                  <Box
                    as="button"
                    display="flex"
                    alignItems="center"
                    gap="5px"
                    px="10px"
                    py="6px"
                    borderRadius={radius.sm}
                    cursor="pointer"
                    _hover={{ bg: colors.bg.hover }}
                    transition={transitions.fast}
                    onClick={handleExport}
                  >
                    <DownloadIcon size={13} color={colors.text.secondary} />
                    <Text fontSize="12px" fontWeight={600} color={colors.text.secondary}>
                      Export
                    </Text>
                  </Box>
                  <Box
                    as="button"
                    display="flex"
                    alignItems="center"
                    gap="5px"
                    px="10px"
                    py="6px"
                    borderRadius={radius.sm}
                    cursor="pointer"
                    _hover={{ bg: colors.bg.hover }}
                    transition={transitions.fast}
                    onClick={() => setIsImportModalOpen(true)}
                  >
                    <UploadIcon size={13} color={colors.text.secondary} />
                    <Text fontSize="12px" fontWeight={600} color={colors.text.secondary}>
                      Import
                    </Text>
                  </Box>
                </HStack>
                <Box
                  as="button"
                  display="flex"
                  alignItems="center"
                  gap="5px"
                  px="10px"
                  py="6px"
                  borderRadius={radius.sm}
                  cursor="pointer"
                  _hover={{ bg: "rgba(239,68,68,0.08)" }}
                  transition={transitions.fast}
                  onClick={() => setIsClearModalOpen(true)}
                >
                  <TrashIcon size={13} color={colors.accent.red} />
                  <Text fontSize="12px" fontWeight={600} color={colors.accent.red}>
                    Clear All
                  </Text>
                </Box>
              </HStack>
            )}
          </VStack>
        </Box>

        {/* ─── Stealth Payments Section ────────────────────────────────────── */}
        <Box
          p="20px"
          bg={glass.card.bg}
          borderRadius={radius.lg}
          border={glass.card.border}
          backdropFilter={glass.card.backdropFilter}
        >
          <VStack gap="16px" align="stretch">
            {/* Section header */}
            <HStack justify="space-between" align="center">
              <HStack gap="8px">
                <ShieldIcon size={16} color={colors.accent.green} />
                <Text fontSize="15px" fontWeight={700} color={colors.text.primary}>
                  Stealth Payments
                </Text>
                <Box
                  px="8px"
                  py="2px"
                  borderRadius={radius.full}
                  bg={colors.bg.elevated}
                >
                  <Text fontSize="11px" color={colors.text.muted} fontWeight={500}>
                    {unified.unclaimedCount} unclaimed
                  </Text>
                </Box>
              </HStack>
              <Box
                as="button"
                p="6px"
                borderRadius={radius.full}
                cursor="pointer"
                _hover={{ bg: colors.bg.hover }}
                transition={transitions.fast}
                onClick={scan}
              >
                {isScanning ? (
                  <Spinner size="xs" color={colors.accent.green} />
                ) : (
                  <RefreshIcon size={15} color={colors.text.muted} />
                )}
              </Box>
            </HStack>

            {/* Payment list */}
            {payments.length === 0 ? (
              <Box textAlign="center" py="40px">
                <Box display="inline-block" opacity={0.3} mb="12px">
                  <ShieldIcon size={36} color={colors.text.muted} />
                </Box>
                <Text fontSize="13px" color={colors.text.muted} mb="4px">
                  No stealth payments yet
                </Text>
                <Text fontSize="11px" color={colors.text.muted}>
                  Payments received via stealth addresses will appear here
                </Text>
              </Box>
            ) : (
              <VStack gap="8px" align="stretch">
                {unified.unclaimedPayments.map((payment) => {
                  const bal = parseFloat(payment.balance || "0");
                  const addr = payment.announcement.stealthAddress;
                  const txHash = payment.announcement.txHash;

                  return (
                    <Box
                      key={addr}
                      p="14px"
                      borderRadius={radius.md}
                      border={`1px solid ${
                        bal > 0
                          ? colors.border.accentGreen
                          : colors.border.default
                      }`}
                      bg={bal > 0 ? "rgba(34,197,94,0.03)" : colors.bg.card}
                      transition={transitions.fast}
                    >
                      <HStack justify="space-between" align="center" gap="12px">
                        <HStack gap="10px" flex={1} minW={0}>
                          <Box
                            w="36px"
                            h="36px"
                            borderRadius={radius.full}
                            bg={bal > 0 ? "rgba(34,197,94,0.12)" : colors.bg.elevated}
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                            flexShrink={0}
                          >
                            <ShieldIcon
                              size={16}
                              color={bal > 0 ? colors.accent.green : colors.text.muted}
                            />
                          </Box>
                          <Box minW={0}>
                            <HStack gap="8px" align="center">
                              <Text
                                fontSize="13px"
                                color={colors.text.primary}
                                fontFamily={typography.fontFamily.mono}
                              >
                                {addr.slice(0, 8)}...
                                {addr.slice(-6)}
                              </Text>
                              {bal > 0 && (
                                <Box
                                  px="6px"
                                  py="1px"
                                  borderRadius={radius.full}
                                  bg="rgba(34,197,94,0.1)"
                                >
                                  <Text fontSize="10px" fontWeight={600} color={colors.accent.green}>
                                    Claimable
                                  </Text>
                                </Box>
                              )}
                            </HStack>
                            <Text
                              fontSize="14px"
                              fontWeight={700}
                              color={colors.text.primary}
                              fontFamily={typography.fontFamily.mono}
                              mt="2px"
                            >
                              {bal.toFixed(4)} {nativeSymbol}
                            </Text>
                          </Box>
                        </HStack>
                        {txHash && (
                          <Box
                            as="a"
                            href={`${explorerBase}/tx/${txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            p="6px"
                            borderRadius={radius.full}
                            cursor="pointer"
                            _hover={{ bg: colors.bg.hover }}
                            transition={transitions.fast}
                            flexShrink={0}
                          >
                            <ExternalLinkIcon size={14} color={colors.text.muted} />
                          </Box>
                        )}
                      </HStack>
                    </Box>
                  );
                })}
              </VStack>
            )}

            {/* Info notice */}
            {payments.length > 0 && (
              <Box
                p="10px 12px"
                borderRadius={radius.sm}
                bg="rgba(34,197,94,0.04)"
                border={`1px solid rgba(34,197,94,0.12)`}
              >
                <HStack gap="8px" align="flex-start">
                  <Box mt="1px" flexShrink={0}>
                    <KeyIcon size={13} color={colors.accent.green} />
                  </Box>
                  <Text fontSize="11px" color={colors.text.muted} lineHeight="1.5">
                    Stealth addresses hold tokens from private payments. Private keys are stored
                    securely in your browser. Claim via the Dashboard to send funds to your wallet.
                  </Text>
                </HStack>
              </Box>
            )}
          </VStack>
        </Box>

        {/* ─── Transaction History ─────────────────────────────────────────── */}
        <Box
          p="20px"
          bg={glass.card.bg}
          borderRadius={radius.lg}
          border={glass.card.border}
          backdropFilter={glass.card.backdropFilter}
        >
          <VStack gap="16px" align="stretch">
            <HStack gap="8px">
              <ActivityIcon size={16} color={colors.accent.indigo} />
              <Text fontSize="15px" fontWeight={700} color={colors.text.primary}>
                Transaction History
              </Text>
            </HStack>

            {notes.length === 0 ? (
              <Box textAlign="center" py="32px">
                <Box display="inline-block" opacity={0.3} mb="8px">
                  <ActivityIcon size={28} color={colors.text.muted} />
                </Box>
                <Text fontSize="13px" color={colors.text.muted}>
                  No transactions yet
                </Text>
              </Box>
            ) : (
              <VStack gap="6px" align="stretch">
                {notes
                  .slice()
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .slice(0, 10)
                  .map((note) => (
                    <HStack
                      key={note.id}
                      justify="space-between"
                      p="10px 12px"
                      borderRadius={radius.sm}
                      bg={colors.bg.card}
                      _hover={{ bg: colors.bg.hover }}
                      transition={transitions.fast}
                    >
                      <HStack gap="10px">
                        <Box
                          w="28px"
                          h="28px"
                          borderRadius={radius.full}
                          bg={note.spent ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)"}
                          display="flex"
                          alignItems="center"
                          justifyContent="center"
                        >
                          {note.spent ? (
                            <XIcon size={12} color={colors.accent.red} />
                          ) : (
                            <CheckCircleIcon size={12} color={colors.accent.green} />
                          )}
                        </Box>
                        <Box>
                          <Text fontSize="13px" fontWeight={600} color={colors.text.primary}>
                            {note.spent ? "Withdrawn" : "Deposited"}{" "}
                            {formatNoteAmount(note)} {note.tokenSymbol}
                          </Text>
                          <Text fontSize="11px" color={colors.text.muted}>
                            {formatDate(note.spent ? note.spentAt! : note.createdAt)}
                          </Text>
                        </Box>
                      </HStack>
                      {note.depositTxHash && (
                        <Box
                          as="a"
                          href={`${explorerBase}/tx/${note.depositTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          fontSize="11px"
                          color={colors.accent.indigo}
                          _hover={{ textDecoration: "underline" }}
                          display="flex"
                          alignItems="center"
                          gap="3px"
                          flexShrink={0}
                        >
                          View
                          <ExternalLinkIcon size={10} color={colors.accent.indigo} />
                        </Box>
                      )}
                    </HStack>
                  ))}
              </VStack>
            )}
          </VStack>
        </Box>

        {/* ─── Backup Warning ──────────────────────────────────────────────── */}
        <Box
          p="14px 16px"
          borderRadius={radius.md}
          bg="rgba(239,68,68,0.04)"
          border={`1px solid rgba(239,68,68,0.15)`}
        >
          <HStack gap="10px" align="flex-start">
            <Box mt="1px" flexShrink={0}>
              <AlertCircleIcon size={16} color={colors.accent.red} />
            </Box>
            <Box>
              <Text fontSize="13px" fontWeight={700} color={colors.accent.red} mb="4px">
                Backup Your Notes
              </Text>
              <Text fontSize="12px" color={colors.text.secondary} lineHeight="1.5">
                Your deposit notes are stored locally in your browser. If you clear your
                browser data or use a different device, you will lose access to your
                deposits. Always export and securely backup your notes.
              </Text>
            </Box>
          </HStack>
        </Box>
      </VStack>

      {/* ─── Deposit Modal ───────────────────────────────────────────────── */}
      <ModalShell
        isOpen={isDepositModalOpen}
        onClose={() => {
          setIsDepositModalOpen(false);
          resetDeposit();
          setDepositAmount("");
          setDepositToken("ETH");
        }}
        title="Deposit to Privacy Pool"
        preventClose={isDepositing}
      >
        <VStack gap="16px" align="stretch">
          {/* Token selection */}
          <VStack gap="6px" align="stretch">
            <Text {...typography.label.sm} color={colors.text.muted}>
              Select Token
            </Text>
            <HStack gap="8px">
              {(["ETH", "USDC"] as const).map((sym) => (
                <Box
                  key={sym}
                  as="button"
                  flex={1}
                  p="12px"
                  borderRadius={radius.md}
                  bg={depositToken === sym ? "rgba(74,117,240,0.1)" : colors.bg.elevated}
                  border={`1px solid ${
                    depositToken === sym ? colors.border.accent : colors.border.default
                  }`}
                  cursor="pointer"
                  transition={transitions.fast}
                  onClick={() => {
                    setDepositToken(sym);
                    setDepositAmount("");
                  }}
                  _hover={{
                    bg:
                      depositToken === sym
                        ? "rgba(74,117,240,0.12)"
                        : colors.bg.hover,
                  }}
                >
                  <Text
                    fontSize="14px"
                    fontWeight={700}
                    color={depositToken === sym ? colors.accent.indigo : colors.text.primary}
                  >
                    {sym}
                  </Text>
                  <Text fontSize="11px" color={colors.text.muted} mt="2px">
                    {SUPPORTED_TOKENS[sym]?.name}
                  </Text>
                </Box>
              ))}
            </HStack>
          </VStack>

          {/* Amount input */}
          <VStack gap="6px" align="stretch">
            <Text {...typography.label.sm} color={colors.text.muted}>
              Amount
            </Text>
            <Box position="relative">
              <Input
                type="text"
                inputMode="decimal"
                placeholder="0.0"
                value={depositAmount}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9.]/g, "");
                  setDepositAmount(val);
                }}
                h="48px"
                bg={glass.input.bg}
                border={`1px solid ${colors.border.default}`}
                borderRadius={radius.md}
                color={colors.text.primary}
                fontSize="16px"
                fontFamily={typography.fontFamily.mono}
                fontWeight={500}
                px="16px"
                pr="52px"
                _placeholder={{ color: colors.text.muted }}
                _focus={{
                  borderColor: colors.border.focus,
                  boxShadow: shadows.inputFocus,
                }}
              />
            </Box>
          </VStack>

          {/* Info */}
          <Box
            p="12px"
            borderRadius={radius.sm}
            bg="rgba(74,117,240,0.06)"
            border={`1px solid rgba(74,117,240,0.15)`}
          >
            <HStack gap="8px" align="flex-start">
              <Box mt="2px" flexShrink={0}>
                <ShieldIcon size={14} color={colors.accent.indigo} />
              </Box>
              <Text fontSize="12px" color={colors.text.tertiary} lineHeight="1.5">
                Your deposit creates a cryptographic commitment stored on-chain. A secret
                note is saved locally that proves your ownership. Keep this note safe!
              </Text>
            </HStack>
          </Box>

          {/* Error */}
          {depositError && (
            <Box
              p="10px 12px"
              borderRadius={radius.sm}
              bg="rgba(239,68,68,0.06)"
              border={`1px solid rgba(239,68,68,0.2)`}
            >
              <Text fontSize="12px" color={colors.accent.red}>
                {depositError}
              </Text>
            </Box>
          )}

          {/* Submit */}
          <Box
            as="button"
            w="100%"
            py="14px"
            borderRadius={radius.full}
            bg={
              depositAmount && parseFloat(depositAmount) > 0 && !isDepositing
                ? buttonVariants.primary.bg
                : colors.bg.elevated
            }
            boxShadow={
              depositAmount && parseFloat(depositAmount) > 0 && !isDepositing
                ? buttonVariants.primary.boxShadow
                : "none"
            }
            cursor={
              depositAmount && parseFloat(depositAmount) > 0 && !isDepositing
                ? "pointer"
                : "not-allowed"
            }
            opacity={depositAmount && parseFloat(depositAmount) > 0 ? 1 : 0.5}
            transition={transitions.base}
            onClick={handleDeposit}
            _hover={
              depositAmount && parseFloat(depositAmount) > 0 && !isDepositing
                ? {
                    boxShadow: buttonVariants.primary.hover.boxShadow,
                    transform: buttonVariants.primary.hover.transform,
                  }
                : {}
            }
          >
            <Text fontSize="15px" fontWeight={700} color="#fff" textAlign="center">
              {isDepositing ? (
                <HStack gap="8px" justifyContent="center">
                  <Spinner size="xs" color="#fff" />
                  <Text as="span">
                    {depositState === "generating" && "Generating Note..."}
                    {depositState === "approving" && "Approving..."}
                    {depositState === "depositing" && "Depositing..."}
                    {depositState === "confirming" && "Confirming..."}
                  </Text>
                </HStack>
              ) : depositState === "success" ? (
                <HStack gap="6px" justifyContent="center">
                  <CheckCircleIcon size={15} color="#fff" />
                  <Text as="span">Deposit Successful!</Text>
                </HStack>
              ) : (
                <HStack gap="6px" justifyContent="center">
                  <LockIcon size={14} color="#fff" />
                  <Text as="span">Deposit to Privacy Pool</Text>
                </HStack>
              )}
            </Text>
          </Box>
        </VStack>
      </ModalShell>

      {/* ─── Import Modal ────────────────────────────────────────────────── */}
      <ModalShell
        isOpen={isImportModalOpen}
        onClose={() => {
          setIsImportModalOpen(false);
          setImportJson("");
        }}
        title="Import Deposit Notes"
      >
        <VStack gap="16px" align="stretch">
          <Text fontSize="13px" color={colors.text.secondary}>
            Paste the JSON backup of your deposit notes below.
          </Text>
          <Textarea
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
            placeholder='[{"secret": "...", "nullifier": "...", ...}]'
            h="160px"
            bg={glass.input.bg}
            border={`1px solid ${colors.border.default}`}
            borderRadius={radius.md}
            color={colors.text.primary}
            fontSize="12px"
            fontFamily={typography.fontFamily.mono}
            p="12px"
            resize="none"
            _placeholder={{ color: colors.text.muted }}
            _focus={{
              borderColor: colors.border.focus,
              boxShadow: shadows.inputFocus,
            }}
          />
          <HStack gap="10px">
            <Box
              as="button"
              flex={1}
              py="12px"
              borderRadius={radius.full}
              bg={buttonVariants.secondary.bg}
              border={buttonVariants.secondary.border}
              cursor="pointer"
              transition={transitions.fast}
              onClick={() => setIsImportModalOpen(false)}
              _hover={{ bg: buttonVariants.secondary.hover.bg }}
            >
              <Text fontSize="14px" fontWeight={600} color={colors.text.primary} textAlign="center">
                Cancel
              </Text>
            </Box>
            <Box
              as="button"
              flex={1}
              py="12px"
              borderRadius={radius.full}
              bg={importJson.trim() ? buttonVariants.primary.bg : colors.bg.elevated}
              boxShadow={importJson.trim() ? buttonVariants.primary.boxShadow : "none"}
              cursor={importJson.trim() ? "pointer" : "not-allowed"}
              opacity={importJson.trim() ? 1 : 0.5}
              transition={transitions.fast}
              onClick={handleImport}
              _hover={
                importJson.trim()
                  ? {
                      boxShadow: buttonVariants.primary.hover.boxShadow,
                      transform: buttonVariants.primary.hover.transform,
                    }
                  : {}
              }
            >
              <HStack gap="6px" justifyContent="center">
                <UploadIcon size={14} color="#fff" />
                <Text fontSize="14px" fontWeight={700} color="#fff">
                  Import
                </Text>
              </HStack>
            </Box>
          </HStack>
        </VStack>
      </ModalShell>

      {/* ─── Clear Confirmation Modal ────────────────────────────────────── */}
      <ModalShell
        isOpen={isClearModalOpen}
        onClose={() => setIsClearModalOpen(false)}
        title="Clear All Notes?"
      >
        <VStack gap="16px" align="stretch">
          <Box
            p="14px"
            borderRadius={radius.sm}
            bg="rgba(239,68,68,0.06)"
            border={`1px solid rgba(239,68,68,0.2)`}
          >
            <HStack gap="10px" align="flex-start">
              <Box mt="1px" flexShrink={0}>
                <AlertCircleIcon size={16} color={colors.accent.red} />
              </Box>
              <Box>
                <Text fontSize="13px" fontWeight={700} color={colors.accent.red} mb="4px">
                  This action is irreversible
                </Text>
                <Text fontSize="12px" color={colors.text.secondary} lineHeight="1.5">
                  Clearing all notes will permanently delete your deposit records. You will lose
                  access to any unspent deposits. Make sure you have exported a backup first.
                </Text>
              </Box>
            </HStack>
          </Box>
          <HStack gap="10px">
            <Box
              as="button"
              flex={1}
              py="12px"
              borderRadius={radius.full}
              bg={buttonVariants.secondary.bg}
              border={buttonVariants.secondary.border}
              cursor="pointer"
              transition={transitions.fast}
              onClick={() => setIsClearModalOpen(false)}
              _hover={{ bg: buttonVariants.secondary.hover.bg }}
            >
              <Text fontSize="14px" fontWeight={600} color={colors.text.primary} textAlign="center">
                Cancel
              </Text>
            </Box>
            <Box
              as="button"
              flex={1}
              py="12px"
              borderRadius={radius.full}
              bg={buttonVariants.danger.bg}
              border={buttonVariants.danger.border}
              cursor="pointer"
              transition={transitions.fast}
              onClick={handleClear}
              _hover={{ bg: buttonVariants.danger.hover.bg }}
            >
              <HStack gap="6px" justifyContent="center">
                <TrashIcon size={14} color={colors.accent.red} />
                <Text fontSize="14px" fontWeight={700} color={colors.accent.red}>
                  Clear All
                </Text>
              </HStack>
            </Box>
          </HStack>
        </VStack>
      </ModalShell>

      {/* ─── Consolidate (Withdraw) Modal ────────────────────────────────── */}
      <ConsolidateModal
        isOpen={showConsolidateModal}
        onClose={() => setShowConsolidateModal(false)}
        deposits={dustPool.deposits}
        poolBalance={dustPool.poolBalance}
        progress={dustPool.progress}
        onConsolidate={dustPool.consolidate}
        onReset={dustPool.resetProgress}
        isConsolidating={dustPool.isConsolidating}
      />
    </Box>
  );
}
