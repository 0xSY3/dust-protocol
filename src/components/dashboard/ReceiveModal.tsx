"use client";

import { useState, useEffect, useRef } from "react";
import { Box, Text, VStack, HStack } from "@chakra-ui/react";
import QRCode from "qrcode";
import { colors, radius, shadows, glass, transitions } from "@/lib/design/tokens";
import { XIcon, CopyIcon, CheckIcon } from "@/components/stealth/icons";
import { DustLogo } from "@/components/DustLogo";

interface ReceiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  tokName: string | null;
  payPath: string;
}

export function ReceiveModal({ isOpen, onClose, tokName, payPath }: ReceiveModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const [fullUrl, setFullUrl] = useState("");

  useEffect(() => {
    if (!isOpen || !canvasRef.current || !payPath) return;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = `${origin}${payPath}`;
    setFullUrl(url);
    QRCode.toCanvas(canvasRef.current, url, {
      width: 260,
      margin: 2,
      color: { dark: "#1A1D2B", light: "#FFFFFF" },
      errorCorrectionLevel: "M",
    }, () => {});
  }, [isOpen, payPath]);

  const handleCopy = async () => {
    if (!fullUrl) return;
    await navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <Box position="fixed" inset="0" bgColor={colors.bg.overlay} zIndex={999}
        onClick={onClose} />

      {/* Modal */}
      <Box position="fixed" inset="0" display="flex" alignItems="center" justifyContent="center"
        zIndex={1000} p="16px" onClick={onClose}>
        <Box bg={glass.modal.bg} borderRadius={radius.xl}
          border={glass.modal.border}
          boxShadow={shadows.modal} backdropFilter={glass.modal.backdropFilter}
          maxW="400px" w="100%"
          p="40px 32px" position="relative"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}>

          {/* Close button */}
          <Box as="button" position="absolute" top="16px" right="16px"
            w="36px" h="36px" borderRadius={radius.full}
            border={`1px solid ${colors.border.default}`}
            display="flex" alignItems="center" justifyContent="center"
            cursor="pointer" _hover={{ bgColor: colors.bg.hover, borderColor: colors.border.light }}
            transition={transitions.fast}
            onClick={onClose}>
            <XIcon size={16} color={colors.text.secondary} />
          </Box>

          {tokName ? (
            <VStack gap="24px">
              {/* Title */}
              <VStack gap="6px">
                <Text fontSize="22px" fontWeight={700} color={colors.text.primary}>Share Your Link</Text>
                <Text fontSize="14px" color={colors.text.muted}>Anyone can pay you with this link</Text>
              </VStack>

              {/* QR Code */}
              <Box p="16px" borderRadius={radius.lg}
                border={`4px solid ${colors.accent.indigo}`}
                boxShadow={`0 4px 20px ${colors.accent.indigo}25`}
                bgColor="#fff">
                <canvas ref={canvasRef} style={{ display: "block", borderRadius: "12px" }} />
              </Box>

              {/* .tok name pill */}
              <Box px="20px" py="10px" bgColor={colors.bg.input}
                borderRadius={radius.full}>
                <Text fontSize="15px" fontWeight={700} color={colors.text.primary}
                  textAlign="center">
                  {tokName}
                </Text>
              </Box>

              {/* Full URL row */}
              <HStack
                w="100%"
                p="12px 14px"
                bgColor={colors.bg.input}
                borderRadius={radius.sm}
                gap="10px"
              >
                <Text flex={1} fontSize="13px" color={colors.text.muted} truncate>
                  {fullUrl}
                </Text>
                <Box
                  as="button"
                  p="6px"
                  borderRadius={radius.full}
                  cursor="pointer"
                  _hover={{ bgColor: colors.bg.elevated }}
                  onClick={handleCopy}
                  flexShrink={0}
                >
                  {copied
                    ? <CheckIcon size={16} color={colors.accent.indigo} />
                    : <CopyIcon size={16} color={colors.text.muted} />
                  }
                </Box>
              </HStack>

              {/* Branding */}
              <HStack gap="6px" justify="center" opacity={0.6}>
                <DustLogo size={18} color={colors.text.secondary} />
                <Text fontSize="14px" fontWeight={700} color={colors.text.secondary} letterSpacing="-0.02em">
                  Dust
                </Text>
              </HStack>
            </VStack>
          ) : (
            <VStack gap="16px" py="20px">
              <Text fontSize="18px" fontWeight={700} color={colors.text.primary} textAlign="center">
                No Username Yet
              </Text>
              <Text fontSize="14px" color={colors.text.muted} textAlign="center" lineHeight="1.6">
                Register a username to get a shareable payment link.
              </Text>
            </VStack>
          )}
        </Box>
      </Box>
    </>
  );
}
