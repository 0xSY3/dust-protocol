"use client";

import { useState, useEffect, useRef } from "react";
import { Box, Text, VStack, HStack } from "@chakra-ui/react";
import QRCode from "qrcode";
import { colors, radius, shadows, glass, transitions } from "@/lib/design/tokens";
import { XIcon } from "@/components/stealth/icons";
import { DustLogo } from "@/components/DustLogo";

interface QRModalProps {
  isOpen: boolean;
  onClose: () => void;
  url: string;
  title: string;
  displayName?: string;
  accentColor?: string;
}

export function QRModal({ isOpen, onClose, url, title, displayName, accentColor = colors.accent.indigo }: QRModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;
    // Use actual web URL for QR code (not the .tok display name)
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const fullUrl = url.startsWith("http") ? url : `${origin}${url.startsWith("/") ? url : `/${url}`}`;
    QRCode.toCanvas(canvasRef.current, fullUrl, {
      width: 260,
      margin: 2,
      color: { dark: "#1A1D2B", light: "#FFFFFF" },
      errorCorrectionLevel: "M",
    }, (err) => {
      if (!err) setReady(true);
    });
  }, [isOpen, url]);

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

          <VStack gap="24px">
            {/* Title */}
            <VStack gap="6px">
              <Text fontSize="22px" fontWeight={700} color={colors.text.primary}>{title}</Text>
              <Text fontSize="14px" color={colors.text.muted}>Scan to open payment link</Text>
            </VStack>

            {/* QR Code with colored border */}
            <Box p="16px" borderRadius={radius.lg}
              border={`4px solid ${accentColor}`}
              boxShadow={`0 4px 20px ${accentColor}25`}
              bgColor="#fff">
              <canvas ref={canvasRef} style={{ display: "block", borderRadius: "12px" }} />
            </Box>

            {/* Display name */}
            <Box px="20px" py="10px" bgColor={colors.bg.input}
              borderRadius={radius.full} maxW="100%">
              <Text fontSize="14px" fontWeight={600} color={colors.text.primary}
                textAlign="center" truncate>
                {displayName || url}
              </Text>
            </Box>

            {/* Branding */}
            <HStack gap="6px" justify="center" opacity={0.6}>
              <DustLogo size={18} color={colors.text.secondary} />
              <Text fontSize="14px" fontWeight={700} color={colors.text.secondary} letterSpacing="-0.02em">
                Dust
              </Text>
            </HStack>
          </VStack>
        </Box>
      </Box>
    </>
  );
}
