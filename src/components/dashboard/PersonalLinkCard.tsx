"use client";

import { useState } from "react";
import { Box, Text, VStack, HStack } from "@chakra-ui/react";
import { colors, radius, shadows, glass, transitions } from "@/lib/design/tokens";
import type { OwnedName } from "@/lib/design/types";
import { LinkIcon, CopyIcon, CheckIcon, QRIcon, ExternalLinkIcon } from "@/components/stealth/icons";
import { QRModal } from "@/components/links/QRModal";

interface PersonalLinkCardProps {
  ownedNames: OwnedName[];
  metaAddress: string | null;
}

export function PersonalLinkCard({ ownedNames, metaAddress }: PersonalLinkCardProps) {
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);

  const displayName = ownedNames.length > 0 ? ownedNames[0].fullName : null;
  const tokName = ownedNames.length > 0 ? `${ownedNames[0].name}.tok` : null;
  const payPath = ownedNames.length > 0 ? `/pay/${ownedNames[0].name}` : "";
  const copyText = tokName || displayName || metaAddress || "";

  const handleCopy = async () => {
    const textToCopy = payPath
      ? `${window.location.origin}${payPath}`
      : copyText;
    await navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <Box
        p="28px"
        bg={glass.card.bg}
        borderRadius={radius.lg}
        border={glass.card.border}
        boxShadow={shadows.card}
        backdropFilter={glass.card.backdropFilter}
      >
        <VStack gap="20px" align="stretch">
          {/* Header */}
          <VStack align="flex-start" gap="2px">
            <Text fontSize="17px" fontWeight={700} color={colors.text.primary}>Your Personal Link</Text>
            <Text fontSize="14px" color={colors.text.muted}>Share to get paid</Text>
          </VStack>

          {/* Link URL row */}
          {tokName ? (
            <HStack
              p="14px 16px"
              bgColor={colors.bg.input}
              borderRadius={radius.sm}
              justify="space-between"
            >
              <HStack gap="10px">
                <Box
                  w="32px" h="32px"
                  borderRadius={radius.full}
                  bgColor="rgba(43, 90, 226, 0.08)"
                  display="flex" alignItems="center" justifyContent="center"
                >
                  <LinkIcon size={16} color={colors.accent.indigo} />
                </Box>
                <Text fontSize="16px" fontWeight={700} color={colors.text.primary}>{tokName}</Text>
              </HStack>
              <HStack gap="4px">
                <Box
                  as="button"
                  p="8px"
                  borderRadius={radius.full}
                  cursor="pointer"
                  _hover={{ bgColor: colors.bg.hover }}
                  transition={transitions.fast}
                  onClick={handleCopy}
                >
                  {copied
                    ? <CheckIcon size={16} color={colors.accent.indigo} />
                    : <CopyIcon size={16} color={colors.text.muted} />
                  }
                </Box>
                <Box
                  as="button"
                  p="8px"
                  borderRadius={radius.full}
                  cursor="pointer"
                  _hover={{ bgColor: colors.bg.hover }}
                  transition={transitions.fast}
                  onClick={() => setShowQR(true)}
                >
                  <QRIcon size={16} color={colors.text.muted} />
                </Box>
                <Box
                  as="button"
                  p="8px"
                  borderRadius={radius.full}
                  cursor="pointer"
                  _hover={{ bgColor: colors.bg.hover }}
                  transition={transitions.fast}
                  onClick={() => window.open(payPath, "_blank")}
                >
                  <ExternalLinkIcon size={16} color={colors.text.muted} />
                </Box>
              </HStack>
            </HStack>
          ) : metaAddress ? (
            <Box p="14px 16px" bgColor={colors.bg.input} borderRadius={radius.sm}>
              <Text fontSize="12px" color={colors.text.tertiary} fontFamily="'JetBrains Mono', monospace" wordBreak="break-all" lineHeight="1.5">
                {metaAddress.slice(0, 30)}...{metaAddress.slice(-20)}
              </Text>
            </Box>
          ) : (
            <Text fontSize="13px" color={colors.text.muted}>Complete onboarding to get your link</Text>
          )}
        </VStack>
      </Box>

      {tokName && (
        <QRModal
          isOpen={showQR}
          onClose={() => setShowQR(false)}
          url={payPath}
          title="Your Payment Link"
          displayName={tokName}
        />
      )}
    </>
  );
}
