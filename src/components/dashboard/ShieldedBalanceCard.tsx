"use client";

import { useState, useEffect } from "react";
import { Box, Text, VStack, HStack, Spinner, Input, Link } from "@chakra-ui/react";
import { colors, radius, shadows } from "@/lib/design/tokens";
import { ethers } from "ethers";
import type { StealthPayment } from "@/lib/design/types";

const EXPLORER_TX = "https://explorer.thanos-sepolia.tokamak.network/tx/";

interface ShieldedBalanceCardProps {
  isInitialized: boolean;
  isInitializing: boolean;
  initError: string | null;
  shieldedBalance: string;
  isShielding: boolean;
  shieldError: string | null;
  isUnshielding: boolean;
  unshieldError: string | null;
  unshieldProgress: number;
  payments: StealthPayment[];
  onInit: () => void;
  onShieldPayments: (payments: StealthPayment[]) => Promise<string | null>;
  onUnshield: (toAddress: string, amountWei: bigint) => Promise<string | null>;
}

type Mode = "idle" | "shield" | "unshield" | "success";

interface SuccessInfo {
  type: "shield" | "unshield";
  txHash: string;
  amount: string;
}

export function ShieldedBalanceCard({
  isInitialized,
  isInitializing,
  initError,
  shieldedBalance,
  isShielding,
  shieldError,
  isUnshielding,
  unshieldError,
  unshieldProgress,
  payments,
  onInit,
  onShieldPayments,
  onUnshield,
}: ShieldedBalanceCardProps) {
  const [mode, setMode] = useState<Mode>("idle");
  const [amount, setAmount] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [successInfo, setSuccessInfo] = useState<SuccessInfo | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);

  // Count shieldable payments (unclaimed, no key mismatch, has balance)
  const shieldablePayments = payments.filter(
    (p) => !p.claimed && !p.keyMismatch && parseFloat(p.originalAmount || p.balance || "0") > 0
  );
  const shieldableTotal = shieldablePayments.reduce(
    (sum, p) => sum + parseFloat(p.originalAmount || p.balance || "0"), 0
  );

  const handleShield = async () => {
    if (shieldablePayments.length === 0) return;
    const txHash = await onShieldPayments(shieldablePayments);
    if (txHash) {
      setSuccessInfo({ type: "shield", txHash, amount: shieldableTotal.toFixed(4) });
      setShowConfetti(true);
      setMode("success");
    }
  };

  const handleUnshield = async () => {
    if (!amount || !toAddress) return;
    try {
      const amountWei = ethers.utils.parseEther(amount);
      const txHash = await onUnshield(toAddress, BigInt(amountWei.toString()));
      if (txHash) {
        setSuccessInfo({ type: "unshield", txHash, amount });
        setShowConfetti(true);
        setMode("success");
        setAmount("");
        setToAddress("");
      }
    } catch {
      // Error set by hook
    }
  };

  useEffect(() => {
    if (showConfetti) {
      const timer = setTimeout(() => setShowConfetti(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [showConfetti]);

  function formatError(error: string): string {
    if (error.includes('INSUFFICIENT_FUNDS') || error.includes('insufficient funds')) {
      return 'Insufficient TON. The sponsor wallet may need funding.';
    }
    if (error.includes('user rejected') || error.includes('ACTION_REJECTED')) {
      return 'Transaction rejected.';
    }
    if (error.length > 150) return error.slice(0, 150) + '...';
    return error;
  }

  // Not initialized — show setup button
  if (!isInitialized) {
    return (
      <Box p="3px" borderRadius={radius.lg} bg="linear-gradient(135deg, #1a8a4a 0%, #2ecc71 50%, #1a8a4a 100%)" boxShadow={shadows.card}>
        <Box p="28px" bgColor={colors.bg.card} borderRadius="17px">
          <VStack gap="16px" align="stretch">
            <HStack gap="8px" align="center">
              <ShieldIcon />
              <Text fontSize="17px" fontWeight={700} color={colors.text.primary}>Privacy Pool</Text>
            </HStack>
            <Text fontSize="14px" color={colors.text.muted}>
              Shield claimed TON into the privacy pool to break the withdrawal link. Unshield to any fresh address with zero connection to the original payment.
            </Text>
            <Box
              as="button"
              p="14px"
              bgColor="#1a8a4a"
              borderRadius={radius.md}
              cursor="pointer"
              _hover={{ opacity: 0.9 }}
              transition="all 0.15s ease"
              onClick={onInit}
              textAlign="center"
            >
              {isInitializing ? (
                <HStack gap="8px" justify="center">
                  <Spinner size="sm" color="#fff" />
                  <Text fontSize="15px" fontWeight={700} color="#fff">Setting up...</Text>
                </HStack>
              ) : (
                <Text fontSize="15px" fontWeight={700} color="#fff">Activate Privacy Pool</Text>
              )}
            </Box>
            {initError && (
              <Text fontSize="13px" color="#e74c3c" wordBreak="break-word">{initError}</Text>
            )}
          </VStack>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      p="3px" borderRadius={radius.lg}
      bg="linear-gradient(135deg, #1a8a4a 0%, #2ecc71 50%, #1a8a4a 100%)"
      boxShadow={shadows.card}
      position="relative"
      overflow="hidden"
    >
      {/* Confetti particles */}
      {showConfetti && <ConfettiOverlay />}

      <Box p="28px" bgColor={colors.bg.card} borderRadius="17px" position="relative" zIndex={1}>
        <VStack gap="20px" align="stretch">
          {/* Header */}
          <HStack justify="space-between" align="center">
            <HStack gap="8px" align="center">
              <ShieldIcon />
              <Text fontSize="17px" fontWeight={700} color={colors.text.primary}>Shielded Balance</Text>
            </HStack>
          </HStack>

          {/* Balance */}
          <VStack gap="4px" align="flex-start">
            <HStack align="baseline" gap="8px">
              <Text fontSize="32px" fontWeight={800} color={colors.text.primary} lineHeight="1" letterSpacing="-0.03em">
                {shieldedBalance}
              </Text>
              <Text fontSize="16px" fontWeight={500} color={colors.text.muted}>TON</Text>
            </HStack>
            {shieldableTotal > 0 && (
              <Text fontSize="13px" color={colors.text.muted}>
                {shieldableTotal.toFixed(4)} TON available to shield from {shieldablePayments.length} stealth wallet{shieldablePayments.length !== 1 ? 's' : ''}
              </Text>
            )}
          </VStack>

          {/* Success state */}
          {mode === "success" && successInfo && (
            <Box
              p="20px"
              bgColor="rgba(26, 138, 74, 0.06)"
              borderRadius={radius.md}
              border="1px solid rgba(26, 138, 74, 0.15)"
              css={{
                animation: "fadeSlideIn 0.4s ease-out",
                "@keyframes fadeSlideIn": {
                  "0%": { opacity: 0, transform: "translateY(8px)" },
                  "100%": { opacity: 1, transform: "translateY(0)" },
                },
              }}
            >
              <VStack gap="14px" align="stretch">
                <HStack gap="10px" justify="center">
                  <Box
                    w="36px" h="36px" borderRadius="50%"
                    bg="linear-gradient(135deg, #1a8a4a, #2ecc71)"
                    display="flex" alignItems="center" justifyContent="center"
                    css={{
                      animation: "scaleIn 0.5s ease-out",
                      "@keyframes scaleIn": {
                        "0%": { transform: "scale(0)" },
                        "60%": { transform: "scale(1.2)" },
                        "100%": { transform: "scale(1)" },
                      },
                    }}
                  >
                    <CheckIcon />
                  </Box>
                  <VStack gap="2px" align="flex-start">
                    <Text fontSize="16px" fontWeight={700} color={colors.text.primary}>
                      {successInfo.type === "shield" ? "Successfully Shielded" : "Successfully Withdrawn"}
                    </Text>
                    <Text fontSize="14px" color="#1a8a4a" fontWeight={600}>
                      {successInfo.amount} TON
                    </Text>
                  </VStack>
                </HStack>

                {/* Full tx hash with link */}
                <Link
                  href={`${EXPLORER_TX}${successInfo.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  p="10px 14px"
                  bgColor={colors.bg.input}
                  borderRadius={radius.sm}
                  display="block"
                  _hover={{ opacity: 0.8, textDecoration: 'none' }}
                  transition="opacity 0.15s ease"
                >
                  <VStack gap="4px" align="stretch">
                    <HStack justify="space-between">
                      <Text fontSize="11px" fontWeight={600} color={colors.text.muted} textTransform="uppercase" letterSpacing="0.05em">
                        Transaction Hash
                      </Text>
                      <ExternalLinkIcon />
                    </HStack>
                    <Text
                      fontSize="12px" color={colors.text.primary}
                      fontFamily="'JetBrains Mono', monospace"
                      wordBreak="break-all" lineHeight="1.5"
                    >
                      {successInfo.txHash}
                    </Text>
                  </VStack>
                </Link>

                <Box
                  as="button"
                  p="10px"
                  bgColor="#1a8a4a"
                  borderRadius={radius.md}
                  cursor="pointer"
                  _hover={{ opacity: 0.9 }}
                  transition="all 0.15s ease"
                  onClick={() => { setMode("idle"); setSuccessInfo(null); }}
                  textAlign="center"
                >
                  <Text fontSize="14px" fontWeight={700} color="#fff">Done</Text>
                </Box>
              </VStack>
            </Box>
          )}

          {/* Action buttons */}
          {mode === "idle" && (
            <VStack gap="12px" align="stretch">
              <HStack gap="10px">
                <Box
                  as="button" flex={1} p="12px" bgColor="#1a8a4a" borderRadius={radius.md}
                  cursor="pointer" _hover={{ opacity: 0.9 }} transition="all 0.15s ease"
                  onClick={() => setMode("shield")} textAlign="center"
                  opacity={shieldablePayments.length === 0 ? 0.5 : 1}
                >
                  <Text fontSize="14px" fontWeight={700} color="#fff">
                    Shield {shieldableTotal > 0 ? `(${shieldableTotal.toFixed(4)} TON)` : ''}
                  </Text>
                </Box>
                <Box
                  as="button" flex={1} p="12px" bgColor={colors.bg.card}
                  borderRadius={radius.md} border={`2px solid #1a8a4a`}
                  cursor="pointer" _hover={{ borderColor: "#2ecc71" }} transition="all 0.15s ease"
                  onClick={() => setMode("unshield")} textAlign="center"
                >
                  <Text fontSize="14px" fontWeight={700} color="#1a8a4a">Withdraw</Text>
                </Box>
              </HStack>
              <Box p="12px 14px" bgColor={colors.bg.input} borderRadius={radius.sm}>
                <VStack gap="8px" align="stretch">
                  <HStack gap="6px" align="flex-start">
                    <Text fontSize="12px" color="#1a8a4a" fontWeight={700} flexShrink={0}>Shield</Text>
                    <Text fontSize="12px" color={colors.text.muted}>
                      Moves TON from your stealth wallets into the privacy pool. The sponsor handles gas — no funds needed in your main wallet.
                    </Text>
                  </HStack>
                  <HStack gap="6px" align="flex-start">
                    <Text fontSize="12px" color="#1a8a4a" fontWeight={700} flexShrink={0}>Withdraw</Text>
                    <Text fontSize="12px" color={colors.text.muted}>
                      Unshield TON to any fresh address. A ZK proof ensures no one can connect the withdrawal to your deposit.
                    </Text>
                  </HStack>
                </VStack>
              </Box>
            </VStack>
          )}

          {/* Shield confirmation */}
          {mode === "shield" && (
            <VStack gap="12px" align="stretch">
              <Text fontSize="13px" color={colors.text.muted}>
                Shield {shieldablePayments.length} stealth payment{shieldablePayments.length !== 1 ? 's' : ''} ({shieldableTotal.toFixed(4)} TON) into the privacy pool. Gas is sponsored.
              </Text>
              {shieldablePayments.map((p, i) => (
                <HStack key={i} p="10px 14px" bgColor={colors.bg.input} borderRadius={radius.sm} justify="space-between">
                  <Text fontSize="12px" color={colors.text.muted} fontFamily="'JetBrains Mono', monospace">
                    {p.announcement.stealthAddress.slice(0, 10)}...{p.announcement.stealthAddress.slice(-6)}
                  </Text>
                  <Text fontSize="12px" fontWeight={600} color={colors.text.primary}>
                    {parseFloat(p.originalAmount || p.balance || '0').toFixed(4)} TON
                  </Text>
                </HStack>
              ))}
              <HStack gap="10px">
                <Box
                  as="button" flex={1} p="12px" bgColor="#1a8a4a" borderRadius={radius.md}
                  cursor="pointer" _hover={{ opacity: 0.9 }} transition="all 0.15s ease"
                  onClick={handleShield} textAlign="center" opacity={isShielding ? 0.7 : 1}
                >
                  {isShielding ? (
                    <HStack gap="6px" justify="center">
                      <Spinner size="xs" color="#fff" />
                      <Text fontSize="14px" fontWeight={700} color="#fff">Shielding...</Text>
                    </HStack>
                  ) : (
                    <Text fontSize="14px" fontWeight={700} color="#fff">Confirm Shield</Text>
                  )}
                </Box>
                <Box
                  as="button" p="12px 20px" bgColor={colors.bg.input} borderRadius={radius.md}
                  cursor="pointer" onClick={() => setMode("idle")} textAlign="center"
                >
                  <Text fontSize="14px" fontWeight={600} color={colors.text.muted}>Cancel</Text>
                </Box>
              </HStack>
              {shieldError && <Text fontSize="13px" color="#e74c3c">{formatError(shieldError)}</Text>}
            </VStack>
          )}

          {/* Unshield form */}
          {mode === "unshield" && (
            <VStack gap="12px" align="stretch">
              <Text fontSize="13px" color={colors.text.muted}>
                Withdraw to a fresh address with no connection to your original wallet. A ZK proof is generated in your browser (~20-30s).
              </Text>
              <Input
                placeholder="Destination address (0x...)"
                value={toAddress}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToAddress(e.target.value)}
                bgColor={colors.bg.input}
                borderColor={colors.border.default}
                color={colors.text.primary}
                _placeholder={{ color: colors.text.muted }}
                fontSize="15px"
                p="12px 16px"
                borderRadius={radius.md}
              />
              <Input
                placeholder="Amount (TON)"
                value={amount}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
                bgColor={colors.bg.input}
                borderColor={colors.border.default}
                color={colors.text.primary}
                _placeholder={{ color: colors.text.muted }}
                fontSize="15px"
                p="12px 16px"
                borderRadius={radius.md}
              />
              {isUnshielding && unshieldProgress > 0 && (
                <Box>
                  <Text fontSize="13px" color={colors.text.muted} mb="6px">
                    Generating ZK proof... {Math.round(unshieldProgress * 100)}%
                  </Text>
                  <Box h="4px" bgColor={colors.bg.input} borderRadius="2px" overflow="hidden">
                    <Box h="100%" w={`${unshieldProgress * 100}%`} bgColor="#1a8a4a" transition="width 0.3s ease" />
                  </Box>
                </Box>
              )}
              <HStack gap="10px">
                <Box
                  as="button" flex={1} p="12px" bgColor="#1a8a4a" borderRadius={radius.md}
                  cursor="pointer" _hover={{ opacity: 0.9 }} transition="all 0.15s ease"
                  onClick={handleUnshield} textAlign="center" opacity={isUnshielding ? 0.7 : 1}
                >
                  {isUnshielding ? (
                    <HStack gap="6px" justify="center">
                      <Spinner size="xs" color="#fff" />
                      <Text fontSize="14px" fontWeight={700} color="#fff">Withdrawing...</Text>
                    </HStack>
                  ) : (
                    <Text fontSize="14px" fontWeight={700} color="#fff">Confirm Withdraw</Text>
                  )}
                </Box>
                <Box
                  as="button" p="12px 20px" bgColor={colors.bg.input} borderRadius={radius.md}
                  cursor="pointer" onClick={() => { setMode("idle"); setAmount(""); setToAddress(""); }} textAlign="center"
                >
                  <Text fontSize="14px" fontWeight={600} color={colors.text.muted}>Cancel</Text>
                </Box>
              </HStack>
              {unshieldError && <Text fontSize="13px" color="#e74c3c">{formatError(unshieldError)}</Text>}
            </VStack>
          )}

          {/* Footer */}
          {mode !== "success" && (
            <Box p="10px 14px" bgColor="rgba(26, 138, 74, 0.04)" borderRadius={radius.sm} textAlign="center">
              <Text fontSize="13px" color="#1a8a4a" fontWeight={600}>
                ZK-shielded — no link between deposit and withdrawal
              </Text>
            </Box>
          )}
        </VStack>
      </Box>
    </Box>
  );
}

function ShieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1a8a4a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={colors.text.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function ConfettiOverlay() {
  const particles = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    delay: `${Math.random() * 0.5}s`,
    duration: `${1.5 + Math.random() * 1.5}s`,
    color: ['#1a8a4a', '#2ecc71', '#27ae60', '#a8e6cf', '#fff'][Math.floor(Math.random() * 5)],
    size: 4 + Math.random() * 4,
  }));

  return (
    <Box
      position="absolute" inset="0" zIndex={2}
      pointerEvents="none" overflow="hidden"
      borderRadius={radius.lg}
    >
      <style>{`
        @keyframes confettiFall {
          0% { transform: translateY(-10px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(400px) rotate(720deg); opacity: 0; }
        }
      `}</style>
      {particles.map((p) => (
        <Box
          key={p.id}
          position="absolute"
          top="-8px"
          left={p.left}
          w={`${p.size}px`}
          h={`${p.size}px`}
          bgColor={p.color}
          borderRadius={p.size > 6 ? "1px" : "50%"}
          css={{
            animation: `confettiFall ${p.duration} ease-out ${p.delay} forwards`,
          }}
        />
      ))}
    </Box>
  );
}
