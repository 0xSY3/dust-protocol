"use client";

import { useRouter } from "next/navigation";
import { Box, Text, VStack, HStack, Spinner } from "@chakra-ui/react";
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { usePaymentLinks } from "@/hooks/stealth/usePaymentLinks";
import { useStealthScanner } from "@/hooks/stealth";
import { colors, radius, shadows, getExplorerBase } from "@/lib/design/tokens";
import {
  ArrowLeftIcon, MoreHorizontalIcon, LinkIcon, CopyIcon, CheckIcon,
  QRIcon, ActivityIcon, TrashIcon,
  ArrowDownLeftIcon, ArrowUpRightIcon, ChainIcon,
} from "@/components/stealth/icons";
import { QRModal } from "@/components/links/QRModal";

export default function LinkDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const { ownedNames, stealthKeys, activeChainId } = useAuth();
  const { getLink, deleteLink } = usePaymentLinks();
  const { payments, scanInBackground, stopBackgroundScan, isScanning } = useStealthScanner(stealthKeys);
  const [copied, setCopied] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showQR, setShowQR] = useState(false);

  const link = getLink(id);
  const username = ownedNames[0]?.name || "";

  useEffect(() => {
    if (stealthKeys) {
      scanInBackground();
      return () => stopBackgroundScan();
    }
  }, [stealthKeys, scanInBackground, stopBackgroundScan]);

  const linkPayments = useMemo(() => {
    if (!link) return [];
    return payments.filter(p => p.announcement.linkSlug === link.slug);
  }, [payments, link]);

  const totalReceived = useMemo(
    () => linkPayments.reduce((sum, p) => sum + parseFloat(p.originalAmount || p.balance || "0"), 0),
    [linkPayments]
  );

  if (!link) {
    return (
      <Box p={{ base: "20px 16px", md: "40px" }} maxW="680px" mx="auto">
        <VStack gap="24px" py="60px" textAlign="center">
          <Text fontSize="18px" fontWeight={600} color={colors.text.primary}>Link not found</Text>
          <Box as="button" px="20px" py="10px" bgColor={colors.bg.input} borderRadius={radius.full}
            cursor="pointer" onClick={() => router.push("/links")}>
            <Text fontSize="14px" color={colors.text.secondary}>Back to Links</Text>
          </Box>
        </VStack>
      </Box>
    );
  }

  const tokName = `${link.slug}.${username}.tok`;
  const payPath = `/pay/${username}/${link.slug}`;
  const accentColor = link.emojiBg || "#2B5AE2";

  const handleCopy = async () => {
    await navigator.clipboard.writeText(tokName);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = () => {
    deleteLink(link.id);
    router.push("/links");
  };

  return (
    <Box p={{ base: "16px", md: "32px 40px" }} maxW="640px" mx="auto">
      <VStack gap="24px" align="stretch">
        {/* Top nav */}
        <HStack justify="space-between" align="center">
          <Box as="button" p="8px" borderRadius={radius.full} _hover={{ bgColor: colors.bg.input }}
            onClick={() => router.push("/links")} cursor="pointer">
            <ArrowLeftIcon size={20} color={colors.text.secondary} />
          </Box>
          <Box position="relative">
            <Box as="button" p="8px" borderRadius={radius.full} _hover={{ bgColor: colors.bg.input }}
              onClick={() => setShowMenu(!showMenu)} cursor="pointer">
              <MoreHorizontalIcon size={20} color={colors.text.secondary} />
            </Box>
            {showMenu && (
              <Box position="absolute" right="0" top="40px" zIndex={50}
                bgColor={colors.bg.card} borderRadius={radius.sm}
                border={`1.5px solid ${colors.border.default}`}
                boxShadow={shadows.modal} minW="150px" overflow="hidden">
                <Box as="button" w="100%" p="10px 14px" display="flex" gap="8px" alignItems="center"
                  _hover={{ bgColor: "rgba(229, 62, 62, 0.06)" }} cursor="pointer"
                  onClick={handleDelete}>
                  <TrashIcon size={15} color={colors.accent.red} />
                  <Text fontSize="13px" color={colors.accent.red} fontWeight={500}>Delete Link</Text>
                </Box>
              </Box>
            )}
          </Box>
        </HStack>

        {/* Hero — emoji + name + .tok */}
        <VStack gap="14px" pt="4px" pb="4px">
          <Box
            w="88px" h="88px"
            borderRadius={radius.full}
            bg={`linear-gradient(145deg, ${accentColor}18, ${accentColor}30)`}
            border={`2px solid ${accentColor}25`}
            display="flex" alignItems="center" justifyContent="center"
            fontSize="40px"
          >
            {link.emoji}
          </Box>
          <VStack gap="4px">
            <Text fontSize="22px" fontWeight={700} color={colors.text.primary} letterSpacing="-0.01em">
              {link.name}
            </Text>
            {link.description && (
              <Text fontSize="13px" color={colors.text.muted} textAlign="center" maxW="360px" lineHeight="1.5">
                {link.description}
              </Text>
            )}
          </VStack>
        </VStack>

        {/* .tok address bar */}
        <HStack
          p="12px 16px"
          bgColor={colors.bg.card}
          borderRadius={radius.md}
          border={`1.5px solid ${colors.border.default}`}
          justify="space-between"
        >
          <HStack gap="10px" flex={1} overflow="hidden">
            <Box
              w="30px" h="30px" borderRadius={radius.full}
              bg={`linear-gradient(135deg, ${accentColor}20, ${accentColor}40)`}
              display="flex" alignItems="center" justifyContent="center" flexShrink={0}
            >
              <LinkIcon size={13} color={accentColor} />
            </Box>
            <Text fontSize="14px" fontWeight={500} color={colors.text.primary} truncate>
              {tokName}
            </Text>
          </HStack>
          <HStack gap="2px">
            <Box as="button" p="7px" borderRadius={radius.full}
              bgColor={copied ? `${accentColor}10` : "transparent"}
              _hover={{ bgColor: colors.bg.input }}
              cursor="pointer" onClick={handleCopy} transition="all 0.15s ease">
              {copied
                ? <CheckIcon size={15} color={accentColor} />
                : <CopyIcon size={15} color={colors.text.muted} />
              }
            </Box>
            <Box as="button" p="7px" borderRadius={radius.full} _hover={{ bgColor: colors.bg.input }}
              cursor="pointer" onClick={() => setShowQR(true)}>
              <QRIcon size={15} color={colors.text.muted} />
            </Box>
          </HStack>
        </HStack>

        <QRModal
          isOpen={showQR}
          onClose={() => setShowQR(false)}
          url={payPath}
          title={link.name}
          displayName={tokName}
          accentColor={accentColor}
        />

        {/* Stats row — single card with dividers */}
        <HStack
          p="20px"
          bgColor={colors.bg.card}
          borderRadius={radius.lg}
          border={`1.5px solid ${colors.border.default}`}
          boxShadow={shadows.card}
        >
          <VStack flex={1} gap="4px">
            <Text fontSize="24px" fontWeight={700} color={colors.text.primary}>{link.views}</Text>
            <Text fontSize="11px" fontWeight={500} color={colors.text.muted} textTransform="uppercase" letterSpacing="0.05em">Views</Text>
          </VStack>
          <Box w="1px" h="40px" bgColor={colors.border.default} />
          <VStack flex={1} gap="4px">
            <Text fontSize="24px" fontWeight={700} color={colors.text.primary}>{linkPayments.length}</Text>
            <Text fontSize="11px" fontWeight={500} color={colors.text.muted} textTransform="uppercase" letterSpacing="0.05em">Payments</Text>
          </VStack>
          <Box w="1px" h="40px" bgColor={colors.border.default} />
          <VStack flex={1} gap="4px">
            <HStack gap="6px" justify="center">
              <ChainIcon size={20} chainId={activeChainId} />
              <Text fontSize="24px" fontWeight={700} color={colors.accent.indigo}>
                {totalReceived.toFixed(2)}
              </Text>
            </HStack>
            <Text fontSize="11px" fontWeight={500} color={colors.text.muted} textTransform="uppercase" letterSpacing="0.05em">Received</Text>
          </VStack>
        </HStack>

        {/* Activity section */}
        <VStack gap="14px" align="stretch" pt="4px">
          <HStack justify="space-between" align="center">
            <Text fontSize="16px" fontWeight={600} color={colors.text.primary}>Activity</Text>
            {isScanning && <Spinner size="xs" color={colors.text.muted} />}
          </HStack>

          {linkPayments.length === 0 ? (
            <Box
              p="40px 24px"
              bgColor={colors.bg.card}
              borderRadius={radius.lg}
              border={`1.5px solid ${colors.border.default}`}
              textAlign="center"
            >
              <VStack gap="12px">
                <Box
                  w="48px" h="48px" borderRadius={radius.full}
                  bgColor={colors.bg.input}
                  display="flex" alignItems="center" justifyContent="center"
                >
                  <ActivityIcon size={22} color={colors.text.muted} />
                </Box>
                <VStack gap="2px">
                  <Text fontSize="14px" fontWeight={600} color={colors.text.secondary}>No activity yet</Text>
                  <Text fontSize="12px" color={colors.text.muted}>Payments to this link will show here</Text>
                </VStack>
              </VStack>
            </Box>
          ) : (
            <Box
              bgColor={colors.bg.card}
              borderRadius={radius.lg}
              border={`1.5px solid ${colors.border.default}`}
              overflow="hidden"
            >
              {linkPayments.map((payment, i) => {
                const displayAmount = parseFloat(payment.originalAmount || payment.balance || "0");
                return (
                  <HStack
                    key={payment.announcement.txHash}
                    p="14px 18px"
                    justify="space-between"
                    borderTop={i > 0 ? `1px solid ${colors.border.default}` : "none"}
                    _hover={{ bgColor: colors.bg.input }}
                    transition="background 0.1s ease"
                  >
                    <HStack gap="12px">
                      <Box
                        w="38px" h="38px"
                        borderRadius={radius.full}
                        bgColor="rgba(43, 90, 226, 0.07)"
                        display="flex" alignItems="center" justifyContent="center"
                        flexShrink={0}
                      >
                        <ArrowDownLeftIcon size={18} color={colors.accent.indigo} />
                      </Box>
                      <VStack align="flex-start" gap="1px">
                        <Text fontSize="13px" fontWeight={500} color={colors.text.primary}>
                          {payment.announcement.caller?.slice(0, 6)}...{payment.announcement.caller?.slice(-4) || "unknown"}
                        </Text>
                        <Text fontSize="11px" color={colors.text.muted}>
                          Block #{payment.announcement.blockNumber.toLocaleString()}
                        </Text>
                      </VStack>
                    </HStack>
                    <HStack gap="8px">
                      <Text fontSize="14px" fontWeight={600} color={colors.accent.indigo}>
                        +{displayAmount.toFixed(4)}
                      </Text>
                      <a href={`${getExplorerBase(activeChainId)}/tx/${payment.announcement.txHash}`} target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}>
                        <Box p="5px" borderRadius={radius.full} _hover={{ bgColor: colors.bg.elevated }}>
                          <ArrowUpRightIcon size={13} color={colors.text.muted} />
                        </Box>
                      </a>
                    </HStack>
                  </HStack>
                );
              })}
            </Box>
          )}
        </VStack>
      </VStack>
    </Box>
  );
}
