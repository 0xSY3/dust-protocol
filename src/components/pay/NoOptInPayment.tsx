"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, VStack, HStack, Spinner } from "@chakra-ui/react";
import { colors, radius } from "@/lib/design/tokens";
import { getChainConfig } from "@/config/chains";
import { useAuth } from "@/contexts/AuthContext";
import { useBalancePoller } from "@/hooks/stealth/useBalancePoller";
import { AddressDisplay } from "./AddressDisplay";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  ShieldIcon,
} from "@/components/stealth/icons";

type Status = "resolving" | "ready" | "deposit_detected" | "error";

interface NoOptInPaymentProps {
  recipientName: string;
  displayName: string;
  linkSlug?: string;
  externalPaymentSent?: boolean;
  externalPaymentAmount?: string;
}

export function NoOptInPayment({
  recipientName,
  displayName,
  linkSlug,
  externalPaymentSent,
  externalPaymentAmount,
}: NoOptInPaymentProps) {
  const { activeChainId } = useAuth();
  const symbol = getChainConfig(activeChainId).nativeCurrency.symbol;
  const [status, setStatus] = useState<Status>("resolving");
  const [stealthAddress, setStealthAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { hasDeposit, depositAmount } = useBalancePoller(
    status === "ready" ? stealthAddress : null
  );

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (linkSlug) params.set("link", linkSlug);
    const qs = params.toString();
    return `/api/resolve/${encodeURIComponent(recipientName)}${qs ? `?${qs}` : ""}`;
  }, [recipientName, linkSlug]);

  const doResolve = useCallback(async (signal?: AbortSignal) => {
    setStatus("resolving");
    setError(null);

    try {
      const res = await fetch(buildUrl(), { signal });
      const data = await res.json();

      if (signal?.aborted) return;

      if (!res.ok) {
        setError(data.error || "Failed to resolve address");
        setStatus("error");
        return;
      }

      setStealthAddress(data.stealthAddress);
      setStatus("ready");
    } catch (e) {
      if (signal?.aborted) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Failed to resolve address");
      setStatus("error");
    }
  }, [buildUrl]);

  // Resolve on mount — AbortController cancels on cleanup (handles React StrictMode)
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    doResolve(controller.signal);
    return () => { controller.abort(); };
  }, [doResolve]);

  // Retry handler (user-initiated, no abort needed)
  const handleRetry = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    doResolve(controller.signal);
  }, [doResolve]);

  // Transition to deposit_detected when balance appears or wallet flow succeeds
  useEffect(() => {
    if (hasDeposit && status === "ready") {
      setStatus("deposit_detected");
    }
  }, [hasDeposit, status]);

  useEffect(() => {
    if (externalPaymentSent && (status === "ready" || status === "resolving")) {
      setStatus("deposit_detected");
    }
  }, [externalPaymentSent, status]);

  if (status === "resolving") {
    return (
      <VStack gap="16px" py="24px">
        <Spinner size="md" color={colors.accent.indigo} />
        <Text fontSize="14px" color={colors.text.muted}>
          Generating stealth address...
        </Text>
      </VStack>
    );
  }

  if (status === "error") {
    return (
      <VStack gap="16px" py="24px">
        <AlertCircleIcon size={32} color={colors.accent.red} />
        <Text fontSize="14px" color={colors.accent.red} textAlign="center" px="8px">
          {error || "Something went wrong"}
        </Text>
        <Box
          as="button"
          px="24px"
          py="10px"
          bgColor={colors.accent.indigo}
          color="white"
          borderRadius={radius.sm}
          fontSize="14px"
          fontWeight={600}
          cursor="pointer"
          onClick={handleRetry}
          _hover={{ opacity: 0.9 }}
        >
          Retry
        </Box>
      </VStack>
    );
  }

  if (status === "deposit_detected") {
    return (
      <VStack gap="20px" py="24px">
        <Box p="16px" bgColor="rgba(43, 90, 226, 0.08)" borderRadius="50%">
          <CheckCircleIcon size={36} color={colors.accent.indigo} />
        </Box>
        <VStack gap="6px">
          <Text fontSize="20px" fontWeight={700} color={colors.text.primary}>
            Payment Received!
          </Text>
          <Text fontSize="15px" color={colors.text.secondary} fontFamily="'JetBrains Mono', monospace">
            {depositAmount !== "0" ? depositAmount : externalPaymentAmount || ""} {symbol}
          </Text>
          <Text fontSize="13px" color={colors.text.muted}>
            Sent to {displayName}
          </Text>
        </VStack>
      </VStack>
    );
  }

  // status === "ready"
  return (
    <VStack gap="20px">
      <style>{`@keyframes dust-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
      {/* Status pill */}
      <HStack
        gap="8px"
        px="14px"
        py="8px"
        bgColor="rgba(43, 90, 226, 0.06)"
        borderRadius={radius.full}
        border="1px solid rgba(43, 90, 226, 0.12)"
      >
        <Box
          w="8px"
          h="8px"
          borderRadius="50%"
          bgColor={colors.accent.indigo}
          animation="dust-pulse 2s ease-in-out infinite"
        />
        <Text fontSize="13px" color={colors.accent.indigo} fontWeight={600}>
          Waiting for payment...
        </Text>
      </HStack>

      {/* Address + QR */}
      {stealthAddress && (
        <AddressDisplay
          address={stealthAddress}
          label={`Send ${symbol} to this address`}
        />
      )}

      {/* Instructions */}
      <VStack gap="8px" w="100%">
        <HStack
          gap="8px"
          p="12px"
          bgColor="rgba(43, 90, 226, 0.04)"
          borderRadius={radius.sm}
          border="1px solid rgba(43, 90, 226, 0.1)"
          w="100%"
        >
          <Box flexShrink={0}>
            <ShieldIcon size={14} color={colors.accent.indigo} />
          </Box>
          <Text fontSize="12px" color={colors.text.tertiary}>
            This is a one-time stealth address. Send any amount of {symbol} from any wallet.
          </Text>
        </HStack>

        <Text fontSize="11px" color={colors.text.muted} textAlign="center">
          You can close this page — the address is ready to receive
        </Text>
      </VStack>
    </VStack>
  );
}
