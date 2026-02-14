"use client";

import { useState, useRef, useEffect, KeyboardEvent, ChangeEvent } from "react";
import { Box, Text, VStack, HStack, Input } from "@chakra-ui/react";
import { Button } from "@/components/ui/button";
import { colors, radius, inputStates, buttonVariants, transitions } from "@/lib/design/tokens";
import { AlertCircleIcon } from "@/components/stealth/icons";

interface PinStepProps {
  onNext: (pin: string) => void;
}

function PinInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (value === "") refs.current[0]?.focus();
  }, [value]);

  const handleChange = (index: number, digit: string) => {
    if (!/^\d?$/.test(digit)) return;
    const arr = value.split("");
    arr[index] = digit;
    const newVal = arr.join("").slice(0, 6);
    onChange(newVal);
    if (digit && index < 5) refs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !value[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  };

  return (
    <HStack gap="8px" justify="center">
      {Array.from({ length: 6 }).map((_, i) => (
        <Input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={1}
          value={value[i] || ""}
          onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange(i, e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => handleKeyDown(i, e)}
          w="44px"
          h="52px"
          textAlign="center"
          fontSize="20px"
          fontWeight={600}
          bgColor={inputStates.default.bg}
          border={`1px solid ${value[i] ? "rgba(255,255,255,0.15)" : colors.border.default}`}
          borderRadius={radius.sm}
          color={inputStates.default.color}
          css={{ WebkitTextSecurity: "disc" }}
          _focus={{
            borderColor: inputStates.focus.borderColor,
            boxShadow: inputStates.focus.boxShadow,
          }}
          transition={transitions.fast}
        />
      ))}
    </HStack>
  );
}

export function PinStep({ onNext }: PinStepProps) {
  const [step, setStep] = useState<"create" | "confirm">("create");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleCreateNext = () => {
    if (pin.length !== 6) { setError("PIN must be 6 digits"); return; }
    setError(null);
    setStep("confirm");
    setConfirmPin("");
  };

  const handleConfirm = () => {
    if (confirmPin !== pin) {
      setError("PINs do not match");
      setConfirmPin("");
      return;
    }
    setError(null);
    onNext(pin);
  };

  const isReady = step === "create" ? pin.length === 6 : confirmPin.length === 6;

  return (
    <VStack gap="20px" align="stretch">
      <VStack gap="4px" align="flex-start">
        <Text fontSize="20px" fontWeight={600} color="white" letterSpacing="-0.01em">
          {step === "create" ? "Create a PIN" : "Confirm your PIN"}
        </Text>
        <Text fontSize="13px" color={colors.text.muted}>
          {step === "create"
            ? "Your PIN + wallet signature creates your stealth keys"
            : "Enter the same PIN to confirm"}
        </Text>
      </VStack>

      {step === "create" ? (
        <PinInput value={pin} onChange={setPin} />
      ) : (
        <PinInput value={confirmPin} onChange={setConfirmPin} />
      )}

      {error && (
        <HStack gap="6px" pl="2px">
          <AlertCircleIcon size={12} color={colors.accent.red} />
          <Text fontSize="12px" color={colors.accent.red}>{error}</Text>
        </HStack>
      )}

      <HStack gap="10px">
        {step === "confirm" && (
          <Button
            flex={1}
            h="44px"
            bg={buttonVariants.secondary.bg}
            borderRadius={radius.sm}
            border={buttonVariants.secondary.border}
            fontWeight={500}
            fontSize="14px"
            color={colors.text.secondary}
            _hover={{
              bg: buttonVariants.secondary.hover.bg,
              borderColor: buttonVariants.secondary.hover.borderColor,
            }}
            transition={transitions.fast}
            onClick={() => { setStep("create"); setPin(""); setConfirmPin(""); setError(null); }}
          >
            Back
          </Button>
        )}
        <Button
          flex={2}
          h="44px"
          bgColor={isReady ? buttonVariants.primary.bg : inputStates.disabled.bg}
          borderRadius={radius.sm}
          border={isReady ? `1px solid ${colors.border.accent}` : `1px solid ${colors.border.default}`}
          boxShadow={isReady ? buttonVariants.primary.boxShadow : "none"}
          fontWeight={500}
          fontSize="14px"
          color={isReady ? colors.text.primary : colors.text.muted}
          _hover={
            isReady
              ? {
                  boxShadow: buttonVariants.primary.hover.boxShadow,
                  transform: buttonVariants.primary.hover.transform,
                }
              : {}
          }
          transition={transitions.fast}
          onClick={step === "create" ? handleCreateNext : handleConfirm}
          disabled={!isReady}
        >
          {step === "create" ? "Continue" : "Confirm"}
        </Button>
      </HStack>

      <Text fontSize="11px" color={colors.text.muted} lineHeight="1.4">
        This PIN cannot be recovered. You would need to create a new identity.
      </Text>
    </VStack>
  );
}
