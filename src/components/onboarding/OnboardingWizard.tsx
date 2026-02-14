"use client";

import { useState } from "react";
import { Box, HStack } from "@chakra-ui/react";
import { colors, radius, shadows, transitions } from "@/lib/design/tokens";
import { useRouter } from "next/navigation";
import { UsernameStep } from "./steps/UsernameStep";
import { PinStep } from "./steps/PinStep";
import { ActivateStep } from "./steps/ActivateStep";

type Step = "username" | "pin" | "activate";
const STEPS: Step[] = ["username", "pin", "activate"];

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("username");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");

  const currentIndex = STEPS.indexOf(step);

  return (
    <Box w="100%" maxW="420px" mx="auto">
      <Box
        borderRadius={radius.lg}
        bg={colors.bg.cardSolid}
        border={`1px solid ${colors.border.default}`}
        borderTop={`1px solid ${colors.border.light}`}
        boxShadow={shadows.modal}
        overflow="hidden"
      >
        {/* Dots */}
        <HStack gap="6px" justify="center" pt="20px">
          {STEPS.map((_, i) => (
            <Box
              key={i}
              w="6px"
              h="6px"
              borderRadius="full"
              bg={
                i < currentIndex
                  ? "rgba(74,117,240,0.5)"
                  : i === currentIndex
                  ? "rgba(255,255,255,0.8)"
                  : "rgba(255,255,255,0.1)"
              }
              transition={transitions.spring}
            />
          ))}
        </HStack>

        {/* Content */}
        <Box px={{ base: "28px", md: "36px" }} pt="24px" pb="32px">
          {step === "username" && (
            <UsernameStep
              onNext={(name) => { setUsername(name); setStep("pin"); }}
              initialName={username}
            />
          )}
          {step === "pin" && (
            <PinStep onNext={(p) => { setPin(p); setStep("activate"); }} />
          )}
          {step === "activate" && (
            <ActivateStep
              username={username}
              pin={pin}
              onComplete={() => router.replace("/dashboard")}
            />
          )}
        </Box>
      </Box>
    </Box>
  );
}
