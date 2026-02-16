"use client";

import { Box, Text, HStack, Input, Button } from "@chakra-ui/react";
import { colors, radius, glass, transitions, typography } from "@/lib/design/tokens";
import type { SwapToken } from "@/lib/swap/constants";

interface TokenInputProps {
  label: string;
  amount: string;
  onAmountChange: (amount: string) => void;
  token: SwapToken | null;
  onTokenSelect?: () => void;
  balance?: string;
  disabled?: boolean;
}

export function TokenInput({
  label,
  amount,
  onAmountChange,
  token,
  onTokenSelect,
  balance,
  disabled,
}: TokenInputProps) {
  const handlePercentage = (percent: number) => {
    if (!balance) return;
    const bal = parseFloat(balance.replace(/,/g, ""));
    if (isNaN(bal)) return;
    onAmountChange(((bal * percent) / 100).toString());
  };

  return (
    <Box
      borderRadius={radius.md}
      p="16px"
      bg={glass.input.bg}
      border={`1px solid ${colors.border.default}`}
      transition={transitions.base}
      _focusWithin={{
        borderColor: colors.border.focus,
      }}
    >
      {/* Header row */}
      <HStack justify="space-between" mb="10px">
        <Text fontSize="12px" color={colors.text.muted} fontWeight={600}>
          {label}
        </Text>
        {balance && (
          <Text fontSize="12px" color={colors.text.muted}>
            Balance:{" "}
            <Box as="span" fontFamily={typography.fontFamily.mono} color={colors.text.secondary}>
              {balance}
            </Box>
          </Text>
        )}
      </HStack>

      {/* Input row */}
      <HStack gap="12px">
        <Input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            const value = e.target.value.replace(/[^0-9.]/g, "");
            onAmountChange(value);
          }}
          placeholder="0.0"
          disabled={disabled}
          flex="1"
          minW="0"
          bg="transparent"
          border="none"
          outline="none"
          fontSize="24px"
          fontFamily={typography.fontFamily.mono}
          fontWeight={500}
          color={colors.text.primary}
          p="0"
          h="auto"
          _placeholder={{ color: colors.text.muted }}
          _focus={{ outline: "none", boxShadow: "none" }}
          _disabled={{ opacity: 0.6, cursor: "not-allowed" }}
        />

        <Button
          type="button"
          onClick={onTokenSelect}
          disabled={!onTokenSelect}
          flexShrink={0}
          display="flex"
          alignItems="center"
          gap="8px"
          px="12px"
          py="8px"
          borderRadius={radius.sm}
          bg={colors.bg.elevated}
          border={`1px solid ${colors.border.default}`}
          cursor={onTokenSelect ? "pointer" : "default"}
          transition={transitions.fast}
          _hover={onTokenSelect ? { borderColor: colors.border.accent } : {}}
        >
          {token ? (
            <>
              <Box
                w="24px"
                h="24px"
                borderRadius="50%"
                bg={colors.bg.cardSolid}
                display="flex"
                alignItems="center"
                justifyContent="center"
                overflow="hidden"
              >
                <Text fontSize="10px" fontWeight={700} color={colors.text.primary}>
                  {token.symbol.slice(0, 2)}
                </Text>
              </Box>
              <Text fontWeight={600} color={colors.text.primary} whiteSpace="nowrap" fontSize="14px">
                {token.symbol}
              </Text>
            </>
          ) : (
            <Text fontWeight={600} color={colors.text.primary} whiteSpace="nowrap" fontSize="14px">
              Select
            </Text>
          )}
          {onTokenSelect && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={colors.text.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          )}
        </Button>
      </HStack>

      {/* Percentage buttons */}
      {balance && !disabled && (
        <HStack gap="8px" mt="12px">
          {[25, 50, 75, 100].map((percent) => (
            <Button
              key={percent}
              type="button"
              onClick={() => handlePercentage(percent)}
              flex="1"
              px="8px"
              py="6px"
              borderRadius={radius.xs}
              fontSize="11px"
              fontWeight={600}
              bg="rgba(74,117,240,0.08)"
              color={colors.accent.indigo}
              border={`1px solid rgba(74,117,240,0.15)`}
              cursor="pointer"
              transition={transitions.fast}
              textAlign="center"
              _hover={{
                bg: "rgba(74,117,240,0.15)",
                borderColor: "rgba(74,117,240,0.3)",
              }}
            >
              {percent === 100 ? "MAX" : `${percent}%`}
            </Button>
          ))}
        </HStack>
      )}
    </Box>
  );
}
