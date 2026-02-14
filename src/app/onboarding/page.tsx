"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Box, Text, HStack } from "@chakra-ui/react";
import { useAuth } from "@/contexts/AuthContext";
import { ConnectButton } from "@/components/ConnectButton";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { DustLogo } from "@/components/DustLogo";
import { FlickeringGrid } from "@/components/FlickeringGrid";

export default function OnboardingPage() {
  const { isConnected, isOnboarded, isHydrated, address } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isHydrated) return;
    if (!isConnected) router.replace("/");
    // Wait for address before checking isOnboarded — avoids flash of onboarding wizard
    // when wallet is connected but address hasn't populated yet
    if (isConnected && !address) return;
    if (isOnboarded) router.replace("/dashboard");
  }, [isConnected, isOnboarded, isHydrated, address, router]);

  if (!isConnected || !isHydrated) return null;

  return (
    <>
      <style>{`
        @keyframes wizard-enter {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .wizard-enter {
          animation: wizard-enter 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>

      <Box minH="100vh" bg="#06080F" color="white" display="flex" flexDirection="column" position="relative" overflow="hidden">
        <FlickeringGrid
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            zIndex: 0,
            maskImage: "radial-gradient(ellipse 80% 60% at 50% 45%, white, transparent)",
            WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 45%, white, transparent)",
          }}
          squareSize={5}
          gridGap={6}
          color="#4A75F0"
          maxOpacity={0.25}
          flickerChance={0.3}
        />

        {/* Ambient glow — centered on page */}
        <Box
          position="absolute"
          top="45%"
          left="50%"
          transform="translate(-50%, -50%)"
          w="800px"
          h="600px"
          borderRadius="50%"
          bg="radial-gradient(ellipse, rgba(43,90,226,0.06) 0%, rgba(74,117,240,0.02) 40%, transparent 70%)"
          pointerEvents="none"
        />

        {/* Header */}
        <Box
          as="header"
          borderBottom="1px solid rgba(255,255,255,0.06)"
          bg="rgba(6,8,15,0.8)"
          backdropFilter="blur(12px)"
          position="relative"
          zIndex={100}
          px="24px"
          py="16px"
        >
          <HStack justify="space-between" align="center" maxW="1200px" mx="auto">
            <HStack gap="10px" align="center">
              <DustLogo size={26} color="#4A75F0" />
              <Text fontSize="22px" fontWeight="800" color="white" letterSpacing="-0.02em">
                Dust
              </Text>
              <Text fontSize="13px" fontWeight="500" color="rgba(255,255,255,0.35)">
                Protocol
              </Text>
            </HStack>
            <ConnectButton />
          </HStack>
        </Box>

        {/* Wizard — centered in remaining space */}
        <Box
          flex="1"
          display="flex"
          alignItems="center"
          justifyContent="center"
          px="20px"
          py="32px"
          position="relative"
          zIndex={10}
          className="wizard-enter"
        >
          <OnboardingWizard />
        </Box>
      </Box>
    </>
  );
}
