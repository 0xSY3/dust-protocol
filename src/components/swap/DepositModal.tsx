"use client";

import { useState } from "react";
import { Box, Text, VStack, HStack, Spinner } from "@chakra-ui/react";
import { colors, radius, shadows, glass, buttonVariants, transitions, typography } from "@/lib/design/tokens";
import { DEPOSIT_DENOMINATIONS, MIN_WAIT_BLOCKS, MIN_WAIT_MINUTES, type SwapToken } from "@/lib/swap/constants";
import { ShieldIcon, XIcon, CheckCircleIcon, AlertCircleIcon } from "@/components/stealth/icons";

type DepositStep = "input" | "approving" | "depositing" | "confirming" | "success" | "error";

interface DepositNote {
  commitment: bigint;
  nullifier: bigint;
  secret: bigint;
  amount: bigint;
  nullifierHash: bigint;
  leafIndex?: number;
}

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: SwapToken;
  onDeposit?: (amount: string) => Promise<{ note: DepositNote; txHash: string; leafIndex: number } | null>;
}

function ProgressStep({
  step,
  label,
  isActive,
  isComplete,
}: {
  step: number;
  label: string;
  isActive: boolean;
  isComplete: boolean;
}) {
  return (
    <HStack gap="12px">
      <Box
        w="28px"
        h="28px"
        borderRadius="50%"
        display="flex"
        alignItems="center"
        justifyContent="center"
        bg={
          isComplete
            ? `rgba(34,197,94,0.15)`
            : isActive
            ? `rgba(74,117,240,0.15)`
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
          <CheckCircleIcon size={14} color={colors.accent.green} />
        ) : isActive ? (
          <Spinner size="xs" color={colors.accent.indigo} />
        ) : (
          <Text fontSize="11px" fontWeight={600} color={colors.text.muted}>
            {step}
          </Text>
        )}
      </Box>
      <Text
        fontSize="13px"
        fontWeight={isActive ? 600 : 400}
        color={isComplete ? colors.accent.green : isActive ? colors.text.primary : colors.text.muted}
        transition={transitions.fast}
      >
        {label}
      </Text>
    </HStack>
  );
}

