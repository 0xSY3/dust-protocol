"use client";

import { useState, useEffect, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Box, Text, VStack, HStack, Input } from "@chakra-ui/react";
import { useAuth } from "@/contexts/AuthContext";
import { colors } from "@/lib/design/tokens";
import { ShieldIcon, LockIcon, WalletIcon, UserIcon, ZapIcon, ArrowUpRightIcon, MailIcon } from "@/components/stealth/icons";
import { useLogin } from "@privy-io/react-auth";
import { isPrivyEnabled } from "@/config/privy";
import { useConnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { Instrument_Serif } from "next/font/google";

const heroFont = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

// One-time cleanup of corrupted stealth data from previous sessions
function cleanupCorruptedStorage() {
  if (typeof window === "undefined") return;
  const CURRENT_VERSION = 5;
  const flag = "stealth_storage_version";
  const stored = parseInt(localStorage.getItem(flag) || "0", 10);
  if (stored >= CURRENT_VERSION) return;
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (
      key.startsWith("tokamak_stealth_keys_") ||
      key.startsWith("stealth_last_scanned_") ||
      key.startsWith("stealth_payments_") ||
      key.startsWith("stealth_claim_") ||
      key === "stealth_storage_v2_cleaned"
    )) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));
  localStorage.setItem(flag, String(CURRENT_VERSION));
}

