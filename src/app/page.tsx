"use client";

import { Box, Container, VStack, Text, HStack } from "@chakra-ui/react";
import { PrivateWallet } from "@/components/stealth";
import { ConnectButton } from "@/components/ConnectButton";

export default function Home() {
  return (
    <Box minH="100vh" bg="#07070a" color="white">
      {/* Header */}
      <Box
        as="header"
        borderBottom="1px solid #2d2d3a"
        bg="rgba(13, 13, 18, 0.8)"
        backdropFilter="blur(10px)"
        position="sticky"
        top={0}
        zIndex={100}
      >
        <Container maxW="1200px" py="16px">
          <HStack justify="space-between" align="center">
            <HStack gap="12px">
              <Box
                w="36px"
                h="36px"
                borderRadius="10px"
                bg="linear-gradient(135deg, #7c7fff 0%, #5b5edd 100%)"
                display="flex"
                alignItems="center"
                justifyContent="center"
              >
                <Text fontSize="18px" fontWeight="bold">
                  ⚡
                </Text>
              </Box>
              <VStack align="flex-start" gap="0">
                <Text fontSize="16px" fontWeight="700" color="white">
                  Thanos Stealth
                </Text>
                <Text fontSize="11px" color="#6b6b7a">
                  Private Payments
                </Text>
              </VStack>
            </HStack>
            <ConnectButton />
          </HStack>
        </Container>
      </Box>

      {/* Main Content */}
      <Container maxW="520px" py="40px">
        <PrivateWallet />
      </Container>

      {/* Footer */}
      <Box
        as="footer"
        borderTop="1px solid #2d2d3a"
        py="24px"
        mt="auto"
      >
        <Container maxW="1200px">
          <HStack justify="center" gap="24px">
            <Text fontSize="12px" color="#6b6b7a">
              Powered by ERC-5564 & ERC-6538
            </Text>
            <Text fontSize="12px" color="#6b6b7a">
              •
            </Text>
            <Text fontSize="12px" color="#6b6b7a">
              Thanos Network
            </Text>
          </HStack>
        </Container>
      </Box>
    </Box>
  );
}
