"use client";

import { useState } from "react";
import { Box, Text, VStack, HStack, Input } from "@chakra-ui/react";
import { colors, radius, shadows, glass, buttonVariants, inputStates, transitions } from "@/lib/design/tokens";
import { getChainConfig } from "@/config/chains";
import { useAuth } from "@/contexts/AuthContext";
import type { ConsolidateProgress } from "@/hooks/stealth/useDustPool";
import type { StoredDeposit } from "@/lib/dustpool";
import { ethers } from "ethers";

interface ConsolidateModalProps {
  isOpen: boolean;
  onClose: () => void;
  deposits: StoredDeposit[];
  poolBalance: string;
  progress: ConsolidateProgress;
  onConsolidate: (recipient: string) => void;
  onReset: () => void;
  isConsolidating: boolean;
}

export function ConsolidateModal({
  isOpen,
  onClose,
  deposits,
  poolBalance,
  progress,
  onConsolidate,
  onReset,
  isConsolidating,
}: ConsolidateModalProps) {
  const { activeChainId } = useAuth();
  const symbol = getChainConfig(activeChainId).nativeCurrency.symbol;
  const [recipient, setRecipient] = useState("");

  if (!isOpen) return null;

  const unwithdrawable = deposits.filter(d => !d.withdrawn);
  const isValidRecipient = /^0x[0-9a-fA-F]{40}$/.test(recipient);
  const canConsolidate = isValidRecipient && unwithdrawable.length > 0 && !isConsolidating;

  const handleClose = () => {
    if (!isConsolidating) {
      onReset();
      onClose();
    }
  };

  const progressPercent = progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <Box
      position="fixed" top={0} left={0} right={0} bottom={0} zIndex={1000}
      display="flex" alignItems="center" justifyContent="center"
      onClick={handleClose}
    >
      {/* Backdrop */}
      <Box position="absolute" top={0} left={0} right={0} bottom={0} bg={colors.bg.overlay} />

      {/* Modal */}
      <Box
        bg={glass.modal.bg}
        borderRadius={radius.lg}
        border={glass.modal.border}
        boxShadow={shadows.modal}
        backdropFilter={glass.modal.backdropFilter}
        p="24px"
        maxW="440px"
        w="90%"
        position="relative"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <VStack gap="16px" align="stretch">
          {/* Header */}
          <HStack justifyContent="space-between">
            <Text fontSize="18px" fontWeight={700} color={colors.text.primary}>
              Withdraw from Pool
            </Text>
            {!isConsolidating && (
              <Box as="button" onClick={handleClose} p="4px" cursor="pointer">
                <Text fontSize="18px" color={colors.text.muted}>&times;</Text>
              </Box>
            )}
          </HStack>

          {/* Pool balance */}
          <Box
            p="16px"
            bg={colors.bg.input}
            borderRadius={radius.md}
          >
            <Text fontSize="13px" color={colors.text.tertiary} mb="4px">Pool Balance</Text>
            <Text fontSize="24px" fontWeight={800} color={colors.text.primary}>
              {parseFloat(poolBalance).toFixed(6)} {symbol}
            </Text>
            <Text fontSize="12px" color={colors.text.muted} mt="4px">
              {unwithdrawable.length} deposit{unwithdrawable.length !== 1 ? "s" : ""} in pool
            </Text>
          </Box>

          {/* Deposit list */}
          {unwithdrawable.length > 0 && (
            <VStack gap="6px" align="stretch" maxH="150px" overflowY="auto">
              {unwithdrawable.map((d, i) => (
                <HStack
                  key={d.commitment}
                  p="8px 12px"
                  bg={colors.bg.page}
                  borderRadius={radius.sm}
                  justifyContent="space-between"
                >
                  <Text fontSize="12px" color={colors.text.secondary}>
                    Deposit #{i + 1}
                  </Text>
                  <Text fontSize="12px" fontWeight={600} color={colors.text.primary}>
                    {parseFloat(ethers.utils.formatEther(d.amount)).toFixed(6)} {symbol}
                  </Text>
                </HStack>
              ))}
            </VStack>
          )}

          {/* Recipient input */}
          {progress.phase === 'idle' && (
            <>
              <Box>
                <Text fontSize="13px" fontWeight={600} color={colors.text.secondary} mb="6px">
                  Fresh recipient address
                </Text>
                <Input
                  placeholder="0x..."
                  value={recipient}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRecipient(e.target.value)}
                  fontSize="13px"
                  bg={inputStates.default.bg}
                  border={inputStates.default.border}
                  color={inputStates.default.color}
                  borderRadius={radius.sm}
                  _placeholder={{ color: inputStates.default.placeholder }}
                  _focus={{ borderColor: inputStates.focus.borderColor, boxShadow: inputStates.focus.boxShadow }}
                  fontFamily="mono"
                  px="12px"
                  transition={transitions.fast}
                />
                <Text fontSize="11px" color={colors.text.muted} mt="4px">
                  Use a fresh address with no on-chain history for maximum privacy
                </Text>
              </Box>

              <Box
                as="button"
                p="12px"
                bg={canConsolidate ? buttonVariants.primary.bg : colors.bg.elevated}
                borderRadius={radius.md}
                boxShadow={canConsolidate ? buttonVariants.primary.boxShadow : "none"}
                cursor={canConsolidate ? "pointer" : "not-allowed"}
                opacity={canConsolidate ? 1 : 0.5}
                _hover={canConsolidate ? { boxShadow: buttonVariants.primary.hover.boxShadow, transform: buttonVariants.primary.hover.transform } : {}}
                transition={transitions.fast}
                onClick={() => canConsolidate && onConsolidate(recipient)}
                textAlign="center"
              >
                <Text fontSize="14px" fontWeight={700} color={canConsolidate ? "#fff" : colors.text.muted}>
                  Withdraw All
                </Text>
              </Box>
            </>
          )}

          {/* Progress */}
          {(progress.phase === 'loading' || progress.phase === 'proving' || progress.phase === 'submitting') && (
            <Box>
              <Box
                h="6px"
                bg={colors.bg.elevated}
                borderRadius={radius.full}
                overflow="hidden"
                mb="8px"
              >
                <Box
                  h="100%"
                  w={`${progressPercent}%`}
                  bg={colors.accent.indigo}
                  borderRadius={radius.full}
                  transition="width 0.3s ease"
                />
              </Box>
              <Text fontSize="13px" color={colors.text.secondary} textAlign="center">
                {progress.message}
              </Text>
            </Box>
          )}

          {/* Done */}
          {progress.phase === 'done' && (
            <Box p="12px" bg={buttonVariants.success.bg} border={buttonVariants.success.border} borderRadius={radius.md}>
              <Text fontSize="13px" fontWeight={600} color={colors.accent.green} textAlign="center">
                {progress.message}
              </Text>
            </Box>
          )}

          {/* Error */}
          {progress.phase === 'error' && (
            <Box p="12px" bg={buttonVariants.danger.bg} border={buttonVariants.danger.border} borderRadius={radius.md}>
              <Text fontSize="13px" fontWeight={600} color={colors.accent.red} textAlign="center">
                {progress.message}
              </Text>
            </Box>
          )}
        </VStack>
      </Box>
    </Box>
  );
}
