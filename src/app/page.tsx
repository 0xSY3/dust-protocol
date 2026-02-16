"use client";

import { useState, useEffect, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Box, Text, VStack, HStack, Input } from "@chakra-ui/react";
import { useAuth } from "@/contexts/AuthContext";
import { colors, glass, typography, transitions, shadows, radius, buttonVariants } from "@/lib/design/tokens";
import { WalletIcon, ArrowUpRightIcon, MailIcon } from "@/components/stealth/icons";
import { DustLogo } from "@/components/DustLogo";
import { useLogin } from "@privy-io/react-auth";
import { isPrivyEnabled } from "@/config/privy";
import { useConnect } from "wagmi";
import { injected } from "wagmi/connectors";

import { SpiritPortal } from "@/components/SpiritPortal";

// One-time cleanup of stale cache data from previous sessions
function cleanupCorruptedStorage() {
  if (typeof window === "undefined") return;
  const CURRENT_VERSION = 6;
  const flag = "stealth_storage_version";
  const stored = parseInt(localStorage.getItem(flag) || "0", 10);
  if (stored >= CURRENT_VERSION) return;
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (
      key.startsWith("stealth_last_scanned_") ||
      key.startsWith("stealth_payments_") ||
      key === "stealth_storage_v2_cleaned"
    )) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));

  if (stored < 6) {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("tokamak_stealth_keys_") || key?.startsWith("dust_pin_")) {
        const addr = key.replace("tokamak_stealth_keys_", "").replace("dust_pin_", "");
        const onboardedKey = "dust_onboarded_" + addr;
        if (!localStorage.getItem(onboardedKey)) {
          localStorage.setItem(onboardedKey, "true");
        }
      }
    }
  }

  localStorage.setItem(flag, String(CURRENT_VERSION));
}

// Inline SVG icons for social providers (not in icon library)
const GoogleIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

const FarcasterIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M5.5 3h13v18h-2.25v-7.5a4.25 4.25 0 0 0-8.5 0V21H5.5V3z" fill="#855DCD" />
    <path d="M3 5.5L5.5 3h13L21 5.5H3z" fill="#855DCD" />
  </svg>
);

