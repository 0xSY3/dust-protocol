"use client";

import { useState, useEffect, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Box, Text, VStack, HStack, Input } from "@chakra-ui/react";
import { useAuth } from "@/contexts/AuthContext";
import { colors, glass, typography, transitions, shadows, radius, buttonVariants, inputStates } from "@/lib/design/tokens";
import { LockIcon, WalletIcon, ArrowUpRightIcon, MailIcon } from "@/components/stealth/icons";
import { DustLogo } from "@/components/DustLogo";
import { FlickeringGrid } from "@/components/FlickeringGrid";
import { useLogin } from "@privy-io/react-auth";
import { isPrivyEnabled } from "@/config/privy";
import { useConnect } from "wagmi";
import { injected } from "wagmi/connectors";

// One-time cleanup of stale cache data from previous sessions
// NOTE: Do NOT delete tokamak_stealth_keys_* or stealth_claim_* here —
// those contain valid user data that isOnboarded detection depends on.
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

  // v6: Migrate pre-fix users — set dust_onboarded_ flag for users who have
  // stored stealth keys or PIN but no explicit onboarded flag
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
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

const FarcasterIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M5.5 3h13v18h-2.25v-7.5a4.25 4.25 0 0 0-8.5 0V21H5.5V3z" fill="#855DCD"/>
    <path d="M3 5.5L5.5 3h13L21 5.5H3z" fill="#855DCD"/>
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
    // Wait for address to be populated — isConnected can be true before address is available,
    // which causes all isOnboarded checks to fail and incorrectly routes to /onboarding
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
        @keyframes orb-pulse {
          0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
          50% { transform: translate(-50%, -50%) scale(1.05); opacity: 0.9; }
        }
        @keyframes ring-rotate {
          0% { transform: translate(-50%, -50%) rotate(0deg); }
          100% { transform: translate(-50%, -50%) rotate(360deg); }
        }
        @keyframes ring-rotate-reverse {
          0% { transform: translate(-50%, -50%) rotate(0deg); }
          100% { transform: translate(-50%, -50%) rotate(-360deg); }
        }
        @keyframes glow-breathe {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes btn-glow {
          0%, 100% { box-shadow: 0 0 20px rgba(43,90,226,0.3), 0 0 60px rgba(43,90,226,0.1); }
          50% { box-shadow: 0 0 30px rgba(43,90,226,0.5), 0 0 80px rgba(43,90,226,0.15); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
        .fade-up { animation: fade-up 0.8s cubic-bezier(0.16,1,0.3,1) forwards; opacity: 0; }
        .d1 { animation-delay: 0.1s; }
        .d2 { animation-delay: 0.25s; }
        .d3 { animation-delay: 0.4s; }
        .d4 { animation-delay: 0.55s; }
        .d5 { animation-delay: 0.7s; }
        .d6 { animation-delay: 0.85s; }
        .d7 { animation-delay: 1.0s; }
      `}</style>

      <Box
        minH="100vh"
        bg={colors.bg.page}
        display="flex"
        flexDirection="column"
        position="relative"
        overflow="hidden"
      >
        {/* Flickering grid background */}
        <FlickeringGrid
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            zIndex: 0,
            maskImage: "radial-gradient(ellipse 80% 70% at 50% 40%, white, transparent)",
            WebkitMaskImage: "radial-gradient(ellipse 80% 70% at 50% 40%, white, transparent)",
          }}
          squareSize={5}
          gridGap={6}
          color="#4A75F0"
          maxOpacity={0.25}
          flickerChance={0.3}
        />

        {/* Large ambient glow — top center */}
        <Box
          position="absolute"
          top="-10%"
          left="50%"
          transform="translateX(-50%)"
          w="1200px"
          h="800px"
          borderRadius="50%"
          bg="radial-gradient(ellipse, rgba(43,90,226,0.08) 0%, rgba(74,117,240,0.03) 40%, transparent 70%)"
          pointerEvents="none"
          style={{ animation: "glow-breathe 6s ease-in-out infinite" }}
        />

        {/* Secondary glow — bottom */}
        <Box
          position="absolute"
          bottom="-15%"
          left="50%"
          transform="translateX(-50%)"
          w="800px"
          h="500px"
          borderRadius="50%"
          bg="radial-gradient(ellipse, rgba(99,60,255,0.05) 0%, rgba(43,90,226,0.02) 40%, transparent 70%)"
          pointerEvents="none"
        />

        {/* Header */}
        <Box as="header" position="relative" zIndex={10} px="24px" py="24px">
          <Box maxW="1200px" mx="auto" display="flex" alignItems="center" justifyContent="space-between">
            <HStack gap="10px" align="center">
              <DustLogo size={28} color="white" />
              <Text
                fontSize="22px"
                fontWeight="800"
                color={colors.text.primary}
                fontFamily={typography.fontFamily.heading}
                letterSpacing="-0.03em"
              >
                Dust
              </Text>
              <Text
                {...typography.label.sm}
                color={colors.text.muted}
                letterSpacing="0.1em"
              >
                Protocol
              </Text>
            </HStack>
            <HStack gap="6px">
              <Box w="6px" h="6px" borderRadius="50%" bg="rgba(74,117,240,0.6)" />
              <Text fontSize="12px" color={colors.text.muted} fontWeight="500" fontFamily={typography.fontFamily.body}>
                Thanos Network
              </Text>
            </HStack>
          </Box>
        </Box>

        {/* Hero */}
        <Box
          flex="1"
          display="flex"
          justifyContent="center"
          alignItems="center"
          px="16px"
          pb="40px"
          position="relative"
          zIndex={10}
        >
          <VStack gap="48px" maxW="540px" textAlign="center">
            {/* Orb — the centerpiece */}
            <Box className="fade-up d1" position="relative" style={{ animation: "float 6s ease-in-out infinite" }}>
              {/* Outer rotating ring */}
              <Box
                position="absolute"
                top="50%"
                left="50%"
                w="160px"
                h="160px"
                borderRadius="50%"
                border="1px solid transparent"
                borderTopColor="rgba(74,117,240,0.25)"
                borderRightColor="rgba(74,117,240,0.08)"
                pointerEvents="none"
                style={{ animation: "ring-rotate 12s linear infinite" }}
              />
              {/* Inner reverse ring */}
              <Box
                position="absolute"
                top="50%"
                left="50%"
                w="130px"
                h="130px"
                borderRadius="50%"
                border="1px solid transparent"
                borderBottomColor="rgba(99,60,255,0.2)"
                borderLeftColor="rgba(99,60,255,0.06)"
                pointerEvents="none"
                style={{ animation: "ring-rotate-reverse 8s linear infinite" }}
              />
              {/* Glow halo */}
              <Box
                position="absolute"
                top="50%"
                left="50%"
                transform="translate(-50%, -50%)"
                w="200px"
                h="200px"
                borderRadius="50%"
                bg="radial-gradient(circle, rgba(43,90,226,0.15) 0%, rgba(74,117,240,0.05) 40%, transparent 70%)"
                pointerEvents="none"
                style={{ animation: "glow-breathe 4s ease-in-out infinite" }}
              />
              {/* Core orb */}
              <Box
                w="100px"
                h="100px"
                borderRadius="50%"
                bg="radial-gradient(circle at 35% 35%, rgba(74,117,240,0.2) 0%, rgba(43,90,226,0.1) 50%, rgba(20,20,40,0.3) 100%)"
                border="1px solid rgba(74,117,240,0.15)"
                display="flex"
                alignItems="center"
                justifyContent="center"
                color="#4A75F0"
                position="relative"
                backdropFilter="blur(20px)"
                style={{ animation: "orb-pulse 4s ease-in-out infinite" }}
              >
                <DustLogo size={42} color="#4A75F0" />
              </Box>
            </Box>

            {/* Title + subtitle */}
            <VStack gap="20px" className="fade-up d2">
              <Text
                fontFamily={typography.fontFamily.heading}
                fontSize={{ base: "48px", md: "64px" }}
                fontWeight={700}
                lineHeight="1.0"
                letterSpacing="-0.04em"
                bgGradient="linear(to-b, white 30%, rgba(74,117,240,0.7))"
                bgClip="text"
                color="transparent"
              >
                Private Payments
              </Text>
              <Text
                fontSize="17px"
                color={colors.text.tertiary}
                lineHeight="1.7"
                maxW="380px"
                fontWeight="400"
                fontFamily={typography.fontFamily.body}
              >
                Send and receive payments that dissolve into the blockchain.
                Untraceable. Powered by stealth addresses.
              </Text>
            </VStack>

            {/* Sign-in options */}
            <VStack gap="16px" w="100%" maxW="380px" className="fade-up d3">
              {/* Social login buttons — only when Privy is configured */}
              {hasPrivy && (
                <>
                  <HStack gap="10px" w="100%">
                    {[
                      { icon: GoogleIcon, label: "Google", method: "google" as const },
                      { icon: MailIcon, label: "Email", method: "email" as const },
                      { icon: FarcasterIcon, label: "Farcaster", method: "farcaster" as const },
                    ].map((opt) => (
                      <Box
                        key={opt.method}
                        as="button"
                        flex={1}
                        py="14px"
                        bg={glass.card.bg}
                        border={glass.card.border}
                        borderRadius={radius.md}
                        cursor="pointer"
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                        gap="8px"
                        backdropFilter={glass.card.backdropFilter}
                        transition={transitions.base}
                        _hover={{
                          bg: glass.cardHover.bg,
                          borderColor: "rgba(74,117,240,0.3)",
                          transform: "translateY(-2px)",
                          boxShadow: shadows.card,
                        }}
                        _active={{ transform: "translateY(0)" }}
                        onClick={() => privyLogin({ loginMethods: [opt.method] })}
                      >
                        <opt.icon size={18} />
                        <Text fontSize="13px" color={colors.text.secondary} fontWeight="500" fontFamily={typography.fontFamily.body}>
                          {opt.label}
                        </Text>
                      </Box>
                    ))}
                  </HStack>

                  {/* Divider between social and wallet */}
                  <HStack w="100%" gap="16px" align="center">
                    <Box flex={1} h="1px" bg={`linear-gradient(90deg, transparent, ${colors.border.default}, transparent)`} />
                    <Text {...typography.label.sm} color={colors.text.muted} letterSpacing="0.12em">
                      or
                    </Text>
                    <Box flex={1} h="1px" bg={`linear-gradient(90deg, transparent, ${colors.border.default}, transparent)`} />
                  </HStack>
                </>
              )}

              {/* Connect Wallet CTA with glow */}
              <Box w="100%" display="flex" justifyContent="center">
                <Box position="relative" w="100%">
                  <Box
                    position="absolute"
                    inset="-4px"
                    borderRadius="18px"
                    bg="transparent"
                    pointerEvents="none"
                    style={{ animation: "btn-glow 3s ease-in-out infinite" }}
                  />
                  <Box
                    as="button"
                    w="100%"
                    py="18px"
                    px="36px"
                    bg={buttonVariants.primary.bg}
                    borderRadius={radius.md}
                    cursor="pointer"
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    gap="10px"
                    position="relative"
                    boxShadow={shadows.buttonPrimary}
                    transition={transitions.smooth}
                    _hover={{
                      transform: "translateY(-3px)",
                      boxShadow: `${shadows.buttonPrimaryHover}, 0 0 0 1px rgba(74,117,240,0.3)`,
                    }}
                    _active={{ transform: "translateY(0)", filter: "brightness(0.95)" }}
                    onClick={() => connect({ connector: injected() })}
                  >
                    <WalletIcon size={20} color="white" />
                    <Text
                      fontSize="16px"
                      color="white"
                      fontWeight="600"
                      letterSpacing="-0.01em"
                      fontFamily={typography.fontFamily.heading}
                    >
                      Connect Wallet
                    </Text>
                  </Box>
                </Box>
              </Box>
            </VStack>

            {/* Divider */}
            <HStack w="100%" gap="16px" align="center" className="fade-up d4">
              <Box flex={1} h="1px" bg={`linear-gradient(90deg, transparent, ${colors.border.default}, transparent)`} />
              <Text
                {...typography.label.sm}
                color={colors.text.muted}
                letterSpacing="0.12em"
                whiteSpace="nowrap"
              >
                or pay someone
              </Text>
              <Box flex={1} h="1px" bg={`linear-gradient(90deg, transparent, ${colors.border.default}, transparent)`} />
            </HStack>

            {/* Pay someone search — enhanced visibility */}
            <HStack gap="8px" w="100%" maxW="380px" className="fade-up d5">
              <Input
                placeholder="username.tok"
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") handlePaySearch(); }}
                h="52px"
                flex={1}
                bgColor="rgba(20, 20, 40, 0.6)"
                border="1px solid rgba(74, 117, 240, 0.25)"
                borderRadius={radius.md}
                color={colors.text.primary}
                fontSize="15px"
                fontWeight={500}
                fontFamily={typography.fontFamily.body}
                px="18px"
                backdropFilter="blur(12px)"
                boxShadow="inset 0 1px 2px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(74, 117, 240, 0.08)"
                _placeholder={{ color: "rgba(160, 174, 192, 0.7)" }}
                _hover={{
                  borderColor: "rgba(74, 117, 240, 0.4)",
                  bgColor: "rgba(25, 25, 45, 0.7)",
                }}
                _focus={{
                  borderColor: colors.border.focus,
                  boxShadow: `${shadows.inputFocus}, inset 0 1px 2px rgba(0, 0, 0, 0.2)`,
                  bgColor: "rgba(25, 25, 45, 0.8)",
                }}
                transition={transitions.base}
              />
              <Box
                as="button"
                w="52px"
                h="52px"
                flexShrink={0}
                bg="rgba(43,90,226,0.12)"
                border={`1px solid ${colors.border.accent}`}
                borderRadius={radius.md}
                display="flex"
                alignItems="center"
                justifyContent="center"
                cursor="pointer"
                backdropFilter={glass.input.backdropFilter}
                transition={transitions.base}
                _hover={{
                  bg: "rgba(43,90,226,0.25)",
                  borderColor: colors.border.focus,
                  transform: "translateY(-1px)",
                  boxShadow: shadows.buttonPrimary,
                }}
                onClick={handlePaySearch}
              >
                <ArrowUpRightIcon size={18} color={colors.accent.indigo} />
              </Box>
            </HStack>

            {/* Privacy notice */}
            <HStack gap="8px" className="fade-up d7" py="4px">
              <Box color={colors.text.muted} flexShrink={0}>
                <LockIcon size={12} />
              </Box>
              <Text fontSize="12px" color={colors.text.muted} lineHeight="1.5" fontFamily={typography.fontFamily.body}>
                Your keys are derived locally. No data leaves your browser.
              </Text>
            </HStack>
          </VStack>
        </Box>

        {/* Footer */}
        <Box as="footer" py="20px" px="24px" position="relative" zIndex={10}>
          <HStack justify="center" gap="12px" maxW="1200px" mx="auto">
            <HStack gap="6px">
              <Box w="4px" h="4px" borderRadius="50%" bg="rgba(74,117,240,0.3)" />
              <Text fontSize="11px" color={colors.text.muted} letterSpacing="0.02em" fontFamily={typography.fontFamily.mono}>
                ERC-5564
              </Text>
            </HStack>
            <Text fontSize="11px" color={colors.border.light}>·</Text>
            <HStack gap="6px">
              <Box w="4px" h="4px" borderRadius="50%" bg="rgba(99,60,255,0.3)" />
              <Text fontSize="11px" color={colors.text.muted} letterSpacing="0.02em" fontFamily={typography.fontFamily.mono}>
                ERC-6538
              </Text>
            </HStack>
            <Text fontSize="11px" color={colors.border.light}>·</Text>
            <HStack
              gap="6px"
              as="a"
              href="mailto:support@dustprotocol.app"
              cursor="pointer"
              transition={transitions.base}
              _hover={{ opacity: 0.7 }}
            >
              <MailIcon size={12} color={colors.text.muted} />
              <Text fontSize="11px" color={colors.text.muted} letterSpacing="0.02em" fontFamily={typography.fontFamily.mono}>
                support@dustprotocol.app
              </Text>
            </HStack>
          </HStack>
        </Box>
      </Box>
    </>
  );
}
