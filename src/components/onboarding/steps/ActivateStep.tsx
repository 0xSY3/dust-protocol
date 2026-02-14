"use client";

import { useState } from "react";
import { Box, Text, VStack, HStack, Spinner } from "@chakra-ui/react";
import { Button } from "@/components/ui/button";
import { colors } from "@/lib/design/tokens";
import { useAuth } from "@/contexts/AuthContext";
import { CheckCircleIcon, AlertCircleIcon } from "@/components/stealth/icons";

interface ActivateStepProps {
  username: string;
  pin: string;
  onComplete: () => void;
}

type ActivationStatus = "idle" | "signing" | "activating" | "done" | "error";

export function ActivateStep({ username, pin, onComplete }: ActivateStepProps) {
  const { deriveKeysFromWallet, setPin: storePinEncrypted, registerMetaAddress, registerName, formatName } = useAuth();
  const [status, setStatus] = useState<ActivationStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const handleActivate = async () => {
    setStatus("signing");
    setError(null);

    try {
      const sig = await deriveKeysFromWallet(pin);
      if (!sig) throw new Error("Please approve the signature in your wallet");

      setStatus("activating");

      const pinStored = await storePinEncrypted(pin, sig);
      if (!pinStored) throw new Error("Failed to store PIN");

      const { deriveStealthKeyPairFromSignatureAndPin, formatStealthMetaAddress } = await import("@/lib/stealth");
      const keys = deriveStealthKeyPairFromSignatureAndPin(sig, pin);
      const freshMetaAddress = formatStealthMetaAddress(keys, "thanos");

      const [nameTx] = await Promise.all([
        registerName(username, freshMetaAddress),
        registerMetaAddress().catch(() => null),
      ]);
      if (!nameTx) throw new Error("Failed to register name");

      setStatus("done");
      onComplete();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Activation failed";
      setError(msg);
      setStatus("error");
    }
  };

  return (
    <VStack gap="20px" align="stretch">
      <VStack gap="4px" align="flex-start">
        <Text fontSize="20px" fontWeight={600} color="white" letterSpacing="-0.01em">
          Activate your wallet
        </Text>
        <Text fontSize="13px" color="rgba(255,255,255,0.35)">
          Review and activate your private identity
        </Text>
      </VStack>

      {/* Summary */}
      <VStack
        gap="0"
        align="stretch"
        bgColor="rgba(0,0,0,0.25)"
        borderRadius="10px"
        border="1px solid rgba(255,255,255,0.08)"
        overflow="hidden"
      >
        <HStack justify="space-between" px="16px" py="12px">
          <Text fontSize="13px" color="rgba(255,255,255,0.35)">Username</Text>
          <Text fontSize="13px" fontWeight={500} color="rgba(74,117,240,0.8)">
            {formatName(username)}
          </Text>
        </HStack>
        <Box h="1px" bgColor="rgba(255,255,255,0.05)" />
        <HStack justify="space-between" px="16px" py="12px">
          <Text fontSize="13px" color="rgba(255,255,255,0.35)">PIN</Text>
          <Text fontSize="13px" fontWeight={500} color="rgba(255,255,255,0.5)" letterSpacing="2px">
            ••••••
          </Text>
        </HStack>
      </VStack>

      {/* Status */}
      {(status === "signing" || status === "activating") && (
        <HStack gap="8px" justify="center" py="8px">
          <Spinner size="sm" color="rgba(74,117,240,0.6)" />
          <Text fontSize="13px" color="rgba(255,255,255,0.5)">
            {status === "signing" ? "Approve in wallet..." : "Setting up identity..."}
          </Text>
        </HStack>
      )}
      {status === "done" && (
        <HStack gap="6px" justify="center" py="8px">
          <CheckCircleIcon size={14} color="#22C55E" />
          <Text fontSize="13px" color="rgba(34,197,94,0.8)" fontWeight={500}>Activated</Text>
        </HStack>
      )}

      {/* Error */}
      {error && (
        <HStack gap="6px" pl="2px">
          <AlertCircleIcon size={12} color={colors.accent.red} />
          <Text fontSize="12px" color={colors.accent.red}>{error}</Text>
        </HStack>
      )}

      {/* CTA */}
      {(status === "idle" || status === "error") && (
        <Button
          w="100%"
          h="44px"
          bgColor="rgba(74,117,240,0.08)"
          borderRadius="10px"
          border="1px solid rgba(74,117,240,0.35)"
          boxShadow="0 0 12px rgba(74,117,240,0.06)"
          fontWeight={500}
          fontSize="14px"
          color="rgba(255,255,255,0.9)"
          _hover={{
            bgColor: "rgba(74,117,240,0.12)",
            borderColor: "rgba(74,117,240,0.5)",
            boxShadow: "0 0 20px rgba(74,117,240,0.1)",
          }}
          transition="all 0.15s ease"
          onClick={handleActivate}
        >
          Activate
        </Button>
      )}
    </VStack>
  );
}