export default function Home() {
  const { isConnected, isOnboarded, isHydrated, address } = useAuth();
  const { login: privyLogin } = useLogin();
  const { connect } = useConnect();
  const router = useRouter();
  const [searchName, setSearchName] = useState("");
  const hasPrivy = isPrivyEnabled;

  useEffect(() => { cleanupCorruptedStorage(); }, []);

  useEffect(() => {
    if (!isHydrated) return;
    if (isConnected && !address) return;
    if (isConnected && isOnboarded) {
      router.replace("/dashboard");
    } else if (isConnected && !isOnboarded) {
      router.replace("/onboarding");
    }
  }, [isConnected, isOnboarded, isHydrated, address, router]);

  const handlePaySearch = () => {
    const name = searchName.trim().toLowerCase().replace(/\.tok$/, "");
    if (!name) return;
    router.push(`/pay/${name}`);
  };

  if (!isHydrated || (isConnected && !address) || (isConnected && isOnboarded)) {
    return (
      <Box minH="100vh" bg={colors.bg.page} display="flex" alignItems="center" justifyContent="center">
        <VStack gap="16px">
          <Box opacity={0.6}>
            <DustLogo size={40} color={colors.accent.indigoBright} />
          </Box>
          <Text fontSize="14px" color={colors.text.muted} fontFamily={typography.fontFamily.body}>Loading...</Text>
        </VStack>
      </Box>
    );
  }

  return (
    <>
      <style>{`
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes btn-glow {
          0%, 100% { box-shadow: 0 0 20px rgba(43,90,226,0.3), 0 0 60px rgba(43,90,226,0.1); }
          50% { box-shadow: 0 0 30px rgba(43,90,226,0.5), 0 0 80px rgba(43,90,226,0.15); }
        }
        .fade-up { animation: fade-up 0.8s cubic-bezier(0.16,1,0.3,1) forwards; opacity: 0; }
        .d1 { animation-delay: 0.1s; }
        .d2 { animation-delay: 0.25s; }
        .d3 { animation-delay: 0.4s; }
        .d4 { animation-delay: 0.55s; }
        .d5 { animation-delay: 0.7s; }
        .d6 { animation-delay: 0.85s; }
        .d7 { animation-delay: 1.0s; }
        
        .split-layout-text {
             font-family: var(--font-instrument-serif), serif;
             font-style: italic;
             font-weight: 400;
        }
      `}</style>

      <Box
        minH="100vh"
        bg={colors.bg.page}
        display="flex"
        flexDirection="column"
        position="relative"
        overflowY="hidden"
      >
        {/* Unicorn Studio Background - SDK Implementation */}
        {/* Static Nature Background */}
        {/* Dust Spirit Portal (Mouse-Reactive Spiral) */}
        <SpiritPortal />

        {/* Header */}
        <Box as="header" position="relative" zIndex={100} px="40px" py="32px">
          <Box w="100%" display="flex" alignItems="center" justifyContent="space-between">
            {/* Left: Logo */}
            <HStack gap="12px" align="center">
              <DustLogo size={32} color={colors.accent.indigoBright} />
              <HStack gap="6px" align="baseline">
                <Text
                  fontSize="24px"
                  fontWeight="400"
                  color={colors.text.primary}
                  fontFamily="var(--font-instrument-serif), serif"
                  letterSpacing="-0.02em"
                >
                  Dust
                </Text>
                <Text
                  fontSize="24px"
                  fontWeight="400"
                  color={colors.text.secondary}
                  fontFamily="var(--font-instrument-serif), serif"
                  letterSpacing="-0.02em"
                >
                  Protocol
                </Text>
              </HStack>
            </HStack>

            {/* Right: Connect & Auth */}
            <HStack gap="16px">
              {hasPrivy && !isConnected && (
                <HStack gap="8px">
                  {[
                    { icon: GoogleIcon, method: "google" as const },
                    { icon: MailIcon, method: "email" as const },
                    { icon: FarcasterIcon, method: "farcaster" as const },
                  ].map((opt) => (
                    <Box
                      key={opt.method}
                      as="button"
                      w="40px"
                      h="40px"
                      bg="rgba(255, 255, 255, 0.05)"
                      border="1px solid rgba(255, 255, 255, 0.1)"
                      borderRadius={radius.full}
                      cursor="pointer"
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                      transition={transitions.base}
                      _hover={{
                        bg: "rgba(255, 255, 255, 0.1)",
                        borderColor: "rgba(255, 255, 255, 0.2)",
                        transform: "translateY(-1px)",
                      }}
                      onClick={() => privyLogin({ loginMethods: [opt.method] })}
                    >
                      <opt.icon size={16} />
                    </Box>
                  ))}
                </HStack>
              )}
              {/* Manual Connect Button if not authenticated via Privy or if Privy is disabled */}
              <Box
                as="button"
                px="20px"
                py="10px"
                bg={buttonVariants.primary.bg}
                boxShadow={buttonVariants.primary.boxShadow}
                borderRadius={radius.sm}
                cursor="pointer"
                display="flex"
                alignItems="center"
                gap="8px"
                _hover={{ boxShadow: buttonVariants.primary.hover.boxShadow, transform: buttonVariants.primary.hover.transform }}
                _active={{ transform: buttonVariants.primary.active.transform }}
                transition={transitions.fast}
                onClick={() => connect({ connector: injected() })}
              >
                <WalletIcon size={16} color="white" />
                <Text fontSize="14px" color="white" fontWeight="600">
                  Connect Wallet
                </Text>
              </Box>
            </HStack>
          </Box>
        </Box>

        <Box
          position="relative"
          zIndex={10}
          flex="1"
          display="flex"
          flexDirection={{ base: "column", lg: "row" }} // RESPONSIVE: Stack on mobile
          w="100%"
          px={{ base: "20px", md: "60px" }} // RESPONSIVE PADDING
          alignItems="center"
          gap={{ base: "40px", lg: "0" }} // Gap for mobile stack
          minH="calc(100vh - 100px)" // Ensure it takes full screen height minus header
        >

          {/* Left Side: Privacy Transfers */}
          <Box flex="1" display="flex" flexDirection="column" gap="40px" alignItems="flex-start" justifyContent="center">
            <Box className="fade-up d1">
              <Text
                fontFamily="var(--font-instrument-serif), serif"
                fontSize={{ base: "52px", lg: "72px" }}
                color="white"
                lineHeight="1.0"
                letterSpacing="-0.03em"
                mb="16px"
              >
                Private<br />Transfers
              </Text>
              <Text fontSize="16px" color="rgba(255,255,255,0.6)" maxW="320px" lineHeight="1.6">
                Untraceable payments that dissolve into the blockchain.
              </Text>
            </Box>

            {/* Pay Search Input form */}
            <VStack gap="12px" w="100%" maxW="380px" align="flex-start" className="fade-up d2">
              <HStack gap="8px" w="100%">
                <Input
                  placeholder="username.tok"
                  value={searchName}
                  onChange={(e) => setSearchName(e.target.value)}
                  onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") handlePaySearch(); }}
                  h="56px"
                  flex={1}
                  bgColor="rgba(0, 0, 0, 0.3)"
                  border="1px solid rgba(255, 255, 255, 0.1)"
                  borderRadius={radius.md}
                  color="white"
                  fontSize="16px"
                  fontWeight={400}
                  fontFamily={typography.fontFamily.body}
                  px="20px"
                  backdropFilter="blur(12px)"
                  _placeholder={{ color: "rgba(255, 255, 255, 0.4)" }}
                  _hover={{
                    borderColor: "rgba(74, 117, 240, 0.5)",
                    bgColor: "rgba(0, 0, 0, 0.4)",
                  }}
                  _focus={{
                    borderColor: colors.border.focus,
                    boxShadow: `${shadows.inputFocus}`,
                    bgColor: "rgba(0, 0, 0, 0.5)",
                  }}
                  transition={transitions.base}
                />
                <Box
                  as="button"
                  w="56px"
                  h="56px"
                  flexShrink={0}
                  bg="rgba(255, 255, 255, 0.05)"
                  border={`1px solid rgba(255, 255, 255, 0.1)`}
                  borderRadius={radius.md}
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  cursor="pointer"
                  backdropFilter={glass.input.backdropFilter}
                  transition={transitions.base}
                  _hover={{
                    bg: colors.accent.indigo,
                    borderColor: colors.accent.indigo,
                    transform: "translateY(-1px)",
                  }}
                  onClick={handlePaySearch}
                >
                  <ArrowUpRightIcon size={20} color="white" />
                </Box>
              </HStack>
              <Text
                fontSize="12px"
                color="rgba(255, 255, 255, 0.4)"
                letterSpacing="0.05em"
                fontFamily={typography.fontFamily.mono}
              >
                ENTER A USERNAME TO PAY
              </Text>
            </VStack>
          </Box>

          {/* Right Side: Privacy Swap */}
          <Box flex="1" display="flex" flexDirection="column" gap="24px" alignItems="flex-end" justifyContent="center" textAlign="right">
            <Box className="fade-up d3">
              <Text
                fontFamily="var(--font-instrument-serif), serif"
                fontSize={{ base: "52px", lg: "72px" }}
                color="white"
                lineHeight="1.0"
                letterSpacing="-0.03em"
                mb="16px"
              >
                Privacy<br />Swap
              </Text>
              <Text fontSize="16px" color="rgba(255,255,255,0.6)" maxW="320px" lineHeight="1.6" ml="auto">
                Swap tokens anonymously without leaving a trace.
              </Text>
            </Box>

            {/* Placeholder for Swap Action */}
            <Box
              className="fade-up d4"
              px="24px"
              py="12px"
              borderRadius={radius.full}
              border="1px solid rgba(255,255,255,0.1)"
              bg="rgba(255,255,255,0.02)"
            >
              <Text fontSize="13px" color="rgba(255,255,255,0.4)" fontFamily={typography.fontFamily.mono}>
                COMING SOON
              </Text>
            </Box>
          </Box>

        </Box>



        {/* Footer Placeholder */}
        <Box
          position="absolute"
          bottom="20px"
          left="0"
          w="100%"
          textAlign="center"
          zIndex={10}
          pointerEvents="none"
        >
          <Text color="rgba(255,255,255,0.3)" fontSize="12px">
            © 2026 Dust Protocol. All rights reserved.
          </Text>
        </Box>

      </Box >
    </>
  );
}

