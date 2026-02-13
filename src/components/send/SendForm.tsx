"use client";

import { useState, useEffect, ChangeEvent } from "react";
import { Box, Text, VStack, HStack, Input, Spinner } from "@chakra-ui/react";
import { Button } from "@/components/ui/button";
import { colors, radius, getExplorerBase } from "@/lib/design/tokens";
import { getChainConfig } from "@/config/chains";
import { getTokensForChain, NATIVE_TOKEN_ADDRESS, type TokenConfig } from "@/config/tokens";
import { useStealthSend, useStealthName } from "@/hooks/stealth";
import { isStealthName, NAME_SUFFIX } from "@/lib/stealth";
import { useAuth } from "@/contexts/AuthContext";
import { AlertCircleIcon as AlertIcon } from "@/components/stealth/icons";
import {
  CheckCircleIcon, AlertCircleIcon, LockIcon, ArrowUpRightIcon,
} from "@/components/stealth/icons";

export function SendForm() {
  const { activeChainId } = useAuth();
  const chainConfig = getChainConfig(activeChainId);
  const symbol = chainConfig.nativeCurrency.symbol;
  const tokens = getTokensForChain(activeChainId);
  const { generateAddressFor, sendEthToStealth, sendTokenToStealth, lastGeneratedAddress, isLoading, error: sendError } = useStealthSend();
  const { resolveName, isConfigured: nameRegistryConfigured } = useStealthName();

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedToken, setSelectedToken] = useState<string>(NATIVE_TOKEN_ADDRESS);
  const [sendStep, setSendStep] = useState<"input" | "confirm" | "success">("input");
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [resolvedLinkSlug, setResolvedLinkSlug] = useState<string | undefined>(undefined);
  const [isResolving, setIsResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [sendTxHash, setSendTxHash] = useState<string | null>(null);

  const isNativeToken = selectedToken === NATIVE_TOKEN_ADDRESS;
  const selectedTokenConfig: TokenConfig | undefined = tokens.find(t => t.address === selectedToken);
  const displaySymbol = isNativeToken ? symbol : (selectedTokenConfig?.symbol ?? symbol);

  useEffect(() => {
    const resolve = async () => {
      setResolveError(null);
      setResolvedLinkSlug(undefined);
      if (!recipient) { setResolvedAddress(null); return; }
      if (recipient.startsWith("st:")) { setResolvedAddress(recipient); return; }
      if (nameRegistryConfigured && isStealthName(recipient)) {
        setIsResolving(true);
        let nameToResolve = recipient;
        const normalized = recipient.toLowerCase().trim();
        if (normalized.endsWith(NAME_SUFFIX)) {
          const withoutSuffix = normalized.slice(0, -NAME_SUFFIX.length);
          const parts = withoutSuffix.split(".");
          if (parts.length > 1) {
            nameToResolve = parts[parts.length - 1] + NAME_SUFFIX;
            setResolvedLinkSlug(parts[0]);
          }
        }
        const resolved = await resolveName(nameToResolve);
        setIsResolving(false);
        if (resolved) {
          setResolvedAddress(`st:thanos:${resolved}`);
        } else {
          setResolvedAddress(null);
          setResolvedLinkSlug(undefined);
          setResolveError(`Name "${nameToResolve.replace(NAME_SUFFIX, "")}" not found`);
        }
        return;
      }
      setResolvedAddress(null);
    };
    const t = setTimeout(resolve, 300);
    return () => clearTimeout(t);
  }, [recipient, nameRegistryConfigured, resolveName]);

  const handlePreview = () => {
    const addr = resolvedAddress || recipient;
    if (!addr || !amount) return;
    if (generateAddressFor(addr)) setSendStep("confirm");
  };

  const handleSend = async () => {
    const addr = resolvedAddress || recipient;
    let hash: string | null;
    if (isNativeToken) {
      hash = await sendEthToStealth(addr, amount, resolvedLinkSlug);
    } else {
      hash = await sendTokenToStealth(addr, selectedToken, amount);
    }
    if (hash) { setSendTxHash(hash); setSendStep("success"); }
  };

  const reset = () => {
    setRecipient(""); setAmount(""); setSelectedToken(NATIVE_TOKEN_ADDRESS); setSendStep("input");
    setSendTxHash(null); setResolvedAddress(null); setResolvedLinkSlug(undefined); setResolveError(null);
  };

  return (
    <VStack gap="20px" align="stretch">
      {sendStep === "input" && (
        <>
          <VStack gap="4px" align="flex-start">
            <Text fontSize="16px" fontWeight={600} color={colors.text.primary}>Send Private Payment</Text>
            <Text fontSize="13px" color={colors.text.muted}>Only the recipient can access these funds</Text>
          </VStack>
          <VStack gap="16px" align="stretch">
            <Box>
              <Text fontSize="12px" color={colors.text.tertiary} mb="8px" fontWeight={500}>Recipient</Text>
              <Input placeholder={`alice${NAME_SUFFIX} or st:thanos:0x...`} value={recipient}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setRecipient(e.target.value)}
                h="48px" bgColor={colors.bg.input} border={`1px solid ${colors.border.default}`}
                borderRadius={radius.sm} color={colors.text.primary} fontSize="14px" px="14px"
                _placeholder={{ color: colors.text.muted }}
                _focus={{ borderColor: colors.accent.indigo, boxShadow: colors.glow.indigo }} />
              <Box h="20px" mt="6px">
                {isResolving && <HStack gap="5px"><Spinner size="xs" color={colors.text.muted} /><Text fontSize="11px" color={colors.text.muted}>Resolving...</Text></HStack>}
                {!isResolving && resolvedAddress && !recipient.startsWith("st:") && (
                  <HStack gap="5px"><CheckCircleIcon size={11} color={colors.accent.green} /><Text fontSize="11px" color={colors.accent.green}>Resolved: {resolvedAddress.slice(0, 28)}...</Text></HStack>
                )}
                {!isResolving && resolveError && (
                  <HStack gap="5px"><AlertIcon size={11} color={colors.accent.red} /><Text fontSize="11px" color={colors.accent.red}>{resolveError}</Text></HStack>
                )}
              </Box>
            </Box>
            {tokens.length > 0 && (
              <Box>
                <Text fontSize="12px" color={colors.text.tertiary} mb="8px" fontWeight={500}>Token</Text>
                <HStack gap="6px" flexWrap="wrap">
                  <Box as="button" px="12px" py="6px" borderRadius={radius.xs} fontSize="13px" fontWeight={500}
                    bgColor={isNativeToken ? colors.accent.indigoDark : colors.bg.input}
                    color={isNativeToken ? "#fff" : colors.text.secondary}
                    border={`1px solid ${isNativeToken ? colors.accent.indigo : colors.border.default}`}
                    cursor="pointer" transition="all 0.15s"
                    onClick={() => setSelectedToken(NATIVE_TOKEN_ADDRESS)}>
                    {symbol}
                  </Box>
                  {tokens.map(t => {
                    const isActive = selectedToken === t.address;
                    return (
                      <Box as="button" key={t.address} px="12px" py="6px" borderRadius={radius.xs}
                        fontSize="13px" fontWeight={500}
                        bgColor={isActive ? colors.accent.indigoDark : colors.bg.input}
                        color={isActive ? "#fff" : colors.text.secondary}
                        border={`1px solid ${isActive ? colors.accent.indigo : colors.border.default}`}
                        cursor="pointer" transition="all 0.15s"
                        onClick={() => setSelectedToken(t.address)}>
                        {t.symbol}
                      </Box>
                    );
                  })}
                </HStack>
              </Box>
            )}
            <Box>
              <Text fontSize="12px" color={colors.text.tertiary} mb="8px" fontWeight={500}>Amount</Text>
              <Input placeholder="0.0" type="number" step="0.001" value={amount}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
                h="56px" bgColor={colors.bg.input} border={`1px solid ${colors.border.default}`}
                borderRadius={radius.sm} color={colors.text.primary} fontSize="24px" fontWeight={500}
                fontFamily="'JetBrains Mono', monospace" px="14px"
                _placeholder={{ color: colors.text.muted }}
                _focus={{ borderColor: colors.accent.indigo, boxShadow: colors.glow.indigo }} />
              <Text fontSize="11px" color={colors.text.muted} mt="6px">{displaySymbol} on {chainConfig.name}</Text>
            </Box>
          </VStack>
          <Button h="48px" bgColor={colors.accent.indigoDark} borderRadius={radius.sm}
            fontWeight={500} fontSize="14px" color="#fff" _hover={{ bgColor: colors.accent.indigo }}
            onClick={handlePreview}
            disabled={(!resolvedAddress && !recipient.startsWith("st:")) || !amount || isLoading || isResolving}>
            Preview Payment
          </Button>
        </>
      )}

      {sendStep === "confirm" && lastGeneratedAddress && (
        <>
          <Box p="20px" bgColor={colors.bg.input} borderRadius={radius.md} border={`1px solid ${colors.border.default}`}>
            <VStack gap="16px" align="stretch">
              <HStack justify="space-between">
                <Text fontSize="13px" color={colors.text.muted}>Amount</Text>
                <Text fontSize="18px" fontWeight={600} color={colors.text.primary} fontFamily="'JetBrains Mono', monospace">{amount} {displaySymbol}</Text>
              </HStack>
              <Box h="1px" bgColor={colors.border.default} />
              <HStack justify="space-between">
                <Text fontSize="13px" color={colors.text.muted}>To</Text>
                <Text fontSize="13px" color={colors.text.primary} fontFamily="'JetBrains Mono', monospace">
                  {recipient.includes(".tok") ? recipient : `${recipient.slice(0, 14)}...`}
                </Text>
              </HStack>
            </VStack>
          </Box>
          <HStack gap="10px" p="14px" bgColor="rgba(52, 211, 153, 0.04)" borderRadius={radius.sm} border="1px solid rgba(52, 211, 153, 0.1)">
            <LockIcon size={16} color={colors.accent.green} />
            <Text fontSize="12px" color={colors.text.tertiary}>This payment is private.</Text>
          </HStack>
          <HStack gap="10px">
            <Button flex={1} h="44px" bgColor={colors.bg.elevated} borderRadius={radius.sm}
              border={`1px solid ${colors.border.default}`} fontWeight={500} fontSize="13px"
              color={colors.text.primary} _hover={{ bgColor: colors.bg.hover }}
              onClick={() => setSendStep("input")}>Back</Button>
            <Button flex={2} h="44px" bgColor={colors.accent.indigoDark} borderRadius={radius.sm}
              fontWeight={500} fontSize="13px" color="#fff" _hover={{ bgColor: colors.accent.indigo }}
              onClick={handleSend} disabled={isLoading}>
              {isLoading ? <Spinner size="sm" /> : "Send Payment"}
            </Button>
          </HStack>
        </>
      )}

      {sendStep === "success" && (
        <VStack gap="24px" py="28px">
          <Box p="16px" bgColor="rgba(52, 211, 153, 0.08)" borderRadius="50%">
            <CheckCircleIcon size={32} color={colors.accent.green} />
          </Box>
          <VStack gap="6px">
            <Text fontSize="18px" fontWeight={600} color={colors.text.primary}>Payment Sent</Text>
            <Text fontSize="13px" color={colors.text.muted} textAlign="center">{amount} {displaySymbol} sent privately</Text>
          </VStack>
          {sendTxHash && (
            <a href={`${getExplorerBase(activeChainId)}/tx/${sendTxHash}`} target="_blank" rel="noopener noreferrer">
              <HStack gap="6px" px="12px" py="6px" bgColor={colors.bg.elevated} borderRadius={radius.xs}
                border={`1px solid ${colors.border.light}`} _hover={{ borderColor: colors.accent.indigo }}>
                <ArrowUpRightIcon size={13} color={colors.accent.indigo} />
                <Text fontSize="12px" color={colors.accent.indigo} fontWeight={500}>View on Explorer</Text>
              </HStack>
            </a>
          )}
          <Button h="44px" px="28px" bgColor={colors.accent.indigoDark} borderRadius={radius.sm}
            fontWeight={500} fontSize="13px" color="#fff" _hover={{ bgColor: colors.accent.indigo }}
            onClick={reset}>Send Another</Button>
        </VStack>
      )}

      {sendError && (
        <HStack gap="6px" p="12px 14px" bgColor="rgba(248, 113, 113, 0.08)" borderRadius={radius.xs}>
          <AlertCircleIcon size={14} color={colors.accent.red} />
          <Text fontSize="12px" color={colors.accent.red}>{sendError}</Text>
        </HStack>
      )}
    </VStack>
  );
}
