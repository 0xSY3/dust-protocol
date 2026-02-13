"use client";

import { Box, Text, HStack, VStack } from "@chakra-ui/react";
import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getSupportedChains, type ChainConfig } from "@/config/chains";
import { colors, radius } from "@/lib/design/tokens";
import { ChainIcon as ChainTokenIcon } from "@/components/stealth/icons";

const chains = getSupportedChains();

function ChainIcon({ chain, size = 20 }: { chain: ChainConfig; size?: number }) {
  return <ChainTokenIcon size={size} chainId={chain.id} />;
}

export function ChainSelector() {
  const { activeChainId, setActiveChain } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeChain = chains.find(c => c.id === activeChainId) || chains[0];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <Box ref={dropdownRef} position="relative" w="100%">
      <HStack
        as="button"
        w="100%"
        p="10px 14px"
        gap="10px"
        bgColor={colors.bg.input}
        borderRadius={radius.xs}
        border={`1px solid ${isOpen ? colors.accent.indigo : colors.border.default}`}
        cursor="pointer"
        _hover={{ borderColor: colors.accent.indigo }}
        transition="all 0.15s ease"
        onClick={() => setIsOpen(!isOpen)}
      >
        <ChainIcon chain={activeChain} />
        <Text fontSize="13px" fontWeight={500} color={colors.text.primary} flex={1} textAlign="left">
          {activeChain.name}
        </Text>
        <Text fontSize="10px" color={colors.text.muted} transform={isOpen ? "rotate(180deg)" : "none"} transition="transform 0.15s">
          ▼
        </Text>
      </HStack>

      {isOpen && (
        <VStack
          position="absolute"
          top="calc(100% + 4px)"
          left={0}
          right={0}
          bgColor={colors.bg.card}
          border={`1px solid ${colors.border.default}`}
          borderRadius={radius.xs}
          boxShadow="0 4px 12px rgba(0,0,0,0.08)"
          zIndex={100}
          p="4px"
          gap="2px"
          align="stretch"
        >
          {chains.map(chain => {
            const isActive = chain.id === activeChainId;
            return (
              <HStack
                key={chain.id}
                as="button"
                p="10px 12px"
                gap="10px"
                borderRadius={radius.xs}
                bgColor={isActive ? "rgba(43, 90, 226, 0.06)" : "transparent"}
                _hover={{ bgColor: isActive ? "rgba(43, 90, 226, 0.06)" : colors.bg.input }}
                cursor="pointer"
                transition="all 0.1s"
                onClick={() => {
                  setActiveChain(chain.id);
                  setIsOpen(false);
                }}
              >
                <ChainIcon chain={chain} />
                <VStack gap="0px" align="start" flex={1}>
                  <Text fontSize="13px" fontWeight={isActive ? 600 : 400} color={colors.text.primary}>
                    {chain.name}
                  </Text>
                  <Text fontSize="11px" color={colors.text.muted}>
                    {chain.nativeCurrency.symbol}
                  </Text>
                </VStack>
                {isActive && (
                  <Text fontSize="11px" color={colors.accent.indigo} fontWeight={600}>
                    Active
                  </Text>
                )}
              </HStack>
            );
          })}
        </VStack>
      )}
    </Box>
  );
}
