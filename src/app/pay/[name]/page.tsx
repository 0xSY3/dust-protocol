"use client";

import { useState, useEffect, useCallback, ChangeEvent } from "react";
import { Box, Text, VStack, HStack, Input, Spinner } from "@chakra-ui/react";
import { useAccount, useConnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { colors, radius, glass, shadows, buttonVariants, inputStates, transitions, typography, getExplorerBase } from "@/lib/design/tokens";
import { useStealthSend, useStealthName } from "@/hooks/stealth";
import { NAME_SUFFIX } from "@/lib/stealth";
import { getChainConfig, DEFAULT_CHAIN_ID } from "@/config/chains";
import Link from "next/link";
import { NoOptInPayment } from "@/components/pay/NoOptInPayment";
import {
  ShieldIcon, AlertCircleIcon, ArrowUpRightIcon, LockIcon,
  WalletIcon, SendIcon, CopyIcon,
} from "@/components/stealth/icons";
import { DustLogo } from "@/components/DustLogo";

// CSS animations
const animations = `
@keyframes dust-success-scale {
  0% { transform: scale(0.6); opacity: 0; }
  50% { transform: scale(1.05); }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes dust-check-draw {
  0% { stroke-dashoffset: 24; }
  100% { stroke-dashoffset: 0; }
}
@keyframes dust-fade-up {
  0% { transform: translateY(12px); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
}
@keyframes dust-confetti {
  0% { transform: translateY(0) rotate(0deg); opacity: 1; }
  100% { transform: translateY(-80px) rotate(360deg); opacity: 0; }
}
@keyframes dust-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
@keyframes dust-ring-expand {
  0% { transform: scale(0.8); opacity: 0.6; }
  100% { transform: scale(2.5); opacity: 0; }
}
`;

export default function PayPage({ params }: { params: { name: string } }) {
  const { name } = params;
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const { resolveName, formatName, isConfigured } = useStealthName();
  // Pay pages use the default chain (Thanos Sepolia) since senders don't have chain context
  const chainId = DEFAULT_CHAIN_ID;
  const chainConfig = getChainConfig(chainId);
  const { generateAddressFor, sendEthToStealth, isLoading, error: sendError } = useStealthSend(chainId);

  const [activeTab, setActiveTab] = useState<"wallet" | "qr">("wallet");
  const [resolvedMeta, setResolvedMeta] = useState<string | null>(null);
  const [metaResolving, setMetaResolving] = useState(false);
  const [amount, setAmount] = useState("");
  const [sendStep, setSendStep] = useState<"input" | "confirm" | "success">("input");
  const [sendTxHash, setSendTxHash] = useState<string | null>(null);

  const fullName = formatName(name);

  // Eagerly resolve meta-address on mount (wallet flow is primary now)
  const doResolve = useCallback(async () => {
    if (resolvedMeta || metaResolving || !isConfigured) return;
    setMetaResolving(true);
    const resolved = await resolveName(name + NAME_SUFFIX);
    if (resolved) {
      setResolvedMeta(`st:eth:${resolved}`);
    } else {
      const resolved2 = await resolveName(name);
      if (resolved2) setResolvedMeta(`st:thanos:${resolved2}`);
    }
    setMetaResolving(false);
  }, [resolvedMeta, metaResolving, isConfigured, name, resolveName]);

  useEffect(() => { doResolve(); }, [doResolve]);

  const handlePreview = () => {
    if (!resolvedMeta || !amount) return;
    if (generateAddressFor(resolvedMeta)) setSendStep("confirm");
  };

  const handleSend = async () => {
    if (!resolvedMeta) return;
    const hash = await sendEthToStealth(resolvedMeta, amount);
    if (hash) { setSendTxHash(hash); setSendStep("success"); }
  };

  const isSuccess = sendStep === "success";

  return (
    <Box minH="100vh" bg={colors.bg.page} color={colors.text.primary} display="flex" flexDirection="column">
      <style>{animations}</style>

      {/* Header */}
      <Box as="header" borderBottom={`1px solid ${colors.border.default}`} bg={glass.modal.bg}
        backdropFilter={glass.modal.backdropFilter} boxShadow={shadows.card}
        px="24px" py="16px" position="sticky" top={0} zIndex={10}>
        <HStack justify="space-between" align="center" maxW="600px" mx="auto">
          <Link href="/" style={{ textDecoration: "none" }}>
            <HStack gap="8px" align="center" _hover={{ opacity: 0.8 }} transition={transitions.fast} cursor="pointer">
              <DustLogo size={24} color={colors.accent.indigo} />
              <Text fontSize="20px" fontWeight={800} color={colors.text.primary}
                fontFamily={typography.fontFamily.heading} letterSpacing="-0.03em">
                Dust
              </Text>
            </HStack>
          </Link>
          <Box px="12px" py="5px" bgColor="rgba(74,117,240,0.12)" border="1px solid rgba(74,117,240,0.2)"
            borderRadius={radius.full}>
            <Text fontSize="11px" color={colors.accent.indigoBright} fontWeight={600} letterSpacing="0.02em"
              fontFamily={typography.fontFamily.heading}>Payment</Text>
          </Box>
        </HStack>
      </Box>

      {/* Content */}
      <Box flex="1" display="flex" justifyContent="center" py={{ base: "24px", md: "48px" }} px="16px">
        <Box w="100%" maxW="460px">
          <VStack gap="16px">
            {/* Main payment card */}
            <Box w="100%" position="relative">
              {/* Gradient border effect */}
              <Box position="absolute" inset="-2px" borderRadius="26px" bg="linear-gradient(135deg, #2B5AE2, #7C3AED, #2B5AE2)"
                opacity={isSuccess ? 0.8 : 0.15} transition="opacity 0.6s ease" />

              <Box bg={colors.bg.cardSolid} borderRadius={radius.xl} overflow="hidden" w="100%" position="relative"
                boxShadow={shadows.card}>

                {/* Recipient header */}
                <Box p="28px 24px 24px" textAlign="center"
                  bg={isSuccess
                    ? "linear-gradient(180deg, rgba(34, 197, 94, 0.06) 0%, transparent 100%)"
                    : "linear-gradient(180deg, rgba(43, 90, 226, 0.04) 0%, transparent 100%)"
                  }
                  borderBottom={isSuccess ? "none" : `1px solid ${colors.border.default}`}
                  transition="background 0.4s ease"
                >
                  <VStack gap="10px">
                    <Box p="14px" bgColor={isSuccess ? "rgba(34, 197, 94, 0.1)" : "rgba(43, 90, 226, 0.08)"}
                      borderRadius="50%" transition="background-color 0.4s ease" position="relative">
                      {isSuccess && (
                        <Box position="absolute" inset={0} borderRadius="50%" border="2px solid rgba(34, 197, 94, 0.3)"
                          animation="dust-ring-expand 1s ease-out forwards" />
                      )}
                      <ShieldIcon size={26} color={isSuccess ? "#22C55E" : colors.accent.indigo} />
                    </Box>
                    <Text fontSize="22px" fontWeight={700}
                      color={isSuccess ? "#22C55E" : colors.accent.indigoBright}
                      transition="color 0.3s ease"
                    >
                      {fullName}
                    </Text>
                    <Text fontSize="13px" color={colors.text.muted}>
                      {isSuccess ? "Private payment completed" : "Send a private payment"}
                    </Text>
                  </VStack>
                </Box>

                {/* Tab switcher — hidden on success */}
                {!isSuccess && (
                  <HStack gap={0} borderBottom={`1px solid ${colors.border.default}`}>
                    <Box
                      as="button" flex={1} py="14px" textAlign="center" cursor="pointer"
                      borderBottom={activeTab === "wallet" ? "2px solid #2B5AE2" : "2px solid transparent"}
                      transition="all 0.2s ease"
                      onClick={() => setActiveTab("wallet")}
                    >
                      <HStack gap="6px" justify="center">
                        <WalletIcon size={14} color={activeTab === "wallet" ? colors.accent.indigo : colors.text.muted} />
                        <Text fontSize="13px" fontWeight={activeTab === "wallet" ? 700 : 500}
                          color={activeTab === "wallet" ? colors.accent.indigo : colors.text.muted}
                          transition="color 0.2s ease"
                        >
                          Send with Wallet
                        </Text>
                      </HStack>
                    </Box>
                    <Box
                      as="button" flex={1} py="14px" textAlign="center" cursor="pointer"
                      borderBottom={activeTab === "qr" ? "2px solid #2B5AE2" : "2px solid transparent"}
                      transition="all 0.2s ease"
                      onClick={() => setActiveTab("qr")}
                    >
                      <HStack gap="6px" justify="center">
                        <CopyIcon size={14} color={activeTab === "qr" ? colors.accent.indigo : colors.text.muted} />
                        <Text fontSize="13px" fontWeight={activeTab === "qr" ? 700 : 500}
                          color={activeTab === "qr" ? colors.accent.indigo : colors.text.muted}
                          transition="color 0.2s ease"
                        >
                          QR / Address
                        </Text>
                      </HStack>
                    </Box>
                  </HStack>
                )}

                {/* Tab content */}
                <Box p="24px">
                  {isSuccess ? (
                    /* ====== SUCCESS STATE ====== */
                    <VStack gap="20px" py="8px">
                      {/* Confetti particles */}
                      <Box position="relative" w="80px" h="80px">
                        {[
                          { color: "#2B5AE2", x: -20, y: -10, delay: "0s", size: 6 },
                          { color: "#7C3AED", x: 25, y: -15, delay: "0.1s", size: 5 },
                          { color: "#22C55E", x: -30, y: 5, delay: "0.2s", size: 7 },
                          { color: "#D97706", x: 30, y: 0, delay: "0.15s", size: 4 },
                          { color: "#E53E3E", x: -10, y: -25, delay: "0.25s", size: 5 },
                          { color: "#0891B2", x: 15, y: -20, delay: "0.05s", size: 6 },
                        ].map((p, i) => (
                          <Box key={i} position="absolute" left={`calc(50% + ${p.x}px)`} top={`calc(50% + ${p.y}px)`}
                            w={`${p.size}px`} h={`${p.size}px`} borderRadius="50%" bgColor={p.color}
                            animation={`dust-confetti 1.2s ease-out ${p.delay} forwards`} />
                        ))}

                        {/* Check circle */}
                        <Box position="absolute" inset={0} display="flex" alignItems="center" justifyContent="center"
                          animation="dust-success-scale 0.5s ease-out forwards">
                          <Box w="72px" h="72px" borderRadius="50%"
                            bg="linear-gradient(135deg, #22C55E, #16A34A)" display="flex"
                            alignItems="center" justifyContent="center"
                            boxShadow="0 8px 24px rgba(34, 197, 94, 0.3)">
                            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 6L9 17l-5-5" stroke="white" strokeWidth="2.5"
                                strokeDasharray="24" strokeDashoffset="24"
                                style={{ animation: "dust-check-draw 0.4s ease-out 0.3s forwards" }} />
                            </svg>
                          </Box>
                        </Box>
                      </Box>

                      <VStack gap="6px" animation="dust-fade-up 0.4s ease-out 0.2s both">
                        <Text fontSize="22px" fontWeight={700} color={colors.text.primary}>
                          Payment Sent!
                        </Text>
                        <HStack gap="6px">
                          <Text fontSize="28px" fontWeight={700} color={colors.text.primary}
                            fontFamily="'JetBrains Mono', monospace">
                            {amount}
                          </Text>
                          <Text fontSize="16px" fontWeight={500} color={colors.text.muted} mt="6px">{chainConfig.nativeCurrency.symbol}</Text>
                        </HStack>
                        <Text fontSize="14px" color={colors.text.muted}>
                          sent to <Text as="span" color={colors.accent.indigoBright} fontWeight={600}>{fullName}</Text>
                        </Text>
                      </VStack>

                      {/* Explorer link */}
                      {sendTxHash && (
                        <Box animation="dust-fade-up 0.4s ease-out 0.5s both">
                          <a href={`${getExplorerBase(chainId)}/tx/${sendTxHash}`} target="_blank" rel="noopener noreferrer">
                            <HStack gap="6px" px="16px" py="10px" bgColor={colors.bg.input} borderRadius={radius.sm}
                              border={`1px solid ${colors.border.default}`}
                              _hover={{ bgColor: colors.bg.elevated }} transition="background-color 0.15s" cursor="pointer">
                              <ArrowUpRightIcon size={13} color={colors.accent.indigo} />
                              <Text fontSize="13px" color={colors.accent.indigo} fontWeight={500}>View on Explorer</Text>
                            </HStack>
                          </a>
                        </Box>
                      )}

                      {/* Send another */}
                      <Text fontSize="13px" color={colors.text.muted} cursor="pointer"
                        _hover={{ color: colors.accent.indigo }} transition="color 0.15s"
                        animation="dust-fade-up 0.4s ease-out 0.6s both"
                        onClick={() => { setSendStep("input"); setAmount(""); setSendTxHash(null); }}>
                        Send another payment
                      </Text>
                    </VStack>
                  ) : activeTab === "wallet" ? (
                    /* ====== WALLET TAB ====== */
                    <>
                      {metaResolving ? (
                        <VStack gap="12px" py="24px">
                          <Spinner size="md" color={colors.accent.indigo} />
                          <Text fontSize="13px" color={colors.text.muted}>Preparing payment...</Text>
                        </VStack>
                      ) : !isConnected ? (
                        <VStack gap="20px" py="16px">
                          <VStack gap="6px">
                            <Text fontSize="15px" fontWeight={600} color={colors.text.primary}>
                              Connect to send
                            </Text>
                            <Text fontSize="13px" color={colors.text.muted} textAlign="center">
                              Connect your wallet to send a private payment
                            </Text>
                          </VStack>
                          <Box
                            as="button" w="100%" p="14px"
                            bg={buttonVariants.primary.bg}
                            borderRadius={radius.sm} cursor="pointer"
                            boxShadow={buttonVariants.primary.boxShadow}
                            _hover={{ boxShadow: buttonVariants.primary.hover.boxShadow, transform: buttonVariants.primary.hover.transform }}
                            _active={{ transform: buttonVariants.primary.active.transform }}
                            transition={transitions.fast}
                            onClick={() => connect({ connector: injected() })}
                          >
                            <HStack gap="8px" justify="center">
                              <WalletIcon size={16} color="white" />
                              <Text fontSize="14px" color="white" fontWeight={600}>Connect Wallet</Text>
                            </HStack>
                          </Box>
                          <Text fontSize="11px" color={colors.text.muted} textAlign="center">
                            Or switch to <Text as="span" color={colors.accent.indigo} cursor="pointer"
                            fontWeight={500} onClick={() => setActiveTab("qr")}>QR / Address</Text> to send from any wallet
                          </Text>
                        </VStack>
                      ) : sendStep === "input" ? (
                        <VStack gap="18px" align="stretch">
                          <Box>
                            <Text fontSize="12px" color={colors.text.tertiary} mb="8px" fontWeight={600}
                              letterSpacing="0.04em" textTransform="uppercase">Amount</Text>
                            <Box position="relative">
                              <Input placeholder="0.0" type="number" step="0.001" value={amount}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
                                h="64px" bgColor={colors.bg.input} border={`1.5px solid ${colors.border.default}`}
                                borderRadius={radius.md} color={colors.text.primary} fontSize="28px" fontWeight={600}
                                fontFamily="'JetBrains Mono', monospace" px="16px" pr="60px"
                                _placeholder={{ color: colors.text.muted, fontSize: "24px" }}
                                _focus={{ borderColor: colors.accent.indigo, boxShadow: colors.glow.indigo }} />
                              <Text position="absolute" right="16px" top="50%" transform="translateY(-50%)"
                                fontSize="14px" fontWeight={600} color={colors.text.muted}>
                                {chainConfig.nativeCurrency.symbol}
                              </Text>
                            </Box>
                            <Text fontSize="11px" color={colors.text.muted} mt="6px">on {chainConfig.name}</Text>
                          </Box>

                          <Box as="button" w="100%" h="52px"
                            bg={amount ? buttonVariants.primary.bg : colors.bg.elevated}
                            borderRadius={radius.md} display="flex" alignItems="center" justifyContent="center" gap="8px"
                            cursor={amount && resolvedMeta ? "pointer" : "not-allowed"}
                            opacity={amount && resolvedMeta && !isLoading ? 1 : 0.5}
                            boxShadow={amount ? buttonVariants.primary.boxShadow : "none"}
                            _hover={amount && resolvedMeta ? { boxShadow: buttonVariants.primary.hover.boxShadow, transform: buttonVariants.primary.hover.transform } : {}}
                            transition={transitions.fast}
                            onClick={handlePreview}
                          >
                            <Text fontSize="15px" fontWeight={600} color={amount ? "white" : colors.text.muted}>
                              Preview Payment
                            </Text>
                          </Box>
                        </VStack>
                      ) : (
                        /* Confirm state */
                        <VStack gap="16px" align="stretch">
                          <Box p="20px" bgColor={colors.bg.input} borderRadius={radius.md}
                            border={`1px solid ${colors.border.default}`}>
                            <VStack gap="16px" align="stretch">
                              <HStack justify="space-between">
                                <Text fontSize="13px" color={colors.text.muted}>Amount</Text>
                                <Text fontSize="20px" fontWeight={700} color={colors.text.primary}
                                  fontFamily="'JetBrains Mono', monospace">{amount} {chainConfig.nativeCurrency.symbol}</Text>
                              </HStack>
                              <Box h="1px" bgColor={colors.border.default} />
                              <HStack justify="space-between">
                                <Text fontSize="13px" color={colors.text.muted}>To</Text>
                                <Text fontSize="16px" fontWeight={600} color={colors.accent.indigoBright}>{fullName}</Text>
                              </HStack>
                              <Box h="1px" bgColor={colors.border.default} />
                              <HStack justify="space-between">
                                <Text fontSize="13px" color={colors.text.muted}>Network fee</Text>
                                <Text fontSize="13px" fontWeight={600} color="#22C55E">Free (sponsored)</Text>
                              </HStack>
                            </VStack>
                          </Box>

                          <HStack gap="8px" p="12px 14px" bgColor="rgba(43, 90, 226, 0.04)" borderRadius={radius.sm}
                            border="1px solid rgba(43, 90, 226, 0.1)">
                            <LockIcon size={14} color={colors.accent.indigo} />
                            <Text fontSize="12px" color={colors.text.tertiary}>
                              This payment uses a stealth address. It cannot be linked to {fullName}.
                            </Text>
                          </HStack>

                          <HStack gap="10px">
                            <Box as="button" flex={1} h="48px" bg={buttonVariants.secondary.bg} borderRadius={radius.sm}
                              border={buttonVariants.secondary.border} display="flex" alignItems="center"
                              justifyContent="center" cursor="pointer"
                              _hover={{ bg: buttonVariants.secondary.hover.bg, borderColor: buttonVariants.secondary.hover.borderColor }}
                              transition={transitions.fast}
                              onClick={() => setSendStep("input")}>
                              <Text fontSize="14px" fontWeight={500} color={colors.text.secondary}>Back</Text>
                            </Box>
                            <Box as="button" flex={2} h="48px"
                              bg={buttonVariants.primary.bg}
                              borderRadius={radius.sm} display="flex" alignItems="center" justifyContent="center" gap="8px"
                              cursor={isLoading ? "wait" : "pointer"}
                              boxShadow={buttonVariants.primary.boxShadow}
                              _hover={{ boxShadow: buttonVariants.primary.hover.boxShadow, transform: buttonVariants.primary.hover.transform }}
                              transition={transitions.fast}
                              onClick={handleSend}>
                              {isLoading ? (
                                <Spinner size="sm" color="white" />
                              ) : (
                                <>
                                  <SendIcon size={15} color="white" />
                                  <Text fontSize="14px" fontWeight={600} color="white">Send Payment</Text>
                                </>
                              )}
                            </Box>
                          </HStack>
                        </VStack>
                      )}

                      {sendError && (
                        <HStack gap="6px" p="12px 14px" bg={buttonVariants.danger.bg} border={buttonVariants.danger.border} borderRadius={radius.xs} mt="12px">
                          <AlertCircleIcon size={14} color={colors.accent.red} />
                          <Text fontSize="12px" color={colors.accent.red}>{sendError}</Text>
                        </HStack>
                      )}
                    </>
                  ) : (
                    /* ====== QR TAB ====== */
                    <NoOptInPayment
                      recipientName={name}
                      displayName={fullName}
                    />
                  )}
                </Box>
              </Box>
            </Box>

            {/* Pay someone else */}
            <HStack justify="center" pt="4px">
              <Link href="/" style={{ textDecoration: "none" }}>
                <Text fontSize="13px" color={colors.text.muted} fontWeight={500}
                  _hover={{ color: colors.accent.indigo }} transition="color 0.15s" cursor="pointer">
                  Pay someone else
                </Text>
              </Link>
            </HStack>
          </VStack>
        </Box>
      </Box>
    </Box>
  );
}
