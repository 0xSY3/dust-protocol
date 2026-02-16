"use client";

import { Box, Text, HStack } from "@chakra-ui/react";
import { colors, radius, typography, transitions } from "@/lib/design/tokens";
import { SwapCard } from "@/components/swap/SwapCard";
import { PoolStats } from "@/components/swap/PoolStats";

export default function SwapPage() {
  // TODO: Wire to useSwapQuote / useStateView hooks when available
  const poolData = {
    currentPrice: null as number | null,
    ethReserve: 0,
    usdcReserve: 0,
    totalValueLocked: 0,
    isLoading: false,
    poolTick: undefined as number | undefined,
  };

  return (
    <Box minH="100vh" p={{ base: "16px", md: "32px" }} position="relative">
      {/* Page header */}
      <Box mb="32px">
        <Text
          fontSize="28px"
          fontWeight={700}
          color={colors.text.primary}
          fontFamily={typography.fontFamily.heading}
          letterSpacing="-0.02em"
          mb="8px"
        >
          Privacy Swap
        </Text>
        <Text fontSize="14px" color={colors.text.secondary}>
          Swap tokens privately using zero-knowledge proofs. Outputs are sent to stealth addresses.
        </Text>
      </Box>

      {/* Main content */}
      <Box
        display="flex"
        flexDirection={{ base: "column", xl: "row" }}
        gap="32px"
        alignItems={{ base: "center", xl: "flex-start" }}
        justifyContent="center"
      >
        {/* Swap Card */}
        <SwapCard />

        {/* Pool Statistics — hidden on mobile */}
        <Box display={{ base: "none", xl: "block" }}>
          <PoolStats {...poolData} />
        </Box>
      </Box>
    </Box>
  );
}