// Enhanced dust particles — more, varied sizes
const particles = [
  { left: "5%", size: 2, dur: "14s", delay: "0s", opacity: 0.4 },
  { left: "12%", size: 3, dur: "18s", delay: "1s", opacity: 0.6 },
  { left: "20%", size: 1, dur: "11s", delay: "2s", opacity: 0.3 },
  { left: "28%", size: 2, dur: "16s", delay: "0.5s", opacity: 0.5 },
  { left: "35%", size: 3, dur: "13s", delay: "3s", opacity: 0.7 },
  { left: "42%", size: 1, dur: "19s", delay: "1.5s", opacity: 0.3 },
  { left: "50%", size: 2, dur: "15s", delay: "2.5s", opacity: 0.5 },
  { left: "58%", size: 3, dur: "12s", delay: "0.8s", opacity: 0.6 },
  { left: "65%", size: 1, dur: "17s", delay: "3.5s", opacity: 0.4 },
  { left: "72%", size: 2, dur: "14s", delay: "1.2s", opacity: 0.5 },
  { left: "80%", size: 3, dur: "16s", delay: "2.8s", opacity: 0.6 },
  { left: "88%", size: 1, dur: "13s", delay: "0.3s", opacity: 0.3 },
  { left: "94%", size: 2, dur: "18s", delay: "2s", opacity: 0.5 },
];

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
  const { isConnected, isOnboarded, isHydrated } = useAuth();
  const { login: privyLogin } = useLogin();
  const { connect } = useConnect();
  const router = useRouter();
  const [searchName, setSearchName] = useState("");
  const hasPrivy = isPrivyEnabled;

  useEffect(() => { cleanupCorruptedStorage(); }, []);

  useEffect(() => {
    if (!isHydrated) return;
    if (isConnected && isOnboarded) {
      router.replace("/dashboard");
    } else if (isConnected && !isOnboarded) {
      router.replace("/onboarding");
    }
  }, [isConnected, isOnboarded, isHydrated, router]);

  const handlePaySearch = () => {
    const name = searchName.trim().toLowerCase().replace(/\.tok$/, "");
    if (!name) return;
    router.push(`/pay/${name}`);
  };

  if (!isHydrated || (isConnected && isOnboarded)) {
    return (
      <Box minH="100vh" bg="#06080F" display="flex" alignItems="center" justifyContent="center">
        <VStack gap="16px">
          <Box color={colors.accent.indigoBright} opacity={0.6}>
            <ShieldIcon size={40} />
          </Box>
          <Text fontSize="14px" color="rgba(255,255,255,0.35)">Loading...</Text>
        </VStack>
      </Box>
    );
  }

  return (
    <>
      <style>{`
        @keyframes dust-rise {
          0% { transform: translateY(0) translateX(0) scale(1); opacity: 0; }
          8% { opacity: var(--p-opacity, 0.5); }
          50% { transform: translateY(-50vh) translateX(20px) scale(1.2); }
          85% { opacity: var(--p-opacity, 0.5); }
          100% { transform: translateY(-100vh) translateX(-10px) scale(0.8); opacity: 0; }
        }
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
        bg="#06080F"
        display="flex"
        flexDirection="column"
        position="relative"
        overflow="hidden"
      >
        {/* Subtle grid overlay */}
        <Box
          position="absolute"
          inset="0"
          backgroundImage="linear-gradient(rgba(43,90,226,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(43,90,226,0.02) 1px, transparent 1px)"
          backgroundSize="80px 80px"
          pointerEvents="none"
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

        {/* Dust particles — enhanced */}
        {particles.map((p, i) => (
          <Box
            key={i}
            position="absolute"
            bottom="-4px"
            left={p.left}
            w={`${p.size}px`}
            h={`${p.size}px`}
            bg={p.size >= 3 ? "rgba(74,117,240,0.6)" : "rgba(74,117,240,0.4)"}
            borderRadius="50%"
            pointerEvents="none"
            boxShadow={p.size >= 3 ? "0 0 6px rgba(74,117,240,0.3)" : "none"}
            style={{
              animation: `dust-rise ${p.dur} linear ${p.delay} infinite`,
              ["--p-opacity" as string]: p.opacity,
            }}
          />
        ))}

        {/* Header */}
        <Box as="header" position="relative" zIndex={10} px="24px" py="24px">
          <Box maxW="1200px" mx="auto" display="flex" alignItems="center" justifyContent="space-between">
            <HStack gap="10px" align="baseline">
              <Text fontSize="22px" fontWeight="800" color="white" letterSpacing="-0.03em">
                Dust
              </Text>
              <Text
                fontSize="11px"
                fontWeight="500"
                color="rgba(255,255,255,0.3)"
                letterSpacing="0.1em"
                textTransform="uppercase"
              >
                Protocol
              </Text>
            </HStack>
            <HStack gap="6px">
              <Box w="6px" h="6px" borderRadius="50%" bg="rgba(74,117,240,0.6)" />
              <Text fontSize="12px" color="rgba(255,255,255,0.25)" fontWeight="500">
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
                <ShieldIcon size={38} />
              </Box>
            </Box>

            {/* Title + subtitle */}
            <VStack gap="20px" className="fade-up d2">
              <Text
                fontFamily={heroFont.style.fontFamily}
                fontSize={{ base: "48px", md: "64px" }}
                fontWeight={400}
                lineHeight="1.0"
                letterSpacing="-0.03em"
                bgGradient="linear(to-b, white 30%, rgba(74,117,240,0.7))"
                bgClip="text"
                color="transparent"
              >
                Private Payments
              </Text>
              <Text
                fontSize="17px"
                color="rgba(255,255,255,0.4)"
                lineHeight="1.7"
                maxW="380px"
                fontWeight="400"
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
                        bg="rgba(255,255,255,0.04)"
                        border="1px solid rgba(255,255,255,0.08)"
                        borderRadius="14px"
                        cursor="pointer"
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                        gap="8px"
                        backdropFilter="blur(12px)"
                        transition="all 0.2s ease"
                        _hover={{
                          bg: "rgba(255,255,255,0.08)",
                          borderColor: "rgba(74,117,240,0.3)",
                          transform: "translateY(-2px)",
                          boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
                        }}
                        _active={{ transform: "translateY(0)" }}
                        onClick={() => privyLogin({ loginMethods: [opt.method] })}
                      >
                        <opt.icon size={18} />
                        <Text fontSize="13px" color="rgba(255,255,255,0.7)" fontWeight="500">
                          {opt.label}
                        </Text>
                      </Box>
                    ))}
                  </HStack>

                  {/* Divider between social and wallet */}
                  <HStack w="100%" gap="16px" align="center">
                    <Box flex={1} h="1px" bg="linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)" />
                    <Text fontSize="11px" color="rgba(255,255,255,0.2)" fontWeight="500" textTransform="uppercase" letterSpacing="0.12em">
                      or
                    </Text>
                    <Box flex={1} h="1px" bg="linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)" />
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
                    bg="linear-gradient(135deg, #2B5AE2 0%, #4A75F0 50%, #633CFF 100%)"
                    borderRadius="16px"
                    cursor="pointer"
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    gap="10px"
                    position="relative"
                    transition="all 0.3s cubic-bezier(0.16,1,0.3,1)"
                    _hover={{
                      transform: "translateY(-3px)",
                      boxShadow: "0 12px 40px rgba(43,90,226,0.4), 0 0 0 1px rgba(74,117,240,0.3)",
                    }}
                    _active={{ transform: "translateY(0)" }}
                    onClick={() => connect({ connector: injected() })}
                  >
                    <WalletIcon size={20} color="white" />
                    <Text fontSize="16px" color="white" fontWeight="600" letterSpacing="-0.01em">
                      Connect Wallet
                    </Text>
                  </Box>
                </Box>
              </Box>
            </VStack>

            {/* Divider */}
            <HStack w="100%" gap="16px" align="center" className="fade-up d4">
              <Box flex={1} h="1px" bg="linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)" />
              <Text
                fontSize="11px"
                color="rgba(255,255,255,0.2)"
                fontWeight="500"
                textTransform="uppercase"
                letterSpacing="0.12em"
                whiteSpace="nowrap"
              >
                or pay someone
              </Text>
              <Box flex={1} h="1px" bg="linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)" />
            </HStack>

            {/* Pay someone search — glass style */}
            <HStack gap="8px" w="100%" maxW="380px" className="fade-up d5">
              <Input
                placeholder="username.tok"
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") handlePaySearch(); }}
                h="52px"
                flex={1}
                bgColor="rgba(255,255,255,0.03)"
                border="1px solid rgba(255,255,255,0.08)"
                borderRadius="14px"
                color="white"
                fontSize="15px"
                fontWeight={500}
                px="18px"
                backdropFilter="blur(12px)"
                _placeholder={{ color: "rgba(255,255,255,0.2)" }}
                _focus={{
                  borderColor: "rgba(74,117,240,0.4)",
                  boxShadow: "0 0 0 3px rgba(43,90,226,0.1), 0 0 20px rgba(43,90,226,0.05)",
                  bgColor: "rgba(255,255,255,0.05)",
                }}
                transition="all 0.25s ease"
              />
              <Box
                as="button"
                w="52px"
                h="52px"
                flexShrink={0}
                bg="rgba(43,90,226,0.12)"
                border="1px solid rgba(74,117,240,0.15)"
                borderRadius="14px"
                display="flex"
                alignItems="center"
                justifyContent="center"
                cursor="pointer"
                backdropFilter="blur(12px)"
                transition="all 0.2s ease"
                _hover={{
                  bg: "rgba(43,90,226,0.25)",
                  borderColor: "rgba(74,117,240,0.3)",
                  transform: "translateY(-1px)",
                }}
                onClick={handlePaySearch}
              >
                <ArrowUpRightIcon size={18} color="#4A75F0" />
              </Box>
            </HStack>

            {/* 3-step explainer — glass-morphism cards */}
            <HStack
              gap={{ base: "10px", md: "14px" }}
              w="100%"
              className="fade-up d6"
              flexDirection={{ base: "column", md: "row" }}
            >
              {[
                { icon: WalletIcon, label: "Connect", desc: "Link your wallet", color: "#4A75F0" },
                { icon: UserIcon, label: "Setup", desc: "Choose name & PIN", color: "#633CFF" },
                { icon: ZapIcon, label: "Receive", desc: "Get paid privately", color: "#22D3EE" },
              ].map((step, i) => (
                <Box
                  key={i}
                  flex={1}
                  w={{ base: "100%", md: "auto" }}
                  py={{ base: "16px", md: "24px" }}
                  px="18px"
                  bg="rgba(255,255,255,0.02)"
                  border="1px solid rgba(255,255,255,0.06)"
                  borderRadius="16px"
                  textAlign="center"
                  backdropFilter="blur(16px)"
                  position="relative"
                  overflow="hidden"
                  transition="all 0.3s cubic-bezier(0.16,1,0.3,1)"
                  _hover={{
                    bg: "rgba(255,255,255,0.04)",
                    borderColor: "rgba(255,255,255,0.1)",
                    transform: "translateY(-2px)",
                    boxShadow: `0 8px 32px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,255,255,0.05)`,
                  }}
                >
                  {/* Top accent line */}
                  <Box
                    position="absolute"
                    top="0"
                    left="20%"
                    right="20%"
                    h="1px"
                    bg={`linear-gradient(90deg, transparent, ${step.color}33, transparent)`}
                  />
                  <VStack gap="8px">
                    <Box
                      w="40px"
                      h="40px"
                      borderRadius="12px"
                      bg={`${step.color}10`}
                      border={`1px solid ${step.color}18`}
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                      color={step.color}
                      mx="auto"
                    >
                      <step.icon size={18} />
                    </Box>
                    <Text fontSize="14px" fontWeight="600" color="rgba(255,255,255,0.85)">
                      {step.label}
                    </Text>
                    <Text fontSize="12px" color="rgba(255,255,255,0.3)" lineHeight="1.4">
                      {step.desc}
                    </Text>
                  </VStack>
                </Box>
              ))}
            </HStack>

            {/* Privacy notice */}
            <HStack gap="8px" className="fade-up d7" py="4px">
              <Box color="rgba(255,255,255,0.2)" flexShrink={0}>
                <LockIcon size={12} />
              </Box>
              <Text fontSize="12px" color="rgba(255,255,255,0.2)" lineHeight="1.5">
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
              <Text fontSize="11px" color="rgba(255,255,255,0.15)" letterSpacing="0.02em">
                ERC-5564
              </Text>
            </HStack>
            <Text fontSize="11px" color="rgba(255,255,255,0.06)">·</Text>
            <HStack gap="6px">
              <Box w="4px" h="4px" borderRadius="50%" bg="rgba(99,60,255,0.3)" />
              <Text fontSize="11px" color="rgba(255,255,255,0.15)" letterSpacing="0.02em">
                ERC-6538
              </Text>
            </HStack>
          </HStack>
        </Box>
      </Box>
    </>
  );
}
