"use client";

import { useState } from "react";
import { Box, Text, VStack, HStack, Spinner } from "@chakra-ui/react";
import { colors, radius, getExplorerBase } from "@/lib/design/tokens";
import { getChainConfig } from "@/config/chains";
import { useAuth } from "@/contexts/AuthContext";
import type { StealthPayment, ClaimAddress, OutgoingPayment } from "@/lib/design/types";
import {
  ArrowDownLeftIcon, CheckCircleIcon, AlertCircleIcon,
  RefreshIcon, ZapIcon, ArrowUpRightIcon, FileTextIcon, SendIcon,
} from "@/components/stealth/icons";

type Filter = "all" | "incoming" | "outgoing";

type ActivityItem =
  | { type: "incoming"; payment: StealthPayment; index: number; timestamp: number }
  | { type: "outgoing"; payment: OutgoingPayment; timestamp: number };

interface ActivityListProps {
  payments: StealthPayment[];
  outgoingPayments?: OutgoingPayment[];
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

export function ActivityList({
  payments, outgoingPayments, isScanning, scan,
  claimAddressesInitialized, claimAddresses, selectedIndex, selectAddress,
  handleClaim, claimingIndex, claimedTx, scanError,
}: ActivityListProps) {
  const { activeChainId } = useAuth();
  const explorerBase = getExplorerBase(activeChainId);
  const symbol = getChainConfig(activeChainId).nativeCurrency.symbol;
  const [filter, setFilter] = useState<Filter>("all");
  const [expandedTx, setExpandedTx] = useState<string | null>(null);

  // Build unified activity list sorted by time (newest first)
  const allActivities: ActivityItem[] = [];

  payments.forEach((p, i) => {
    allActivities.push({
      type: "incoming",
      payment: p,
      index: i,
      // Use block number as rough timestamp proxy (higher = newer)
      timestamp: p.announcement.blockNumber,
    });
  });

  (outgoingPayments || []).forEach((p) => {
    allActivities.push({
      type: "outgoing",
      payment: p,
      timestamp: p.timestamp,
    });
  });

  // Sort: outgoing by timestamp (ms), incoming by blockNumber — normalize to comparable values
  // For display, just interleave with outgoing on top if recent
  allActivities.sort((a, b) => {
    const tA = a.type === "outgoing" ? a.timestamp : a.timestamp * 1000000; // block numbers are ~6M range
    const tB = b.type === "outgoing" ? b.timestamp : b.timestamp * 1000000;
    return tB - tA;
  });

  const filtered = allActivities.filter((item) => {
    if (filter === "all") return true;
    return item.type === filter;
  });

  return (
    <VStack gap="24px" align="stretch">
      {/* Page heading */}
      <Text fontSize="24px" fontWeight={700} color={colors.text.primary} textAlign="center">
        Activities
      </Text>

      {/* Controls row */}
      <HStack justify="space-between" align="center" flexWrap="wrap" gap="12px">
        {/* Pill tabs */}
        <HStack gap="8px">
          {(["all", "incoming", "outgoing"] as Filter[]).map((f) => (
            <Box
              key={f}
              as="button"
              px="16px"
              py="8px"
              borderRadius={radius.full}
              bgColor={filter === f ? colors.text.primary : "transparent"}
              border={filter === f ? "none" : `1px solid ${colors.border.default}`}
              cursor="pointer"
              onClick={() => setFilter(f)}
              transition="all 0.15s ease"
              _hover={filter !== f ? { bgColor: colors.bg.input } : {}}
            >
              <Text
                fontSize="13px"
                fontWeight={filter === f ? 500 : 400}
                color={filter === f ? "#fff" : colors.text.muted}
                textTransform="capitalize"
              >
                {f}
              </Text>
            </Box>
          ))}
        </HStack>

        <HStack gap="8px">
          {/* Export CSV button */}
          <Box
            as="button"
            px="14px"
            py="8px"
            borderRadius={radius.full}
            border={`1px solid ${colors.border.default}`}
            cursor="pointer"
            _hover={{ bgColor: colors.bg.input }}
            display="flex" alignItems="center" gap="6px"
            onClick={() => {
              if (filtered.length === 0) return;
              const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
              const header = `Type,Status,From/To,Amount (${symbol}),Tx Hash\n`;
              const rows = filtered.map(item => {
                if (item.type === "incoming") {
                  const p = item.payment;
                  const status = p.keyMismatch ? "Key Mismatch" : "Received";
                  const from = p.announcement.caller || "unknown";
                  const amount = parseFloat(p.originalAmount || p.balance || "0").toFixed(6);
                  const tx = p.announcement.txHash;
                  return ["Incoming", status, from, amount, tx].map(esc).join(",");
                } else {
                  const p = item.payment;
                  return ["Outgoing", "Sent", p.to, p.amount, p.txHash].map(esc).join(",");
                }
              }).join("\n");
              const blob = new Blob([header + rows], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `dust-activities-${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <FileTextIcon size={14} color={colors.text.muted} />
            <Text fontSize="13px" fontWeight={400} color={colors.text.secondary}>Export CSV</Text>
          </Box>
          {/* Scan button */}
          <Box
            as="button"
            p="8px"
            borderRadius={radius.full}
            border={`1px solid ${colors.border.default}`}
            cursor="pointer"
            _hover={{ bgColor: colors.bg.input }}
            onClick={() => scan()}
          >
            {isScanning ? <Spinner size="xs" /> : <RefreshIcon size={16} color={colors.text.muted} />}
          </Box>
        </HStack>
      </HStack>

      {/* Sponsored gas banner */}
      <HStack gap="10px" px="16px" py="10px" bgColor="rgba(43, 90, 226, 0.05)"
        borderRadius={radius.md} border={`1.5px solid rgba(43, 90, 226, 0.12)`}>
        <Box w="32px" h="32px" borderRadius={radius.full}
          bgColor="rgba(43, 90, 226, 0.1)"
          display="flex" alignItems="center" justifyContent="center" flexShrink={0}>
          <ZapIcon size={16} color={colors.accent.indigo} />
        </Box>
        <VStack align="flex-start" gap="1px">
          <Text fontSize="13px" fontWeight={600} color={colors.text.primary}>Auto-Claim Enabled</Text>
          <Text fontSize="11px" color={colors.text.muted}>
            Payments are automatically claimed to your wallet. Gas is sponsored by Dust.
          </Text>
        </VStack>
      </HStack>

      {/* Claim address selector */}
      {claimAddressesInitialized && claimAddresses.length > 0 && (
        <HStack gap="8px" flexWrap="wrap">
          <Text fontSize="12px" color={colors.text.muted} fontWeight={500}>Claim to:</Text>
          {claimAddresses.slice(0, 3).map((addr, idx) => (
            <Box
              key={addr.address}
              as="button"
              px="12px" py="6px"
              borderRadius={radius.full}
              bgColor={selectedIndex === idx ? colors.accent.indigo : "transparent"}
              border={`1px solid ${selectedIndex === idx ? colors.accent.indigo : colors.border.default}`}
              cursor="pointer"
              onClick={() => selectAddress(idx)}
            >
              <Text fontSize="11px" fontWeight={500} color={selectedIndex === idx ? "#fff" : colors.text.muted}>
                {addr.label || `Wallet ${idx + 1}`}
              </Text>
            </Box>
          ))}
        </HStack>
      )}

      {/* Claimed tx success */}
      {claimedTx && (
        <HStack p="16px 20px" bgColor={colors.bg.card} borderRadius={radius.md} border={`2px solid ${colors.accent.indigo}`} gap="14px">
          <Box w="40px" h="40px" borderRadius={radius.full} bgColor="rgba(43, 90, 226, 0.08)"
            display="flex" alignItems="center" justifyContent="center" flexShrink={0}>
            <CheckCircleIcon size={20} color={colors.accent.indigo} />
          </Box>
          <VStack align="flex-start" gap="2px" flex={1} minW={0}>
            <Text fontSize="14px" fontWeight={600} color={colors.text.primary}>
              Payment Received!
            </Text>
            <Text fontSize="11px" color={colors.text.muted} fontFamily="'JetBrains Mono', monospace" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" maxW="100%">
              {claimedTx}
            </Text>
          </VStack>
          <a href={`${explorerBase}/tx/${claimedTx}`} target="_blank" rel="noopener noreferrer">
            <Box as="button" px="14px" py="7px" borderRadius={radius.full} border={`1px solid ${colors.border.default}`}
              cursor="pointer" _hover={{ borderColor: colors.accent.indigo }} display="flex" alignItems="center" gap="6px">
              <ArrowUpRightIcon size={12} color={colors.accent.indigo} />
              <Text fontSize="12px" color={colors.accent.indigo} fontWeight={500}>Explorer</Text>
            </Box>
          </a>
        </HStack>
      )}

      {/* Activity list */}
      {filtered.length === 0 ? (
        <Box p="48px" textAlign="center" bgColor={colors.bg.card} borderRadius={radius.lg} border={`2px solid ${colors.border.default}`}>
          <VStack gap="12px">
            <Text fontSize="15px" fontWeight={500} color={colors.text.primary}>No transactions yet</Text>
            <Text fontSize="13px" color={colors.text.muted}>
              {filter === "outgoing" ? "Sent payments will appear here" : filter === "incoming" ? "Received payments will appear here" : "Your payment history will appear here"}
            </Text>
          </VStack>
        </Box>
      ) : (
        <VStack gap="8px" align="stretch">
          {filtered.map((item) => {
            if (item.type === "incoming") {
              return <IncomingRow key={item.payment.announcement.txHash} item={item} payments={payments} expandedTx={expandedTx} setExpandedTx={setExpandedTx} handleClaim={handleClaim} claimingIndex={claimingIndex} />;
            } else {
              return <OutgoingRow key={item.payment.txHash} item={item} expandedTx={expandedTx} setExpandedTx={setExpandedTx} />;
            }
          })}
        </VStack>
      )}

      {scanError && (
        <HStack p="12px 16px" bgColor="rgba(229, 62, 62, 0.04)" borderRadius={radius.sm} gap="8px">
          <AlertCircleIcon size={14} color={colors.accent.red} />
          <Text fontSize="12px" color={colors.accent.red}>{scanError}</Text>
        </HStack>
      )}
    </VStack>
  );
}

function IncomingRow({ item, payments, expandedTx, setExpandedTx, handleClaim, claimingIndex }: {
  item: ActivityItem & { type: "incoming" };
  payments: StealthPayment[];
  expandedTx: string | null;
  setExpandedTx: (tx: string | null) => void;
  handleClaim: (idx: number) => Promise<void>;
  claimingIndex: number | null;
}) {
  const { activeChainId } = useAuth();
  const explorerBase = getExplorerBase(activeChainId);
  const symbol = getChainConfig(activeChainId).nativeCurrency.symbol;
  const payment = item.payment;
  const index = item.index;
  const displayAmount = parseFloat(payment.originalAmount || payment.balance || "0");
  const isExpanded = expandedTx === payment.announcement.txHash;

  return (
    <Box>
      <HStack
        p="16px 20px"
        bgColor={colors.bg.card}
        borderRadius={isExpanded ? `${radius.md} ${radius.md} 0 0` : radius.md}
        border={`2px solid ${colors.border.default}`}
        borderBottom={isExpanded ? "none" : `2px solid ${colors.border.default}`}
        justify="space-between"
        cursor="pointer"
        _hover={{ borderColor: colors.border.light }}
        transition="all 0.15s ease"
        onClick={() => setExpandedTx(isExpanded ? null : payment.announcement.txHash)}
      >
        <HStack gap="14px">
          <Box
            w="42px" h="42px"
            borderRadius={radius.full}
            bgColor="rgba(43, 90, 226, 0.08)"
            display="flex" alignItems="center" justifyContent="center"
            flexShrink={0}
          >
            <ArrowDownLeftIcon size={20} color={colors.accent.indigo} />
          </Box>
          <VStack align="flex-start" gap="2px">
            <Text fontSize="14px" fontWeight={500} color={colors.text.primary}>
              Received from {payment.announcement.caller?.slice(0, 6)}...{payment.announcement.caller?.slice(-4) || "unknown"}
            </Text>
            <Text fontSize="12px" color={colors.text.muted}>
              {symbol} &middot; Block #{payment.announcement.blockNumber.toLocaleString()}
            </Text>
          </VStack>
        </HStack>

        <HStack gap="12px">
          <Text fontSize="15px" fontWeight={600} color={colors.accent.indigo}>
            +{displayAmount.toFixed(4)} {symbol}
          </Text>
        </HStack>
      </HStack>

      {isExpanded && (
        <Box p="16px 20px" bgColor={colors.bg.card} borderRadius={`0 0 ${radius.md} ${radius.md}`}
          border={`2px solid ${colors.border.default}`} borderTop="none">
          <VStack gap="10px" align="stretch">
            <HStack justify="space-between">
              <Text fontSize="12px" color={colors.text.muted}>Tx Hash</Text>
              <Text fontSize="12px" color={colors.text.tertiary} fontFamily="'JetBrains Mono', monospace">
                {payment.announcement.txHash.slice(0, 18)}...{payment.announcement.txHash.slice(-10)}
              </Text>
            </HStack>
            <HStack justify="space-between">
              <Text fontSize="12px" color={colors.text.muted}>Stealth Address</Text>
              <Text fontSize="12px" color={colors.text.tertiary} fontFamily="'JetBrains Mono', monospace">
                {payment.announcement.stealthAddress.slice(0, 10)}...{payment.announcement.stealthAddress.slice(-8)}
              </Text>
            </HStack>
            <HStack justify="space-between">
              <Text fontSize="12px" color={colors.text.muted}>Gas</Text>
              <HStack gap="4px">
                <ZapIcon size={11} color={colors.accent.indigo} />
                <Text fontSize="12px" color={colors.accent.indigo} fontWeight={500}>Sponsored</Text>
              </HStack>
            </HStack>
            <a href={`${explorerBase}/tx/${payment.announcement.txHash}`} target="_blank" rel="noopener noreferrer">
              <HStack gap="5px" mt="4px">
                <ArrowUpRightIcon size={12} color={colors.accent.indigo} />
                <Text fontSize="12px" color={colors.accent.indigo} fontWeight={500}>View on Explorer</Text>
              </HStack>
            </a>
          </VStack>
        </Box>
      )}
    </Box>
  );
}

function OutgoingRow({ item, expandedTx, setExpandedTx }: {
  item: ActivityItem & { type: "outgoing" };
  expandedTx: string | null;
  setExpandedTx: (tx: string | null) => void;
}) {
  const { activeChainId } = useAuth();
  const explorerBase = getExplorerBase(activeChainId);
  const symbol = getChainConfig(activeChainId).nativeCurrency.symbol;
  const payment = item.payment;
  const isExpanded = expandedTx === payment.txHash;
  const displayAmount = parseFloat(payment.amount);
  const timeStr = new Date(payment.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <Box>
      <HStack
        p="16px 20px"
        bgColor={colors.bg.card}
        borderRadius={isExpanded ? `${radius.md} ${radius.md} 0 0` : radius.md}
        border={`2px solid ${colors.border.default}`}
        borderBottom={isExpanded ? "none" : `2px solid ${colors.border.default}`}
        justify="space-between"
        cursor="pointer"
        _hover={{ borderColor: colors.border.light }}
        transition="all 0.15s ease"
        onClick={() => setExpandedTx(isExpanded ? null : payment.txHash)}
      >
        <HStack gap="14px">
          <Box
            w="42px" h="42px"
            borderRadius={radius.full}
            bgColor="rgba(229, 62, 62, 0.08)"
            display="flex" alignItems="center" justifyContent="center"
            flexShrink={0}
          >
            <SendIcon size={20} color={colors.accent.red} />
          </Box>
          <VStack align="flex-start" gap="2px">
            <Text fontSize="14px" fontWeight={500} color={colors.text.primary}>
              Sent to {payment.to.includes(".tok") ? payment.to : `${payment.to.slice(0, 10)}...`}
            </Text>
            <Text fontSize="12px" color={colors.text.muted}>
              {symbol} &middot; {timeStr}
            </Text>
          </VStack>
        </HStack>

        <HStack gap="12px">
          <Text fontSize="15px" fontWeight={600} color={colors.accent.red}>
            -{displayAmount.toFixed(4)} {symbol}
          </Text>
        </HStack>
      </HStack>

      {isExpanded && (
        <Box p="16px 20px" bgColor={colors.bg.card} borderRadius={`0 0 ${radius.md} ${radius.md}`}
          border={`2px solid ${colors.border.default}`} borderTop="none">
          <VStack gap="10px" align="stretch">
            <HStack justify="space-between">
              <Text fontSize="12px" color={colors.text.muted}>Tx Hash</Text>
              <Text fontSize="12px" color={colors.text.tertiary} fontFamily="'JetBrains Mono', monospace">
                {payment.txHash.slice(0, 18)}...{payment.txHash.slice(-10)}
              </Text>
            </HStack>
            <HStack justify="space-between">
              <Text fontSize="12px" color={colors.text.muted}>Stealth Address</Text>
              <Text fontSize="12px" color={colors.text.tertiary} fontFamily="'JetBrains Mono', monospace">
                {payment.stealthAddress.slice(0, 10)}...{payment.stealthAddress.slice(-8)}
              </Text>
            </HStack>
            <HStack justify="space-between">
              <Text fontSize="12px" color={colors.text.muted}>Gas</Text>
              <HStack gap="4px">
                <ZapIcon size={11} color={colors.accent.indigo} />
                <Text fontSize="12px" color={colors.accent.indigo} fontWeight={500}>Sponsored announcement</Text>
              </HStack>
            </HStack>
            <a href={`${explorerBase}/tx/${payment.txHash}`} target="_blank" rel="noopener noreferrer">
              <HStack gap="5px" mt="4px">
                <ArrowUpRightIcon size={12} color={colors.accent.indigo} />
                <Text fontSize="12px" color={colors.accent.indigo} fontWeight={500}>View on Explorer</Text>
              </HStack>
            </a>
          </VStack>
        </Box>
      )}
    </Box>
  );
}