export function DepositModal({ isOpen, onClose, token, onDeposit }: DepositModalProps) {
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<DepositStep>("input");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ note: DepositNote; txHash: string; leafIndex: number } | null>(null);

  if (!isOpen) return null;

  const denominations = DEPOSIT_DENOMINATIONS[token.symbol] ?? ["0.1", "1", "5", "10"];

  const handleDeposit = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    if (!onDeposit) return;

    try {
      setError(null);
      setStep("approving");

      // For ERC20 tokens, approval step is needed
      if (token.symbol !== "ETH") {
        // Approval happens in the hook
        await new Promise((r) => setTimeout(r, 500));
      }

      setStep("depositing");
      const depositResult = await onDeposit(amount);

      if (!depositResult) {
        throw new Error("Deposit failed");
      }

      setStep("confirming");
      await new Promise((r) => setTimeout(r, 1000));

      setResult(depositResult);
      setStep("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit failed");
      setStep("error");
    }
  };

  const handleClose = () => {
    setAmount("");
    setStep("input");
    setError(null);
    setResult(null);
    onClose();
  };

  const isProcessing = ["approving", "depositing", "confirming"].includes(step);

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
                Deposit to Pool
              </Text>
              <Text fontSize="11px" color={colors.text.muted} fontWeight={500}>
                Add {token.symbol} to the privacy pool
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
          {step === "input" && (
            <VStack gap="20px" align="stretch">
              {/* Privacy info box */}
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
                    Deposits use fixed amounts to protect your privacy. All deposits of the
                    same amount are indistinguishable from each other, creating a strong
                    anonymity set.
                  </Text>
                </HStack>
              </Box>

              {/* Fixed denomination grid */}
              <VStack gap="8px" align="stretch">
                <Text fontSize="11px" color={colors.text.muted} fontWeight={600} textTransform="uppercase" letterSpacing="0.04em">
                  Select Amount
                </Text>
                <Box
                  display="grid"
                  gridTemplateColumns="repeat(5, 1fr)"
                  gap="8px"
                >
                  {denominations.map((denom) => (
                    <Box
                      key={denom}
                      as="button"
                      py="12px"
                      px="4px"
                      borderRadius={radius.sm}
                      bg={amount === denom ? "rgba(74,117,240,0.12)" : colors.bg.elevated}
                      border={`1px solid ${
                        amount === denom ? "rgba(74,117,240,0.3)" : colors.border.default
                      }`}
                      cursor="pointer"
                      transition={transitions.fast}
                      onClick={() => setAmount(denom)}
                      textAlign="center"
                      _hover={{
                        bg: amount === denom ? "rgba(74,117,240,0.15)" : colors.bg.hover,
                        borderColor: amount === denom ? "rgba(74,117,240,0.4)" : colors.border.focus,
                      }}
                    >
                      <Text
                        fontSize="13px"
                        fontFamily={typography.fontFamily.mono}
                        fontWeight={600}
                        color={amount === denom ? colors.accent.indigo : colors.text.primary}
                      >
                        {denom}
                      </Text>
                      <Text
                        fontSize="9px"
                        color={colors.text.muted}
                        mt="2px"
                      >
                        {token.symbol}
                      </Text>
                    </Box>
                  ))}
                </Box>
              </VStack>

              {/* Wait time notice */}
              <Box
                p="10px 12px"
                borderRadius={radius.sm}
                bg="rgba(245,158,11,0.06)"
                border={`1px solid rgba(245,158,11,0.12)`}
              >
                <HStack gap="8px" align="flex-start">
                  <Text fontSize="12px" mt="1px">⏳</Text>
                  <Text fontSize="11px" color={colors.text.tertiary} lineHeight="1.5">
                    After depositing, you must wait <Text as="span" fontWeight={700} color={colors.accent.amber}>~{MIN_WAIT_MINUTES} minutes</Text> ({MIN_WAIT_BLOCKS} blocks)
                    before swapping. This allows other deposits to mix in, strengthening your anonymity.
                  </Text>
                </HStack>
              </Box>

              {/* Deposit button */}
              <Box
                as="button"
                w="100%"
                py="14px"
                borderRadius={radius.full}
                bg={
                  amount && parseFloat(amount) > 0
                    ? buttonVariants.primary.bg
                    : colors.bg.elevated
                }
                boxShadow={
                  amount && parseFloat(amount) > 0
                    ? buttonVariants.primary.boxShadow
                    : "none"
                }
                cursor={amount && parseFloat(amount) > 0 ? "pointer" : "not-allowed"}
                opacity={amount && parseFloat(amount) > 0 ? 1 : 0.5}
                transition={transitions.base}
                onClick={handleDeposit}
                _hover={
                  amount && parseFloat(amount) > 0
                    ? {
                        boxShadow: buttonVariants.primary.hover.boxShadow,
                        transform: buttonVariants.primary.hover.transform,
                      }
                    : {}
                }
                _active={
                  amount && parseFloat(amount) > 0
                    ? {
                        transform: buttonVariants.primary.active.transform,
                      }
                    : {}
                }
              >
                <Text fontSize="15px" fontWeight={700} color="#fff" textAlign="center">
                  {amount && parseFloat(amount) > 0
                    ? `Deposit ${amount} ${token.symbol}`
                    : "Select an Amount"}
                </Text>
              </Box>
            </VStack>
          )}

          {/* Processing steps */}
          {isProcessing && (
            <VStack gap="16px" align="stretch" py="8px">
              <ProgressStep
                step={1}
                label={token.symbol === "ETH" ? "Preparing deposit..." : "Approving token..."}
                isActive={step === "approving"}
                isComplete={step !== "approving"}
              />
              <ProgressStep
                step={2}
                label="Depositing to privacy pool..."
                isActive={step === "depositing"}
                isComplete={step === "confirming"}
              />
              <ProgressStep
                step={3}
                label="Confirming on-chain..."
                isActive={step === "confirming"}
                isComplete={false}
              />
            </VStack>
          )}

          {/* Success */}
          {step === "success" && result && (
            <VStack gap="16px" align="stretch">
              <Box textAlign="center" py="8px">
                <Box display="inline-flex" mb="12px">
                  <CheckCircleIcon size={40} color={colors.accent.green} />
                </Box>
                <Text fontSize="16px" fontWeight={700} color={colors.text.primary} mb="4px">
                  Deposit Successful
                </Text>
                <Text fontSize="13px" color={colors.text.secondary}>
                  {amount} {token.symbol} deposited to privacy pool
                </Text>
              </Box>

              {/* Wait time warning */}
              <Box
                p="14px"
                borderRadius={radius.sm}
                bg="rgba(245,158,11,0.08)"
                border={`1px solid rgba(245,158,11,0.2)`}
              >
                <HStack gap="10px" align="flex-start">
                  <Text fontSize="18px" mt="-1px">⏳</Text>
                  <VStack gap="4px" align="flex-start">
                    <Text fontSize="13px" fontWeight={700} color={colors.accent.amber}>
                      Wait ~{MIN_WAIT_MINUTES} Minutes Before Swapping
                    </Text>
                    <Text fontSize="11px" color={colors.text.tertiary} lineHeight="1.6">
                      Your deposit needs to age for at least {MIN_WAIT_BLOCKS} blocks (~{MIN_WAIT_MINUTES} minutes)
                      before it can be used in a private swap. This mandatory waiting period lets other
                      users&apos; deposits enter the pool, making your transaction indistinguishable from theirs.
                      Without this wait, the timing of your deposit and swap could be correlated by an observer.
                    </Text>
                  </VStack>
                </HStack>
              </Box>

              <Box
                p="12px"
                borderRadius={radius.sm}
                bg="rgba(34,197,94,0.06)"
                border={`1px solid rgba(34,197,94,0.15)`}
              >
                <VStack gap="8px" align="stretch">
                  <HStack justify="space-between">
                    <Text fontSize="11px" color={colors.text.muted}>Leaf Index</Text>
                    <Text fontSize="11px" fontFamily={typography.fontFamily.mono} color={colors.text.primary}>
                      #{result.leafIndex}
                    </Text>
                  </HStack>
                  <HStack justify="space-between">
                    <Text fontSize="11px" color={colors.text.muted}>Commitment</Text>
                    <Text fontSize="11px" fontFamily={typography.fontFamily.mono} color={colors.text.primary}>
                      {(() => {
                        const hex = '0x' + result.note.commitment.toString(16).padStart(64, '0');
                        return `${hex.slice(0, 10)}...${hex.slice(-8)}`;
                      })()}
                    </Text>
                  </HStack>
                  <Box
                    as="button"
                    mt="4px"
                    py="8px"
                    px="12px"
                    borderRadius={radius.sm}
                    bg="rgba(34,197,94,0.1)"
                    border="1px solid rgba(34,197,94,0.2)"
                    cursor="pointer"
                    onClick={() => {
                      const noteData = {
                        commitment: '0x' + result.note.commitment.toString(16).padStart(64, '0'),
                        nullifier: '0x' + result.note.nullifier.toString(16).padStart(64, '0'),
                        secret: '0x' + result.note.secret.toString(16).padStart(64, '0'),
                        amount: result.note.amount.toString(),
                        leafIndex: result.leafIndex,
                        txHash: result.txHash,
                      };
                      navigator.clipboard.writeText(JSON.stringify(noteData, null, 2));
                    }}
                    _hover={{ bg: "rgba(34,197,94,0.15)" }}
                  >
                    <Text fontSize="11px" color={colors.accent.green} fontWeight={600}>
                      📋 Copy Full Note Details
                    </Text>
                  </Box>
                </VStack>
              </Box>

              <Box
                p="12px"
                borderRadius={radius.sm}
                bg="rgba(245,158,11,0.06)"
                border={`1px solid rgba(245,158,11,0.15)`}
              >
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
                _hover={{
                  boxShadow: buttonVariants.primary.hover.boxShadow,
                  transform: buttonVariants.primary.hover.transform,
                }}
              >
                <Text fontSize="15px" fontWeight={700} color="#fff" textAlign="center">
                  Done
                </Text>
              </Box>
            </VStack>
          )}

          {/* Error */}
          {step === "error" && (
            <VStack gap="16px" align="stretch">
              <Box textAlign="center" py="8px">
                <Box display="inline-flex" mb="12px">
                  <AlertCircleIcon size={40} color={colors.accent.red} />
                </Box>
                <Text fontSize="16px" fontWeight={700} color={colors.text.primary} mb="4px">
                  Deposit Failed
                </Text>
                <Text fontSize="13px" color={colors.text.secondary}>
                  {error}
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
                  onClick={() => {
                    setStep("input");
                    setError(null);
                  }}
                  _hover={{
                    boxShadow: buttonVariants.primary.hover.boxShadow,
                    transform: buttonVariants.primary.hover.transform,
                  }}
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
