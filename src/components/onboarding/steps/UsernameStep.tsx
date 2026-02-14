"use client";

import { useState, useEffect, ChangeEvent } from "react";
import { Box, Text, VStack, HStack, Input, Spinner } from "@chakra-ui/react";
import { Button } from "@/components/ui/button";
import { colors, radius, inputStates, buttonVariants, transitions } from "@/lib/design/tokens";
import { NAME_SUFFIX } from "@/lib/stealth";
import { useStealthName } from "@/hooks/stealth";
import { CheckCircleIcon, AlertCircleIcon } from "@/components/stealth/icons";

interface UsernameStepProps {
  onNext: (name: string) => void;
  initialName?: string;
}

export function UsernameStep({ onNext, initialName = "" }: UsernameStepProps) {
  const [nameInput, setNameInput] = useState(initialName);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const { checkAvailability, validateName, formatName, isConfigured } = useStealthName();

  useEffect(() => {
    const check = async () => {
      if (!nameInput || !isConfigured) { setIsAvailable(null); return; }
      if (!validateName(nameInput).valid) { setIsAvailable(null); return; }
      setIsChecking(true);
      const available = await checkAvailability(nameInput);
      setIsAvailable(available);
      setIsChecking(false);
    };
    const timer = setTimeout(check, 500);
    return () => clearTimeout(timer);
  }, [nameInput, isConfigured, validateName, checkAvailability]);

  const validation = nameInput ? validateName(nameInput) : null;
  const canContinue = isAvailable === true && validation?.valid;

  return (
    <VStack gap="20px" align="stretch">
      <VStack gap="4px" align="flex-start">
        <Text fontSize="20px" fontWeight={600} color="white" letterSpacing="-0.01em">
          Choose a username
        </Text>
        <Text fontSize="13px" color={colors.text.muted}>
          How others will find and pay you
        </Text>
      </VStack>

      <VStack gap="6px" align="stretch">
        <Box position="relative">
          <Input
            placeholder="yourname"
            value={nameInput}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setNameInput(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))
            }
            h="46px"
            bgColor={inputStates.default.bg}
            border={inputStates.default.border}
            borderRadius={radius.sm}
            color={inputStates.default.color}
            fontSize="15px"
            px="14px"
            pr="65px"
            fontWeight={500}
            _placeholder={{ color: inputStates.default.placeholder }}
            _focus={{
              borderColor: inputStates.focus.borderColor,
              boxShadow: inputStates.focus.boxShadow,
            }}
            transition={transitions.fast}
          />
          <Text
            position="absolute"
            right="14px"
            top="50%"
            transform="translateY(-50%)"
            fontSize="14px"
            fontWeight={500}
            color={colors.text.muted}
          >
            {NAME_SUFFIX}
          </Text>
        </Box>

        <Box h="18px" pl="2px">
          {isChecking && (
            <HStack gap="5px">
              <Spinner size="xs" color="rgba(74,117,240,0.6)" />
              <Text fontSize="12px" color="rgba(255,255,255,0.3)">Checking...</Text>
            </HStack>
          )}
          {!isChecking && isAvailable === true && nameInput && (
            <HStack gap="5px">
              <CheckCircleIcon size={12} color="#22C55E" />
              <Text fontSize="12px" color="rgba(34,197,94,0.8)" fontWeight={500}>
                {formatName(nameInput)} is available
              </Text>
            </HStack>
          )}
          {!isChecking && isAvailable === false && nameInput && (
            <HStack gap="5px">
              <AlertCircleIcon size={12} color={colors.accent.red} />
              <Text fontSize="12px" color={colors.accent.red} fontWeight={500}>
                {formatName(nameInput)} is taken
              </Text>
            </HStack>
          )}
          {!isChecking && validation && !validation.valid && nameInput && (
            <HStack gap="5px">
              <AlertCircleIcon size={12} color={colors.accent.amber} />
              <Text fontSize="12px" color={colors.accent.amber}>{validation.error}</Text>
            </HStack>
          )}
        </Box>
      </VStack>

      <Button
        w="100%"
        h="44px"
        bgColor={canContinue ? buttonVariants.primary.bg : inputStates.disabled.bg}
        borderRadius={radius.sm}
        border={canContinue ? `1px solid ${colors.border.accent}` : `1px solid ${colors.border.default}`}
        boxShadow={canContinue ? buttonVariants.primary.boxShadow : "none"}
        fontWeight={500}
        fontSize="14px"
        color={canContinue ? colors.text.primary : colors.text.muted}
        _hover={
          canContinue
            ? {
                boxShadow: buttonVariants.primary.hover.boxShadow,
                transform: buttonVariants.primary.hover.transform,
              }
            : {}
        }
        transition={transitions.fast}
        onClick={() => canContinue && onNext(nameInput)}
        disabled={!canContinue}
      >
        Continue
      </Button>
    </VStack>
  );
}
