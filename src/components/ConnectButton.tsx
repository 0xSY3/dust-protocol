"use client";

import { Box, Text, HStack } from "@chakra-ui/react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { colors, radius, buttonVariants, transitions } from "@/lib/design/tokens";

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <HStack gap="12px">
        <Box
          px="14px"
          py="8px"
          bgColor={colors.bg.input}
          borderRadius={radius.xs}
          border={`1px solid ${colors.border.default}`}
        >
          <Text fontSize="13px" color={colors.text.tertiary} fontFamily="'JetBrains Mono', monospace">
            {address.slice(0, 6)}...{address.slice(-4)}
          </Text>
        </Box>
        <Box
          as="button"
          px="16px"
          py="8px"
          bgColor={colors.bg.elevated}
          borderRadius={radius.xs}
          border={`1px solid ${colors.border.default}`}
          cursor="pointer"
          _hover={{ bgColor: colors.bg.hover, borderColor: colors.accent.red }}
          transition={transitions.fast}
          onClick={() => disconnect()}
        >
          <Text fontSize="13px" color={colors.accent.red} fontWeight="500">
            Disconnect
          </Text>
        </Box>
      </HStack>
    );
  }

  return (
    <Box
      as="button"
      px="20px"
      py="10px"
      bg={buttonVariants.primary.bg}
      boxShadow={buttonVariants.primary.boxShadow}
      borderRadius={radius.sm}
      cursor="pointer"
      _hover={{ boxShadow: buttonVariants.primary.hover.boxShadow, transform: buttonVariants.primary.hover.transform }}
      _active={{ transform: buttonVariants.primary.active.transform }}
      transition={transitions.fast}
      onClick={() => connect({ connector: injected() })}
    >
      <Text fontSize="14px" color="white" fontWeight="600">
        Connect Wallet
      </Text>
    </Box>
  );
}
