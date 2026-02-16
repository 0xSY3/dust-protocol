"use client";

import { useState, useCallback } from "react";
import { Box, Text, VStack, HStack, Spinner } from "@chakra-ui/react";
import { colors, radius, shadows, glass, buttonVariants, transitions, typography } from "@/lib/design/tokens";
import { SUPPORTED_TOKENS, type SwapToken, isSwapSupported } from "@/lib/swap/constants";
import { useAuth } from "@/contexts/AuthContext";
import { TokenInput } from "./TokenInput";
import { TokenSelector } from "./TokenSelector";
import { SwapExecuteModal } from "./SwapExecuteModal";
import { DepositModal } from "./DepositModal";
import { LockIcon, ShieldIcon, AlertCircleIcon } from "@/components/stealth/icons";

type SwapState = "idle" | "preparing" | "generating-proof" | "submitting" | "success" | "error";

export function SwapCard() {
  const { isConnected, activeChainId } = useAuth();
  const swapSupported = isSwapSupported(activeChainId);

  // Token state
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [fromToken, setFromToken] = useState<SwapToken>(SUPPORTED_TOKENS.ETH);
  const [toToken, setToToken] = useState<SwapToken>(SUPPORTED_TOKENS.USDC);

  // UI state
  const [showSettings, setShowSettings] = useState(false);
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [selectingFor, setSelectingFor] = useState<"from" | "to">("from");
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [arrowRotation, setArrowRotation] = useState(0);

  // Swap state
  const [swapState, setSwapState] = useState<SwapState>("idle");
  const [swapStep, setSwapStep] = useState("");
  const [swapError, setSwapError] = useState<string | null>(null);
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [stealthAddress, setStealthAddress] = useState<string | null>(null);

  // Note selector state
  const [selectedNoteIndex, setSelectedNoteIndex] = useState(0);
  const [showNoteSelector, setShowNoteSelector] = useState(false);

  // Placeholder: Pool / Quote state (will be wired to hooks later)
  const poolLoading = false;
  const isInitialized = true;
  const isPrivacyPool = true;
  const currentPrice: number | null = null; // Will come from useSwapQuote hook
  const isQuoting = false;
  const relayerOnline = false;
  const relayerFee = 200; // bps
  const availableNotes: Array<{
    id?: string;
    amount: string;
    leafIndex?: number;
    createdAt: number;
  }> = [];

  // Derived state
  const exchangeRate = currentPrice ?? 0;
  const priceImpact = 0;
  const minReceived = toAmount
    ? (parseFloat(toAmount) * 0.99).toFixed(toToken.decimals > 6 ? 6 : 2)
    : "0";

  const isSwapping = ["preparing", "generating-proof", "submitting"].includes(swapState);

  const canSwap =
    isConnected &&
    fromAmount &&
    parseFloat(fromAmount) > 0 &&
    toAmount &&
    parseFloat(toAmount) > 0 &&
    swapState === "idle" &&
    !poolLoading &&
    !isQuoting;

  // Handlers
  const handleFlipTokens = () => {
    setArrowRotation((prev) => prev + 180);
    const tempToken = fromToken;
    setFromToken(toToken);
    setToToken(tempToken);
    const tempAmount = fromAmount;
    setFromAmount(toAmount);
    setToAmount(tempAmount);
  };

  const openTokenSelector = (type: "from" | "to") => {
    setSelectingFor(type);
    setTokenModalOpen(true);
  };

  const handleTokenSelect = (token: SwapToken) => {
    if (selectingFor === "from") {
      if (token.address === toToken.address) setToToken(fromToken);
      setFromToken(token);
    } else {
      if (token.address === fromToken.address) setFromToken(toToken);
      setToToken(token);
    }
  };

  const resetSwapState = useCallback(() => {
    setSwapState("idle");
    setSwapStep("");
    setSwapError(null);
    setTxHash(null);
    setStealthAddress(null);
    setShowSwapModal(false);
  }, []);

  const handleSwap = useCallback(async () => {
    if (!canSwap) return;

    setSwapError(null);
    setSwapState("preparing");
    setSwapStep("Preparing swap...");
    setShowSwapModal(true);

    // TODO: Wire to useDustSwap hook when available
    // For now, the modal shows the UI flow
    try {
      setSwapState("generating-proof");
      setSwapStep("Generating ZK proof...");
      // await generateProof(...)

      setSwapState("submitting");
      setSwapStep("Submitting to relayer...");
      // await submitToRelayer(...)

      setSwapState("success");
    } catch (err) {
      setSwapState("error");
      setSwapError(err instanceof Error ? err.message : "Swap failed");
    }
  }, [canSwap]);

  // Button content
  const getButtonContent = () => {
    if (!isConnected) return "Connect Wallet";
    if (!swapSupported) return "Swaps Not Available on This Chain";
    if (poolLoading) return "Loading Pool...";
    if (!isInitialized) return "Pool Not Initialized";
    if (isQuoting) return "Getting Quote...";
    if (isPrivacyPool && availableNotes.length === 0 && isConnected) return "Deposit Required";
    if (isSwapping) return swapStep || "Processing...";
    if (swapState === "success") return "Swap Complete!";
    if (swapState === "error") return "Try Again";
    if (!fromAmount || parseFloat(fromAmount) <= 0) return "Enter Amount";
    return "Swap";
  };

  const buttonDisabled =
    swapState === "error" ? false : !canSwap || !swapSupported;

  return (
    <>
      <Box w="100%" maxW="480px">
        {/* Card with gradient border */}
        <Box
          p="3px"
          borderRadius={radius.lg}
          bg={`linear-gradient(135deg, ${colors.accent.indigoDark} 0%, ${colors.accent.indigo} 50%, ${colors.accent.indigoDark} 100%)`}
          boxShadow={shadows.card}
          transition={transitions.smooth}
          _hover={{ boxShadow: shadows.cardHover }}
        >
          <Box
            bg={colors.bg.cardSolid}
            borderRadius="17px"
            p={{ base: "20px", sm: "24px" }}
          >
            {/* Header */}
            <HStack justify="space-between" mb="20px">
              <Text
                fontSize="20px"
                fontWeight={700}
                color={colors.text.primary}
                fontFamily={typography.fontFamily.heading}
                letterSpacing="-0.015em"
              >
                Swap
              </Text>
              <Box
                as="button"
                p="8px"
                borderRadius={radius.sm}
                transition={transitions.fast}
                cursor="pointer"
                _hover={{ bg: colors.bg.hover }}
                onClick={() => setShowSettings(!showSettings)}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={showSettings ? colors.accent.indigo : colors.text.muted}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </Box>
            </HStack>

            {/* Pool Status */}
            {!poolLoading && isInitialized && isPrivacyPool && (
              <Box
                mb="16px"
                p="12px"
                borderRadius={radius.sm}
                bg="rgba(74,117,240,0.06)"
                border={`1px solid rgba(74,117,240,0.15)`}
              >
                <HStack justify="space-between">
                  <HStack gap="8px">
                    <Box
                      w="8px"
                      h="8px"
                      borderRadius="50%"
                      bg={colors.accent.indigo}
                      animation="pulse 2s infinite"
                    />
                    <HStack gap="6px" fontSize="13px" color={colors.accent.indigo}>
                      <LockIcon size={14} />
                      <Text fontWeight={600}>
                        Privacy Pool ({fromToken.symbol} {"\u2192"} {toToken.symbol})
                      </Text>
                    </HStack>
                  </HStack>
                </HStack>
              </Box>
            )}

            {/* Relayer Status */}
            {relayerOnline && !poolLoading && (
              <Box
                mb="16px"
                p="12px"
                borderRadius={radius.sm}
                bg="rgba(34,197,94,0.04)"
                border={`1px solid rgba(34,197,94,0.15)`}
              >
                <HStack justify="space-between" fontSize="12px">
                  <HStack gap="6px" color={colors.text.muted}>
                    <Box w="8px" h="8px" borderRadius="50%" bg={colors.accent.green} />
                    <Text>Relayer Online</Text>
                  </HStack>
                  <Text color={colors.text.muted}>
                    Fee: {relayerFee / 100}%
                  </Text>
                </HStack>
              </Box>
            )}

            {/* Deposit Warning */}
            {isPrivacyPool && availableNotes.length === 0 && isConnected && !poolLoading && swapSupported && (
              <Box
                mb="16px"
                p="12px"
                borderRadius={radius.sm}
                bg="rgba(239,68,68,0.06)"
                border={`1px solid rgba(239,68,68,0.15)`}
              >
                <HStack gap="8px" align="flex-start">
                  <Box mt="2px" flexShrink={0}>
                    <AlertCircleIcon size={14} color={colors.accent.red} />
                  </Box>
                  <VStack gap="4px" align="flex-start">
                    <Text fontSize="13px" color={colors.accent.red} fontWeight={600}>
                      No {fromToken.symbol} Deposit Notes
                    </Text>
                    <Text fontSize="12px" color={colors.text.muted}>
                      You need to{" "}
                      <Box
                        as="button"
                        color={colors.accent.indigo}
                        fontWeight={600}
                        cursor="pointer"
                        _hover={{ textDecoration: "underline" }}
                        onClick={() => setShowDepositModal(true)}
                      >
                        deposit {fromToken.symbol}
                      </Box>{" "}
                      to the privacy pool first.
                    </Text>
                  </VStack>
                </HStack>
              </Box>
            )}

            {/* Note Selector */}
            {isPrivacyPool && availableNotes.length > 0 && !poolLoading && (
              <Box mb="16px">
                <Box
                  as="button"
                  w="100%"
                  p="12px"
                  borderRadius={radius.sm}
                  bg="rgba(74,117,240,0.04)"
                  border={`1px solid rgba(74,117,240,0.12)`}
                  cursor={availableNotes.length > 1 ? "pointer" : "default"}
                  transition={transitions.fast}
                  textAlign="left"
                  onClick={() =>
                    availableNotes.length > 1 &&
                    setShowNoteSelector(!showNoteSelector)
                  }
                  _hover={
                    availableNotes.length > 1
                      ? { borderColor: "rgba(74,117,240,0.25)" }
                      : {}
                  }
                >
                  <HStack justify="space-between" mb="6px">
                    <HStack gap="6px" fontSize="11px" color={colors.text.muted}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                        <line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" />
                      </svg>
                      <Text fontWeight={600}>Using Deposit Note</Text>
                    </HStack>
                    <Text fontSize="11px" color={colors.text.muted}>
                      {availableNotes.length} note{availableNotes.length > 1 ? "s" : ""}
                    </Text>
                  </HStack>
                  {availableNotes[selectedNoteIndex] && (
                    <HStack justify="space-between">
                      <HStack gap="8px">
                        <Text
                          fontSize="13px"
                          fontFamily={typography.fontFamily.mono}
                          color={colors.accent.green}
                          fontWeight={600}
                        >
                          {(
                            Number(availableNotes[selectedNoteIndex].amount) /
                            Math.pow(10, fromToken.decimals)
                          ).toFixed(4)}{" "}
                          {fromToken.symbol}
                        </Text>
                        {availableNotes[selectedNoteIndex].leafIndex !== undefined && (
                          <Box
                            px="6px"
                            py="2px"
                            borderRadius={radius.xs}
                            bg={colors.bg.elevated}
                            fontSize="10px"
                            fontFamily={typography.fontFamily.mono}
                            color={colors.text.muted}
                          >
                            Leaf #{availableNotes[selectedNoteIndex].leafIndex}
                          </Box>
                        )}
                      </HStack>
                    </HStack>
                  )}
                </Box>

                {/* Expanded note list */}
                {showNoteSelector && availableNotes.length > 1 && (
                  <Box
                    mt="4px"
                    borderRadius={radius.sm}
                    border={`1px solid rgba(74,117,240,0.12)`}
                    bg={colors.bg.cardSolid}
                    overflow="hidden"
                  >
                    <Box
                      px="12px"
                      py="8px"
                      borderBottom={`1px solid ${colors.border.light}`}
                    >
                      <Text fontSize="10px" color={colors.text.muted} textTransform="uppercase" letterSpacing="0.05em" fontWeight={600}>
                        Select a deposit note to swap
                      </Text>
                    </Box>
                    <Box maxH="192px" overflowY="auto">
                      {availableNotes.map((note, index) => {
                        const noteAmt =
                          Number(note.amount) / Math.pow(10, fromToken.decimals);
                        const isSelected = index === selectedNoteIndex;
                        return (
                          <Box
                            key={note.id ?? index}
                            as="button"
                            w="100%"
                            px="12px"
                            py="10px"
                            display="flex"
                            alignItems="center"
                            justifyContent="space-between"
                            bg={isSelected ? "rgba(74,117,240,0.08)" : "transparent"}
                            transition={transitions.fast}
                            textAlign="left"
                            cursor="pointer"
                            borderBottom={`1px solid ${colors.border.light}`}
                            _hover={{ bg: isSelected ? "rgba(74,117,240,0.1)" : colors.bg.hover }}
                            onClick={() => {
                              setSelectedNoteIndex(index);
                              setShowNoteSelector(false);
                            }}
                          >
                            <HStack gap="8px">
                              <Box
                                w="20px"
                                h="20px"
                                borderRadius="50%"
                                display="flex"
                                alignItems="center"
                                justifyContent="center"
                                bg={
                                  isSelected
                                    ? "rgba(34,197,94,0.15)"
                                    : colors.bg.elevated
                                }
                              >
                                {isSelected ? (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={colors.accent.green} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                ) : (
                                  <Box w="6px" h="6px" borderRadius="50%" bg={colors.text.muted} />
                                )}
                              </Box>
                              <Text
                                fontSize="13px"
                                fontFamily={typography.fontFamily.mono}
                                fontWeight={600}
                                color={isSelected ? colors.accent.green : colors.text.primary}
                              >
                                {noteAmt.toFixed(4)} {fromToken.symbol}
                              </Text>
                            </HStack>
                            <Text fontSize="10px" color={colors.text.muted}>
                              {note.leafIndex !== undefined ? `Leaf #${note.leafIndex}` : ""}
                            </Text>
                          </Box>
                        );
                      })}
                    </Box>
                  </Box>
                )}
              </Box>
            )}

            {/* Error Display */}
            {swapState === "error" && swapError && !showSwapModal && (
              <Box
                mb="16px"
                p="12px"
                borderRadius={radius.sm}
                bg="rgba(239,68,68,0.06)"
                border={`1px solid rgba(239,68,68,0.15)`}
              >
                <HStack gap="8px" align="flex-start">
                  <Box mt="2px" flexShrink={0}>
                    <AlertCircleIcon size={14} color={colors.accent.red} />
                  </Box>
                  <VStack gap="2px" align="flex-start">
                    <Text fontSize="13px" color={colors.accent.red} fontWeight={600}>
                      Swap Failed
                    </Text>
                    <Text fontSize="12px" color={colors.text.muted}>
                      {swapError}
                    </Text>
                  </VStack>
                </HStack>
              </Box>
            )}

            {/* From Token Input */}
            <TokenInput
              label={isPrivacyPool && availableNotes.length > 0 ? "You send (full note)" : "You send"}
              amount={fromAmount}
              onAmountChange={setFromAmount}
              token={fromToken}
              onTokenSelect={() => openTokenSelector("from")}
              balance={isConnected ? undefined : undefined} // Will come from useSwapQuote hook
              disabled={isSwapping || (isPrivacyPool && availableNotes.length > 0)}
            />

            {/* Swap Direction Button */}
            <Box display="flex" justifyContent="center" my="-6px" position="relative" zIndex={1}>
              <Box
                as="button"
                p="10px"
                borderRadius={radius.sm}
                bg={colors.bg.cardSolid}
                border={`1px solid ${colors.border.default}`}
                cursor={isSwapping ? "not-allowed" : "pointer"}
                transition={transitions.base}
                transform={`rotate(${arrowRotation}deg)`}
                onClick={!isSwapping ? handleFlipTokens : undefined}
                _hover={
                  isSwapping
                    ? {}
                    : {
                        borderColor: colors.border.accent,
                        transform: `rotate(${arrowRotation}deg) scale(1.1)`,
                      }
                }
                _active={
                  isSwapping
                    ? {}
                    : { transform: `rotate(${arrowRotation}deg) scale(0.95)` }
                }
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={colors.accent.indigo}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <polyline points="19 12 12 19 5 12" />
                </svg>
              </Box>
            </Box>

            {/* To Token Input */}
            <TokenInput
              label={isPrivacyPool ? "You receive (stealth)" : "You receive"}
              amount={toAmount}
              onAmountChange={setToAmount}
              token={toToken}
              onTokenSelect={() => openTokenSelector("to")}
              disabled
            />

            {/* Price Info */}
            {fromAmount && parseFloat(fromAmount) > 0 && !isSwapping && isInitialized && exchangeRate > 0 && (
              <Box
                mt="16px"
                p="12px"
                borderRadius={radius.sm}
                bg="rgba(255,255,255,0.02)"
                border={`1px solid ${colors.border.light}`}
              >
                <VStack gap="8px" align="stretch">
                  <HStack justify="space-between" fontSize="13px">
                    <HStack gap="6px" color={colors.text.muted}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                      <Text>Rate</Text>
                    </HStack>
                    <Text
                      fontFamily={typography.fontFamily.mono}
                      color={colors.text.primary}
                      fontSize="12px"
                    >
                      1 {fromToken.symbol} {"\u2248"}{" "}
                      {exchangeRate >= 1
                        ? exchangeRate.toLocaleString(undefined, { maximumFractionDigits: 2 })
                        : exchangeRate.toFixed(6)}{" "}
                      {toToken.symbol}
                    </Text>
                  </HStack>

                  <HStack justify="space-between" fontSize="13px">
                    <HStack gap="6px" color={colors.text.muted}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="19" y1="5" x2="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" />
                      </svg>
                      <Text>Price Impact</Text>
                    </HStack>
                    <Text
                      fontFamily={typography.fontFamily.mono}
                      fontSize="12px"
                      color={
                        priceImpact < 1
                          ? colors.accent.green
                          : priceImpact < 3
                          ? colors.accent.amber
                          : colors.accent.red
                      }
                    >
                      {priceImpact.toFixed(2)}%
                    </Text>
                  </HStack>

                  <HStack justify="space-between" fontSize="13px">
                    <HStack gap="6px" color={colors.text.muted}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                      </svg>
                      <Text>Min. Received</Text>
                    </HStack>
                    <Text
                      fontFamily={typography.fontFamily.mono}
                      color={colors.text.primary}
                      fontSize="12px"
                    >
                      {minReceived} {toToken.symbol}
                    </Text>
                  </HStack>
                </VStack>
              </Box>
            )}

            {/* Swap Button */}
            <Box
              as="button"
              w="100%"
              mt="20px"
              py="16px"
              borderRadius={radius.full}
              bg={
                buttonDisabled
                  ? colors.bg.elevated
                  : buttonVariants.primary.bg
              }
              boxShadow={
                buttonDisabled ? "none" : buttonVariants.primary.boxShadow
              }
              cursor={buttonDisabled ? "not-allowed" : "pointer"}
              opacity={buttonDisabled ? 0.5 : 1}
              transition={transitions.base}
              onClick={
                swapState === "error"
                  ? resetSwapState
                  : buttonDisabled
                  ? undefined
                  : handleSwap
              }
              _hover={
                buttonDisabled
                  ? {}
                  : {
                      boxShadow: buttonVariants.primary.hover.boxShadow,
                      transform: buttonVariants.primary.hover.transform,
                    }
              }
              _active={
                buttonDisabled
                  ? {}
                  : { transform: buttonVariants.primary.active.transform }
              }
            >
              <HStack justify="center" gap="8px">
                {isSwapping && (
                  <Spinner size="sm" color="#fff" />
                )}
                <Text fontSize="15px" fontWeight={700} color="#fff">
                  {getButtonContent()}
                </Text>
              </HStack>
            </Box>
          </Box>
        </Box>
      </Box>

      {/* Token Selector Modal */}
      <TokenSelector
        isOpen={tokenModalOpen}
        onClose={() => setTokenModalOpen(false)}
        onSelect={handleTokenSelect}
        selectedToken={selectingFor === "from" ? fromToken : toToken}
      />

      {/* Deposit Modal */}
      <DepositModal
        isOpen={showDepositModal}
        onClose={() => setShowDepositModal(false)}
        token={fromToken}
      />

      {/* Swap Execute Modal */}
      <SwapExecuteModal
        isOpen={showSwapModal}
        onClose={resetSwapState}
        step={swapState === "idle" ? "preparing" : (swapState as "preparing" | "generating-proof" | "submitting" | "success" | "error")}
        stepMessage={swapStep}
        fromToken={fromToken}
        toToken={toToken}
        fromAmount={fromAmount}
        toAmount={toAmount}
        error={swapError}
        txHash={txHash}
        stealthAddress={stealthAddress}
        onRetry={resetSwapState}
        chainId={activeChainId}
      />

      {/* Pulse animation keyframes */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </>
  );
}
