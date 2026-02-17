import { useState, useMemo } from "react";
import { Box, Text, VStack, HStack } from "@chakra-ui/react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { colors, radius, shadows, glass, buttonVariants, transitions, getExplorerBase } from "@/lib/design/tokens";
import { useAuth } from "@/contexts/AuthContext";
import { getChainConfig } from "@/config/chains";
import type { StealthPayment, OutgoingPayment } from "@/lib/design/types";
import {
  ArrowDownLeftIcon, ArrowUpRightIcon, ChevronRightIcon,
} from "@/components/stealth/icons";

interface RecentActivityCardProps {
  payments: StealthPayment[];
  outgoingPayments?: OutgoingPayment[];
}

type Filter = "all" | "incoming" | "outgoing";

export function RecentActivityCard({ payments, outgoingPayments = [] }: RecentActivityCardProps) {
  const { activeChainId } = useAuth();
  const explorerBase = getExplorerBase(activeChainId);
  const symbol = getChainConfig(activeChainId).nativeCurrency.symbol;
  const [filter, setFilter] = useState<Filter>("all");

  // Merge and sort
  const combined = useMemo(() => {
    const incomingItems = payments.map(p => ({
      type: 'incoming' as const,
      data: p,
      // Approximate timestamp for sorting (high block = recent)
      // Since we don't have block timestamps, we use blockNumber * 1000 as a rough relative sort metric
      // This is imperfect against wall-clock outgoing timestamps but ensures block order is preserved
      sortKey: p.announcement.blockNumber * 1000000 // Weight blocks heavily to keep relative order
    }));

    const outgoingItems = outgoingPayments.map(p => ({
      type: 'outgoing' as const,
      data: p,
      sortKey: p.timestamp // Wall clock ms
    }));

    // If we have both, determining relative order is hard without block times. 
    // We'll separate them if sorting is ambiguous, or just interleave assuming current block is "now".
    // For simplicity, we just sort each list descending and if "all", we interleave?
    // Actually, `outgoing` usually happens at the "tip" of the chain.
    // If we assume incoming payments are "confirmed" blocks, they are slightly older than "just sent" outgoing?
    // Let's just normalize to a big number sorting.

    // Better strategy: Sort incoming by block desc, outgoing by time desc.
    // Concatenate? No.
    // Let's just map them to a common interface and sort.
    // Since we can't perfectly compare block# vs timestamp without extra data,
    // we will prioritize displaying the "latest" of each if mixed?
    // Actually, `payments` array from scanner might be unsorted or sorted asc?
    // Scanner usually appends, so likely ascending.

    // Let's create a wrapper
    const all = [...incomingItems, ...outgoingItems];

    // We can't sort mixed types perfectly without Block <-> Time mapping.
    // But within their own types, we can sort.
    // And usually users care about "what happened recently".
    // Let's just assume local outgoing are "newer" than older blocks, but maybe older than very recent blocks?
    // We will just sort by `sortKey`? No, comparing `1020000 * 1000000` vs `1740000000000` is nonsense.

    // Fallback: Show outgoing at top (since likely user just did it) if "all"?
    // Or just separate?
    // Let's rely on filter. If "all", we interleave simply or just stack Outgoing then Incoming?
    // Stacking Outgoing then Incoming is safer for "I just sent it".

    // Sort outgoing descending
    outgoingItems.sort((a, b) => b.data.timestamp - a.data.timestamp);
    // Sort incoming descending (block number)
    incomingItems.sort((a, b) => b.data.announcement.blockNumber - a.data.announcement.blockNumber);

    return { incoming: incomingItems, outgoing: outgoingItems };
  }, [payments, outgoingPayments]);

  const displayed = useMemo(() => {
    if (filter === 'outgoing') return combined.outgoing;
    if (filter === 'incoming') return combined.incoming;
    // Interleave: take latest of each?
    // Since we can't compare, let's just show top 3 outgoing + top 3 incoming?
    // Or just all outgoing then all incoming (limited)?
    return [...combined.outgoing, ...combined.incoming];
  }, [filter, combined]);

  const recent = displayed.slice(0, 5);

  return (
    <VStack gap="20px" align="stretch">
      {/* Header row with tabs and count */}
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
              bg={filter === f ? buttonVariants.primary.bg : "transparent"}
              border={filter === f ? "none" : `1px solid ${colors.border.default}`}
              boxShadow={filter === f ? buttonVariants.primary.boxShadow : "none"}
              cursor="pointer"
              onClick={() => setFilter(f)}
              transition={transitions.fast}
              _hover={filter !== f ? { bgColor: colors.bg.hover } : {}}
            >
              <Text
                fontSize="13px"
                fontWeight={filter === f ? 600 : 400}
                color={filter === f ? "#fff" : colors.text.muted}
                textTransform="capitalize"
              >
                {f}
              </Text>
            </Box>
          ))}
        </HStack>
        <Text fontSize="14px" fontWeight={500} color={colors.text.muted}>
          {outgoingPayments.length + payments.length} transactions total
        </Text>
      </HStack>

      {/* Activity list */}
      {recent.length === 0 ? (
        <Box p="48px" textAlign="center" bg={glass.card.bg} borderRadius={radius.lg} border={glass.card.border} boxShadow={shadows.card} backdropFilter={glass.card.backdropFilter}>
          <VStack gap="12px">
            <Text fontSize="16px" fontWeight={700} color={colors.text.primary}>No activities yet</Text>
            <Text fontSize="14px" color={colors.text.muted}>
              {filter === "outgoing" ? "Sent payments will appear here" : "Received payments will appear here"}
            </Text>
          </VStack>
        </Box>
      ) : (
        <VStack gap="8px" align="stretch">
          {recent.map((item, i) => {
            const isIncoming = item.type === 'incoming';
            // @ts-ignore - union type handling
            const txHash = isIncoming ? item.data.announcement.txHash : item.data.txHash;
            // @ts-ignore
            const amount = isIncoming ? (item.data.originalAmount || item.data.balance || "0") : item.data.amount;

            return (
              <HStack
                key={`${txHash}-${i}`}
                p="16px 20px"
                bg={glass.card.bg}
                borderRadius={radius.md}
                border={glass.card.border}
                backdropFilter={glass.card.backdropFilter}
                justify="space-between"
                cursor="pointer"
                _hover={{ bg: glass.cardHover.bg, border: glass.cardHover.border }}
                transition={transitions.fast}
                onClick={() => window.open(`${explorerBase}/tx/${txHash}`, "_blank")}
              >
                <HStack gap="14px">
                  <Box
                    w="40px" h="40px"
                    borderRadius={radius.full}
                    bgColor={isIncoming ? "rgba(43, 90, 226, 0.08)" : "rgba(245, 158, 11, 0.08)"}
                    display="flex" alignItems="center" justifyContent="center"
                  >
                    {isIncoming ? (
                      <ArrowDownLeftIcon size={18} color={colors.accent.indigo} />
                    ) : (
                      <ArrowUpRightIcon size={18} color={colors.accent.amber} />
                    )}
                  </Box>
                  <VStack align="flex-start" gap="2px">
                    <Text fontSize="15px" fontWeight={600} color={colors.text.primary}>
                      {isIncoming
                        // @ts-ignore
                        ? `Received from ${item.data.announcement.caller?.slice(0, 6)}...`
                        // @ts-ignore
                        : `Sent to ${item.data.to}`}
                    </Text>
                    <Text fontSize="13px" color={colors.text.muted}>
                      {isIncoming
                        // @ts-ignore
                        ? `${symbol} · Block #${item.data.announcement.blockNumber}`
                        // @ts-ignore
                        : `${symbol} · ${new Date(item.data.timestamp).toLocaleDateString()}`
                      }
                    </Text>
                  </VStack>
                </HStack>
                <Text
                  fontSize="16px"
                  fontWeight={700}
                  color={isIncoming ? colors.accent.indigo : colors.text.primary}
                >
                  {isIncoming ? '+' : '-'}{parseFloat(amount).toFixed(4)} {symbol}
                </Text>
              </HStack>
            );
          })}
        </VStack>
      )}

      {/* See all link */}
      <Link href="/activities" style={{ textDecoration: "none" }}>
        <Box
          p="14px"
          bg={glass.card.bg}
          borderRadius={radius.md}
          border={glass.card.border}
          backdropFilter={glass.card.backdropFilter}
          textAlign="center"
          cursor="pointer"
          _hover={{ bg: glass.cardHover.bg, border: glass.cardHover.border }}
          transition={transitions.fast}
        >
          <Text fontSize="15px" fontWeight={600} color={colors.text.secondary}>See all activities</Text>
        </Box>
      </Link>
    </VStack>
  );
}
