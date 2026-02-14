"use client";

import { useState, useEffect, ChangeEvent } from "react";
import { Box, Text, VStack, HStack, Input, Spinner } from "@chakra-ui/react";
import { colors, radius, shadows, glass, buttonVariants, inputStates, transitions, getExplorerBase } from "@/lib/design/tokens";
import { useStealthSend, useStealthName } from "@/hooks/stealth";
import { useAuth } from "@/contexts/AuthContext";
import { isStealthName, NAME_SUFFIX, lookupStealthMetaAddress } from "@/lib/stealth";
import { getChainConfig } from "@/config/chains";
import { getChainProvider } from "@/lib/providers";
import { ethers } from "ethers";
import {
  SendIcon, CheckCircleIcon, AlertCircleIcon, LockIcon,
  ArrowUpRightIcon, XIcon,
} from "@/components/stealth/icons";

interface SendModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SendModal({ isOpen, onClose }: SendModalProps) {
  const { activeChainId } = useAuth();
  const chainConfig = getChainConfig(activeChainId);
  const { generateAddressFor, sendEthToStealth, lastGeneratedAddress, isLoading, error: sendError } = useStealthSend(activeChainId);
  const { resolveName, isConfigured: nameRegistryConfigured } = useStealthName();

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [sendStep, setSendStep] = useState<"input" | "confirm" | "success">("input");
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [resolvedLinkSlug, setResolvedLinkSlug] = useState<string | undefined>(undefined);
  const [isResolving, setIsResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [sendTxHash, setSendTxHash] = useState<string | null>(null);

  useEffect(() => {
    const resolve = async () => {
      setResolveError(null);
      setResolvedLinkSlug(undefined);
      if (!recipient) { setResolvedAddress(null); return; }
      if (recipient.startsWith("st:")) { setResolvedAddress(recipient); return; }

      // Handle 0x addresses — look up stealth meta-address from ERC-6538 registry
      if (recipient.startsWith("0x") && recipient.length === 42) {
        setIsResolving(true);
        try {
          const provider = getChainProvider(activeChainId);
          const metaBytes = await lookupStealthMetaAddress(provider, recipient);
          setIsResolving(false);
          if (metaBytes) {
            setResolvedAddress(`st:eth:0x${metaBytes.replace(/^0x/, "")}`);
          } else {
            setResolvedAddress(null);
            setResolveError("This address hasn't registered for stealth payments");
          }
        } catch {
          setIsResolving(false);
          setResolvedAddress(null);
          setResolveError("Failed to look up address");
        }
        return;
      }

      if (nameRegistryConfigured && isStealthName(recipient)) {
        setIsResolving(true);
        // Handle multi-part .tok names: "link.username.tok" → resolve "username", extract linkSlug
        // Single part: "username.tok" → resolve "username"
        let nameToResolve = recipient;
        const normalized = recipient.toLowerCase().trim();
        if (normalized.endsWith(NAME_SUFFIX)) {
          const withoutSuffix = normalized.slice(0, -NAME_SUFFIX.length);
          const parts = withoutSuffix.split(".");
          if (parts.length > 1) {
            nameToResolve = parts[parts.length - 1] + NAME_SUFFIX;
            setResolvedLinkSlug(parts[0]);
          }
        }
        const resolved = await resolveName(nameToResolve);
        setIsResolving(false);
        if (resolved) {
          setResolvedAddress(`st:eth:${resolved}`);
        } else {
          setResolvedAddress(null);
          setResolvedLinkSlug(undefined);
          setResolveError(`Name "${nameToResolve.replace(NAME_SUFFIX, "")}" not found`);
        }
        return;
      }
      setResolvedAddress(null);
    };
    const t = setTimeout(resolve, 300);
    return () => clearTimeout(t);
  }, [recipient, nameRegistryConfigured, resolveName, activeChainId]);

  const handlePreview = () => {
    const addr = resolvedAddress || recipient;
    if (!addr || !amount) return;
    if (generateAddressFor(addr)) setSendStep("confirm");
  };

  const handleSend = async () => {
    const hash = await sendEthToStealth(resolvedAddress || recipient, amount, resolvedLinkSlug);
    if (hash) { setSendTxHash(hash); setSendStep("success"); }
  };

  const reset = () => {
    setRecipient(""); setAmount(""); setSendStep("input");
    setSendTxHash(null); setResolvedAddress(null); setResolvedLinkSlug(undefined); setResolveError(null);
  };

  const handleClose = () => { reset(); onClose(); };

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
      p="16px"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <Box
        w="100%"
        maxW="440px"
        bg={glass.modal.bg}
        border={glass.modal.border}
        borderRadius={radius.xl}
        boxShadow={shadows.modal}
        backdropFilter={glass.modal.backdropFilter}
        overflow="hidden"
      >
        {/* Header — hidden on success */}
        {sendStep !== "success" && (
          <HStack justify="space-between" p="20px 24px">
            <HStack gap="12px">
              <Box w="36px" h="36px" borderRadius={radius.md}
                bg={`linear-gradient(135deg, ${colors.accent.indigo}, ${colors.accent.indigoBright})`}
                display="flex" alignItems="center" justifyContent="center"
                boxShadow="0 2px 8px rgba(43, 90, 226, 0.25)">
                <SendIcon size={17} color="#fff" />
              </Box>
              <VStack align="flex-start" gap="0">
                <Text fontSize="16px" fontWeight={700} color={colors.text.primary} letterSpacing="-0.01em">
                  Send Payment
                </Text>
                <Text fontSize="11px" color={colors.text.muted} fontWeight={500}>Private &middot; Gas Free</Text>
              </VStack>
            </HStack>
            <Box as="button" onClick={handleClose} cursor="pointer" p="8px" borderRadius={radius.full}
              border={`1px solid ${colors.border.default}`}
              _hover={{ bgColor: colors.bg.hover, borderColor: colors.border.light }}
              transition={transitions.fast}>
              <XIcon size={15} color={colors.text.muted} />
            </Box>
          </HStack>
        )}

        {/* Content */}
        <Box p="24px" pt={sendStep === "success" ? "24px" : "0"}>
          <VStack gap="20px" align="stretch">
            {sendStep === "input" && (
              <>
                {/* Recipient field */}
                <Box>
                  <Text fontSize="12px" color={colors.text.muted} mb="10px" fontWeight={600}
                    textTransform="uppercase" letterSpacing="0.05em">
                    Recipient
                  </Text>
                  <Box position="relative">
                    <Input
                      placeholder={`alice${NAME_SUFFIX} or 0x...`}
                      value={recipient}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setRecipient(e.target.value)}
                      h="52px" bg={inputStates.default.bg}
                      border={`1.5px solid ${resolvedAddress ? colors.accent.indigo : resolveError ? colors.accent.red : colors.border.default}`}
                      borderRadius={radius.md}
                      color={inputStates.default.color} fontSize="15px" fontWeight={500} px="18px"
                      _placeholder={{ color: inputStates.default.placeholder, fontWeight: 400 }}
                      _focus={{ borderColor: inputStates.focus.borderColor, boxShadow: inputStates.focus.boxShadow }}
                      transition={transitions.fast}
                    />
                    {/* Status indicator inside input */}
                    {!isResolving && resolvedAddress && !recipient.startsWith("st:") && (
                      <Box position="absolute" right="14px" top="50%" transform="translateY(-50%)">
                        <CheckCircleIcon size={18} color={colors.accent.indigo} />
                      </Box>
                    )}
                    {isResolving && (
                      <Box position="absolute" right="14px" top="50%" transform="translateY(-50%)">
                        <Spinner size="xs" color={colors.accent.indigo} />
                      </Box>
                    )}
                  </Box>
                  <Box h="18px" mt="6px">
                    {isResolving && (
                      <Text fontSize="11px" color={colors.text.muted} fontWeight={500}>
                        {recipient.startsWith("0x") ? "Looking up address..." : "Looking up name..."}
                      </Text>
                    )}
                    {!isResolving && resolvedAddress && !recipient.startsWith("st:") && (
                      <Text fontSize="11px" color={colors.accent.indigo} fontWeight={600}>
                        {recipient.startsWith("0x") ? "Address resolved" : "Name resolved"}
                      </Text>
                    )}
                    {!isResolving && resolveError && (
                      <HStack gap="4px"><AlertCircleIcon size={11} color={colors.accent.red} /><Text fontSize="11px" color={colors.accent.red} fontWeight={500}>{resolveError}</Text></HStack>
                    )}
                  </Box>
                </Box>

                {/* Amount field */}
                <Box>
                  <Text fontSize="12px" color={colors.text.muted} mb="10px" fontWeight={600}
                    textTransform="uppercase" letterSpacing="0.05em">
                    Amount
                  </Text>
                  <Input
                    placeholder="0.00"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      const v = e.target.value;
                      if (v === "" || /^\d*\.?\d*$/.test(v)) setAmount(v);
                    }}
                    h="60px" px="18px"
                    bg={inputStates.default.bg}
                    border={`1.5px solid ${colors.border.default}`}
                    borderRadius={radius.md}
                    color={inputStates.default.color} fontSize="32px" fontWeight={700}
                    letterSpacing="-0.03em"
                    _placeholder={{ color: colors.text.muted }}
                    _focus={{ borderColor: inputStates.focus.borderColor, boxShadow: inputStates.focus.boxShadow, outline: "none" }}
                    transition={transitions.fast}
                  />
                  <Text fontSize="11px" color={colors.text.muted} mt="8px" fontWeight={500}>{chainConfig.name}</Text>
                </Box>

