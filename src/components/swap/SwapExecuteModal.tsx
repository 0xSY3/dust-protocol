"use client";

import { useState } from "react";
import { Box, Text, VStack, HStack, Spinner, Link } from "@chakra-ui/react";
import { colors, radius, shadows, glass, buttonVariants, transitions, typography, getExplorerBase } from "@/lib/design/tokens";
import { ShieldCheckIcon, XIcon, CheckCircleIcon, AlertCircleIcon, ArrowUpRightIcon } from "@/components/stealth/icons";
import type { SwapToken } from "@/lib/swap/constants";

export type SwapStep =
  | "preparing"
  | "building-merkle"
  | "creating-stealth"
  | "computing-proof"
  | "submitting"
  | "success"
  | "error";

interface SwapExecuteModalProps {
  isOpen: boolean;
  onClose: () => void;
  step: SwapStep;
  stepMessage: string;
  fromToken: SwapToken;
  toToken: SwapToken;
  fromAmount: string;
  toAmount: string;
  error?: string | null;
  rawError?: string | null;
  txHash?: string | null;
  stealthAddress?: string | null;
  retryCount?: number;
  onRetry?: () => void;
  chainId?: number;
}

const STEPS_ORDER: SwapStep[] = [
  "preparing",
  "building-merkle",
  "creating-stealth",
  "computing-proof",
  "submitting",
];

const STEP_LABELS: Record<string, string> = {
  "preparing": "Preparing swap...",
  "building-merkle": "Building Merkle tree...",
  "creating-stealth": "Creating stealth address...",
  "computing-proof": "Computing ZK-SNARK proof...",
  "submitting": "Submitting transaction...",
};

function StepIndicator({
  label,
  isActive,
  isComplete,
  showSpinner,
  suffix,
}: {
  label: string;
  isActive: boolean;
  isComplete: boolean;
  showSpinner?: boolean;
  suffix?: string;
}) {
  return (
    <HStack gap="12px">
      <Box
        w="24px"
        h="24px"
        borderRadius="50%"
        display="flex"
        alignItems="center"
        justifyContent="center"
        flexShrink={0}
        bg={
          isComplete
            ? "rgba(34,197,94,0.15)"
            : isActive
            ? "rgba(74,117,240,0.15)"
            : colors.bg.elevated
        }
        border={`1px solid ${
          isComplete
            ? "rgba(34,197,94,0.3)"
            : isActive
            ? "rgba(74,117,240,0.3)"
            : colors.border.default
        }`}
        transition={transitions.base}
      >
        {isComplete ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={colors.accent.green} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : isActive && showSpinner !== false ? (
          <Spinner size="xs" color={colors.accent.indigo} />
        ) : (
          <Box w="6px" h="6px" borderRadius="50%" bg={colors.text.muted} />
        )}
      </Box>
      <HStack gap="6px">
        <Text
          fontSize="13px"
          fontWeight={isActive ? 600 : 400}
          color={
            isComplete
              ? colors.accent.green
              : isActive
              ? colors.text.primary
              : colors.text.muted
          }
        >
          {label}
        </Text>
        {suffix && isActive && (
          <Text fontSize="11px" fontWeight={500} color={colors.accent.amber}>
            {suffix}
          </Text>
        )}
      </HStack>
    </HStack>
  );
}

