"use client";

import { Box, Text, VStack, HStack } from "@chakra-ui/react";
import { colors, radius, shadows, glass, transitions, typography } from "@/lib/design/tokens";
import { SUPPORTED_TOKENS, type SwapToken } from "@/lib/swap/constants";
import { XIcon } from "@/components/stealth/icons";

const AVAILABLE_TOKENS = Object.values(SUPPORTED_TOKENS);

interface TokenSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (token: SwapToken) => void;
  selectedToken?: SwapToken | null;
  balances?: Record<string, string>;
}

export function TokenSelector({
  isOpen,
  onClose,
  onSelect,
  selectedToken,
  balances = {},
}: TokenSelectorProps) {
  if (!isOpen) return null;

  const handleSelect = (token: SwapToken) => {
    onSelect(token);
    onClose();
  };

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
        <HStack justify="space-between" p="20px 24px" borderBottom={`1px solid ${colors.border.light}`}>
          <Text fontSize="16px" fontWeight={700} color={colors.text.primary}>
            Select Token
          </Text>
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

        {/* Info banner */}
        <Box px="20px" pt="16px" pb="8px">
          <Box
            p="12px"
            borderRadius={radius.sm}
            bg="rgba(74,117,240,0.06)"
            border={`1px solid rgba(74,117,240,0.15)`}
          >
            <Text fontSize="12px" color={colors.text.tertiary}>
              Trading pair:{" "}
              <Box as="span" color={colors.text.primary} fontWeight={600}>
                ETH/USDC
              </Box>{" "}
              on Ethereum Sepolia
            </Text>
          </Box>
        </Box>

        {/* Token list */}
        <VStack gap="0" p="8px" align="stretch">
          {AVAILABLE_TOKENS.map((token) => {
            const isSelected =
              selectedToken?.address.toLowerCase() === token.address.toLowerCase();
            const balance = balances[token.symbol] ?? "\u2014";

            return (
              <Box
                key={token.address}
                as="button"
                onClick={() => handleSelect(token)}
                w="100%"
                display="flex"
                alignItems="center"
                gap="12px"
                p="16px"
                borderRadius={radius.md}
                bg={isSelected ? "rgba(74,117,240,0.08)" : "transparent"}
                border={isSelected ? `1px solid rgba(74,117,240,0.25)` : "1px solid transparent"}
                cursor="pointer"
                transition={transitions.fast}
                textAlign="left"
                _hover={{ bg: colors.bg.hover }}
              >
                {/* Token icon */}
                <Box
                  w="40px"
                  h="40px"
                  borderRadius="50%"
                  bg={colors.bg.cardSolid}
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  flexShrink={0}
                >
                  <Text fontSize="14px" fontWeight={700} color={colors.text.primary}>
                    {token.symbol.charAt(0)}
                  </Text>
                </Box>

                {/* Token info */}
                <Box flex="1">
                  <HStack gap="8px" mb="2px">
                    <Text fontWeight={600} color={colors.text.primary} fontSize="14px">
                      {token.symbol}
                    </Text>
                    {isSelected && (
                      <Box
                        px="8px"
                        py="2px"
                        borderRadius={radius.xs}
                        bg="rgba(74,117,240,0.12)"
                        fontSize="10px"
                        fontWeight={600}
                        color={colors.accent.indigo}
                      >
                        Selected
                      </Box>
                    )}
                  </HStack>
                  <Text fontSize="13px" color={colors.text.muted}>
                    {token.name}
                  </Text>
                </Box>

                {/* Balance */}
                <VStack gap="0" align="flex-end">
                  <Text
                    fontSize="13px"
                    fontFamily={typography.fontFamily.mono}
                    color={colors.text.primary}
                    fontWeight={500}
                  >
                    {balance}
                  </Text>
                  <Text fontSize="11px" color={colors.text.muted}>
                    Balance
                  </Text>
                </VStack>
              </Box>
            );
          })}
        </VStack>

        {/* Footer */}
        <Box p="16px" borderTop={`1px solid ${colors.border.light}`}>
          <Text fontSize="12px" color={colors.text.muted} textAlign="center">
            More trading pairs coming soon
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