                {/* Preview button */}
                <Box
                  as="button"
                  p="16px"
                  bg={buttonVariants.primary.bg}
                  borderRadius={radius.full}
                  boxShadow={buttonVariants.primary.boxShadow}
                  cursor="pointer"
                  _hover={{ boxShadow: buttonVariants.primary.hover.boxShadow, transform: buttonVariants.primary.hover.transform }}
                  _active={{ transform: buttonVariants.primary.active.transform }}
                  onClick={handlePreview}
                  textAlign="center"
                  transition={transitions.fast}
                  opacity={(!resolvedAddress && !recipient.startsWith("st:")) || !amount || isLoading || isResolving ? 0.4 : 1}
                  pointerEvents={(!resolvedAddress && !recipient.startsWith("st:")) || !amount || isLoading || isResolving ? "none" : "auto"}
                >
                  <Text fontSize="15px" fontWeight={700} color="#fff">Preview Payment</Text>
                </Box>
              </>
            )}

            {sendStep === "confirm" && lastGeneratedAddress && (
              <>
                {/* Big amount hero */}
                <VStack gap="4px" py="8px">
                  <Text fontSize="42px" fontWeight={800} color={colors.text.primary}
                    letterSpacing="-0.04em" lineHeight="1" textAlign="center">
                    {amount} <Text as="span" fontSize="20px" fontWeight={600} color={colors.text.muted}>{chainConfig.nativeCurrency.symbol}</Text>
                  </Text>
                  <Text fontSize="14px" color={colors.text.muted} textAlign="center" fontWeight={500}>
                    to{" "}
                    <Text as="span" fontWeight={700} color={colors.text.primary}>
                      {recipient.includes(".tok") ? recipient : `${recipient.slice(0, 14)}...`}
                    </Text>
                  </Text>
                </VStack>

                {/* Details card */}
                <Box p="16px 18px" bgColor={colors.bg.input} borderRadius={radius.md}>
                  <VStack gap="12px" align="stretch">
                    <HStack justify="space-between">
                      <Text fontSize="13px" color={colors.text.muted} fontWeight={500}>Network</Text>
                      <Text fontSize="13px" fontWeight={600} color={colors.text.primary}>{chainConfig.name}</Text>
                    </HStack>
                    <HStack justify="space-between">
                      <Text fontSize="13px" color={colors.text.muted} fontWeight={500}>Privacy</Text>
                      <HStack gap="5px">
                        <LockIcon size={12} color={colors.accent.indigo} />
                        <Text fontSize="13px" fontWeight={600} color={colors.accent.indigo}>Stealth</Text>
                      </HStack>
                    </HStack>
                    <HStack justify="space-between">
                      <Text fontSize="13px" color={colors.text.muted} fontWeight={500}>Gas</Text>
                      <Text fontSize="13px" fontWeight={600} color={colors.text.primary}>Sponsored</Text>
                    </HStack>
                  </VStack>
                </Box>

                {/* Action buttons */}
                <HStack gap="10px">
                  <Box as="button" flex={1} p="14px"
                    bg={buttonVariants.secondary.bg} border={buttonVariants.secondary.border}
                    borderRadius={radius.full}
                    cursor="pointer" _hover={{ bg: buttonVariants.secondary.hover.bg }}
                    textAlign="center" transition={transitions.fast}
                    onClick={() => setSendStep("input")}>
                    <Text fontSize="14px" fontWeight={600} color={colors.text.primary}>Back</Text>
                  </Box>
                  <Box as="button" flex={2} p="14px"
                    bg={buttonVariants.primary.bg} boxShadow={buttonVariants.primary.boxShadow}
                    borderRadius={radius.full}
                    cursor="pointer" _hover={{ boxShadow: buttonVariants.primary.hover.boxShadow, transform: buttonVariants.primary.hover.transform }}
                    textAlign="center" transition={transitions.fast}
                    onClick={handleSend}
                    opacity={isLoading ? 0.7 : 1} pointerEvents={isLoading ? "none" : "auto"}>
                    {isLoading
                      ? <Spinner size="sm" color="#fff" />
                      : <HStack gap="8px" justify="center">
                          <SendIcon size={15} color="#fff" />
                          <Text fontSize="14px" fontWeight={700} color="#fff">Confirm Send</Text>
                        </HStack>
                    }
                  </Box>
                </HStack>
              </>
            )}

            {sendStep === "success" && (
              <Box position="relative" overflow="hidden" mx="-24px" mb="-24px" mt="-20px">
                {/* Confetti particles */}
                <Box position="absolute" inset="0" pointerEvents="none" overflow="hidden">
                  {[...Array(18)].map((_, i) => (
                    <Box
                      key={i}
                      position="absolute"
                      w={`${4 + Math.random() * 6}px`}
                      h={`${4 + Math.random() * 6}px`}
                      borderRadius={i % 3 === 0 ? "1px" : radius.full}
                      bgColor={["#2B5AE2", "#4A75F0", "#7C3AED", "#F59E0B", "#10B981", "#EC4899", "#06B6D4"][i % 7]}
                      left={`${5 + (i * 5.2) % 90}%`}
                      top="-10px"
                      opacity={0}
                      transform="rotate(0deg)"
                      animation={`confettiFall ${1.5 + Math.random() * 1.5}s ease-out ${0.1 + i * 0.06}s both`}
                    />
                  ))}
                </Box>

                <VStack gap="0" align="stretch" p="24px" pt="32px">
                  {/* Emoji burst */}
                  <Text
                    fontSize="52px"
                    textAlign="center"
                    lineHeight="1"
                    animation="successPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both"
                  >
                    🎉
                  </Text>

                  {/* Big amount — the hero */}
                  <VStack gap="4px" pt="20px" pb="6px" animation="successSlideUp 0.5s ease-out 0.15s both">
                    <Text
                      fontSize="44px"
                      fontWeight={800}
                      color={colors.text.primary}
                      textAlign="center"
                      letterSpacing="-0.04em"
                      lineHeight="1"
                    >
                      {amount} <Text as="span" fontSize="22px" fontWeight={600} color={colors.text.muted}>{chainConfig.nativeCurrency.symbol}</Text>
                    </Text>
                    <Text fontSize="15px" color={colors.text.muted} textAlign="center" fontWeight={500}>
                      sent to{" "}
                      <Text as="span" fontWeight={700} color={colors.text.primary}>
                        {recipient.includes(".tok") ? recipient : `${recipient.slice(0, 10)}...${recipient.slice(-4)}`}
                      </Text>
                    </Text>
                  </VStack>

                  {/* Privacy badge */}
                  <HStack
                    justify="center" pt="16px" pb="24px"
                    animation="successSlideUp 0.5s ease-out 0.25s both"
                  >
                    <HStack
                      gap="6px" px="14px" py="7px"
                      bgColor="rgba(43, 90, 226, 0.06)"
                      borderRadius={radius.full}
                    >
                      <LockIcon size={12} color={colors.accent.indigo} />
                      <Text fontSize="12px" fontWeight={600} color={colors.accent.indigo}>
                        Private &middot; Stealth &middot; Gas Free
                      </Text>
                    </HStack>
                  </HStack>

                  {/* Buttons */}
                  <VStack gap="10px" animation="successSlideUp 0.5s ease-out 0.35s both">
                    {sendTxHash && (
                      <a href={`${getExplorerBase(activeChainId)}/tx/${sendTxHash}`} target="_blank" rel="noopener noreferrer"
                        style={{ width: "100%" }}>
                        <HStack gap="8px" justify="center" w="100%" p="14px"
                          bgColor={colors.bg.input}
                          borderRadius={radius.full}
                          cursor="pointer"
                          _hover={{ bgColor: colors.bg.elevated }}
                          transition="all 0.15s ease">
                          <ArrowUpRightIcon size={14} color={colors.text.secondary} />
                          <Text fontSize="14px" fontWeight={600} color={colors.text.secondary}>View on Explorer</Text>
                        </HStack>
                      </a>
                    )}
                    <Box
                      as="button" w="100%" p="15px"
                      bg={buttonVariants.primary.bg}
                      boxShadow={buttonVariants.primary.boxShadow}
                      borderRadius={radius.full}
                      cursor="pointer"
                      _hover={{ boxShadow: buttonVariants.primary.hover.boxShadow, transform: buttonVariants.primary.hover.transform }}
                      onClick={handleClose}
                      textAlign="center"
                      transition={transitions.fast}
                    >
                      <Text fontSize="15px" fontWeight={700} color="#fff">Done</Text>
                    </Box>
                  </VStack>
                </VStack>

                <style>{`
                  @keyframes confettiFall {
                    0% { opacity: 1; transform: translateY(0) rotate(0deg); }
                    100% { opacity: 0; transform: translateY(340px) rotate(${360 + Math.random() * 360}deg); }
                  }
                  @keyframes successPop {
                    0% { opacity: 0; transform: scale(0.3); }
                    50% { opacity: 1; transform: scale(1.15); }
                    100% { opacity: 1; transform: scale(1); }
                  }
                  @keyframes successSlideUp {
                    from { opacity: 0; transform: translateY(16px); }
                    to { opacity: 1; transform: translateY(0); }
                  }
                `}</style>
              </Box>
            )}

            {sendError && (
              <HStack gap="6px" p="12px 14px" bgColor="rgba(229, 62, 62, 0.04)" borderRadius={radius.sm}>
                <AlertCircleIcon size={14} color={colors.accent.red} />
                <Text fontSize="12px" color={colors.accent.red}>{sendError}</Text>
              </HStack>
            )}
          </VStack>
        </Box>
      </Box>
    </Box>
  );
}