export function SwapExecuteModal({
  isOpen,
  onClose,
  step,
  stepMessage,
  fromToken,
  toToken,
  fromAmount,
  toAmount,
  error,
  rawError,
  txHash,
  stealthAddress,
  retryCount,
  onRetry,
  chainId,
}: SwapExecuteModalProps) {
  const [showRawError, setShowRawError] = useState(false);

  if (!isOpen) return null;

  const isProcessing = STEPS_ORDER.includes(step as SwapStep);
  const explorerBase = getExplorerBase(chainId);
  const currentStepIndex = STEPS_ORDER.indexOf(step as SwapStep);

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
        if (e.target === e.currentTarget && !isProcessing) onClose();
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
              bg={
                step === "success"
                  ? `linear-gradient(135deg, ${colors.accent.green}, ${colors.accent.greenDark})`
                  : step === "error"
                  ? `linear-gradient(135deg, ${colors.accent.red}, ${colors.accent.redDark})`
                  : `linear-gradient(135deg, ${colors.accent.indigo}, ${colors.accent.violet})`
              }
              display="flex"
              alignItems="center"
              justifyContent="center"
            >
              {step === "success" ? (
                <CheckCircleIcon size={18} color="#fff" />
              ) : step === "error" ? (
                <AlertCircleIcon size={18} color="#fff" />
              ) : (
                <ShieldCheckIcon size={18} color="#fff" />
              )}
            </Box>
            <VStack align="flex-start" gap="0">
              <Text fontSize="16px" fontWeight={700} color={colors.text.primary}>
                {step === "success"
                  ? "Swap Complete"
                  : step === "error"
                  ? "Swap Failed"
                  : "Executing Swap"}
              </Text>
              <Text fontSize="11px" color={colors.text.muted} fontWeight={500}>
                {step === "success"
                  ? "Privacy-preserving swap succeeded"
                  : step === "error"
                  ? "Something went wrong"
                  : stepMessage || STEP_LABELS[step] || "Processing..."}
              </Text>
            </VStack>
          </HStack>
          {!isProcessing && (
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

        {/* Content */}
        <Box p="24px" pt="0">
          {/* Processing steps */}
          {isProcessing && (
            <VStack gap="14px" align="stretch" py="8px">
              {STEPS_ORDER.map((s, i) => {
                const isActive = s === step;
                const isComplete = currentStepIndex > i;
                const suffix =
                  s === "submitting" && isActive && retryCount && retryCount > 1
                    ? `(retry ${retryCount}/3)`
                    : undefined;

                return (
                  <StepIndicator
                    key={s}
                    label={STEP_LABELS[s]}
                    isActive={isActive}
                    isComplete={isComplete}
                    showSpinner={isActive}
                    suffix={suffix}
                  />
                );
              })}

              {/* Swap summary */}
              <Box
                mt="8px"
                p="12px"
                borderRadius={radius.sm}
                bg="rgba(255,255,255,0.02)"
                border={`1px solid ${colors.border.light}`}
              >
                <HStack justify="space-between">
                  <VStack gap="0" align="flex-start">
                    <Text fontSize="11px" color={colors.text.muted}>Sending</Text>
                    <Text fontSize="14px" fontFamily={typography.fontFamily.mono} color={colors.text.primary} fontWeight={600}>
                      {fromAmount} {fromToken.symbol}
                    </Text>
                  </VStack>
                  <Box color={colors.text.muted}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                    </svg>
                  </Box>
                  <VStack gap="0" align="flex-end">
                    <Text fontSize="11px" color={colors.text.muted}>Receiving</Text>
                    <Text fontSize="14px" fontFamily={typography.fontFamily.mono} color={colors.accent.green} fontWeight={600}>
                      {toAmount} {toToken.symbol}
                    </Text>
                  </VStack>
                </HStack>
              </Box>
            </VStack>
          )}

          {/* Success */}
          {step === "success" && (
            <VStack gap="16px" align="stretch">
              {/* Swap result */}
              <Box
                p="16px"
                borderRadius={radius.md}
                bg="rgba(34,197,94,0.06)"
                border={`1px solid rgba(34,197,94,0.15)`}
              >
                <HStack justify="space-between" mb="12px">
                  <VStack gap="0" align="flex-start">
                    <Text fontSize="11px" color={colors.text.muted}>Sent</Text>
                    <Text fontSize="18px" fontFamily={typography.fontFamily.mono} color={colors.text.primary} fontWeight={600}>
                      {fromAmount} {fromToken.symbol}
                    </Text>
                  </VStack>
                  <Box color={colors.accent.green}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                    </svg>
                  </Box>
                  <VStack gap="0" align="flex-end">
                    <Text fontSize="11px" color={colors.text.muted}>Received</Text>
                    <Text fontSize="18px" fontFamily={typography.fontFamily.mono} color={colors.accent.green} fontWeight={600}>
                      {toAmount} {toToken.symbol}
                    </Text>
                  </VStack>
                </HStack>

                {txHash && (
                  <HStack justify="space-between" pt="8px" borderTop={`1px solid rgba(34,197,94,0.1)`}>
                    <Text fontSize="11px" color={colors.text.muted}>Transaction</Text>
                    <Link
                      href={`${explorerBase}/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      display="flex"
                      alignItems="center"
                      gap="4px"
                      fontSize="11px"
                      fontFamily={typography.fontFamily.mono}
                      color={colors.accent.indigo}
                      _hover={{ textDecoration: "underline" }}
                    >
                      {txHash.slice(0, 10)}...{txHash.slice(-8)}
                      <ArrowUpRightIcon size={10} />
                    </Link>
                  </HStack>
                )}

                {stealthAddress && (
                  <HStack justify="space-between" pt="8px" mt="4px" borderTop={`1px solid rgba(34,197,94,0.1)`}>
                    <Text fontSize="11px" color={colors.text.muted}>Stealth Address</Text>
                    <Text fontSize="11px" fontFamily={typography.fontFamily.mono} color={colors.text.secondary}>
                      {stealthAddress.slice(0, 10)}...{stealthAddress.slice(-8)}
                    </Text>
                  </HStack>
                )}
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
                onClick={onClose}
                _hover={{
                  boxShadow: buttonVariants.primary.hover.boxShadow,
                  transform: buttonVariants.primary.hover.transform,
                }}
              >
                <Text fontSize="15px" fontWeight={700} color="#fff" textAlign="center">
                  Close
                </Text>
              </Box>
            </VStack>
          )}

          {/* Error */}
          {step === "error" && (
            <VStack gap="16px" align="stretch">
              <Box
                p="12px"
                borderRadius={radius.sm}
                bg="rgba(239,68,68,0.06)"
                border={`1px solid rgba(239,68,68,0.15)`}
              >
                <Text fontSize="13px" color={colors.accent.red} fontWeight={600} mb="4px">
                  Error Details
                </Text>
                <Text fontSize="12px" color={colors.text.tertiary} lineHeight="1.5">
                  {error || "An unknown error occurred"}
                </Text>

                {/* Collapsible raw error */}
                {rawError && (
                  <Box mt="8px">
                    <Box
                      as="button"
                      display="flex"
                      alignItems="center"
                      gap="4px"
                      cursor="pointer"
                      onClick={() => setShowRawError(!showRawError)}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke={colors.text.muted}
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{
                          transform: showRawError ? "rotate(90deg)" : "rotate(0deg)",
                          transition: "transform 0.15s ease",
                        }}
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      <Text fontSize="11px" color={colors.text.muted} fontWeight={500}>
                        {showRawError ? "Hide" : "Show"} raw error
                      </Text>
                    </Box>
                    {showRawError && (
                      <Box
                        mt="8px"
                        p="10px"
                        borderRadius={radius.xs}
                        bg="rgba(0,0,0,0.3)"
                        border={`1px solid ${colors.border.light}`}
                        maxH="140px"
                        overflowY="auto"
                        css={{
                          "&::-webkit-scrollbar": { width: "4px" },
                          "&::-webkit-scrollbar-thumb": {
                            background: "rgba(255,255,255,0.1)",
                            borderRadius: "4px",
                          },
                        }}
                      >
                        <Text
                          fontSize="10px"
                          fontFamily={typography.fontFamily.mono}
                          color={colors.text.muted}
                          whiteSpace="pre-wrap"
                          wordBreak="break-all"
                          lineHeight="1.5"
                        >
                          {rawError}
                        </Text>
                      </Box>
                    )}
                  </Box>
                )}
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
                  onClick={onClose}
                  _hover={{ bg: buttonVariants.secondary.hover.bg }}
                >
                  <Text fontSize="14px" fontWeight={600} color={colors.text.primary} textAlign="center">
                    Cancel
                  </Text>
                </Box>
                {onRetry && (
                  <Box
                    as="button"
                    flex="1"
                    py="14px"
                    borderRadius={radius.full}
                    bg={buttonVariants.primary.bg}
                    boxShadow={buttonVariants.primary.boxShadow}
                    cursor="pointer"
                    transition={transitions.base}
                    onClick={onRetry}
                    _hover={{
                      boxShadow: buttonVariants.primary.hover.boxShadow,
                      transform: buttonVariants.primary.hover.transform,
                    }}
                  >
                    <Text fontSize="14px" fontWeight={700} color="#fff" textAlign="center">
                      Try Again
                    </Text>
                  </Box>
                )}
              </HStack>
            </VStack>
          )}
        </Box>
      </Box>
    </Box>
  );
}
