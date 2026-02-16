"use client";

import { Box, Text, VStack, HStack } from "@chakra-ui/react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useAccount, useDisconnect } from "wagmi";
import { useAuth } from "@/contexts/AuthContext";
import { colors, radius, shadows, glass, buttonVariants, typography, transitions } from "@/lib/design/tokens";
import {
  GridIcon, SwapIcon, BoxIcon, WalletIcon, LinkIcon, ActivityIcon, SettingsIcon, LogOutIcon,
} from "@/components/stealth/icons";
import { DustLogo } from "@/components/DustLogo";
import { ChainSelector } from "@/components/ChainSelector";

interface NavItem {
  href: string;
  label: string;
  Icon: React.FC<{ size?: number; color?: string }>;
  disabled?: boolean;
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", Icon: GridIcon },
  { href: "/swap", label: "Privacy Swaps", Icon: SwapIcon },
  { href: "/pools", label: "Pools", Icon: BoxIcon },
  { href: "/wallet", label: "Wallet", Icon: WalletIcon },
  { href: "/links", label: "Links", Icon: LinkIcon },
  { href: "/activities", label: "Activities", Icon: ActivityIcon },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
];

export function Sidebar() {
  const pathname = usePathname();
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const { ownedNames } = useAuth();
  const displayName = ownedNames.length > 0 ? `${ownedNames[0].name}.tok` : null;

  return (
    <>
      {/* Desktop sidebar */}
      <Box
        as="nav"
        display={{ base: "none", md: "flex" }}
        flexDirection="column"
        w="240px"
        minH="100vh"
        bgColor={colors.bg.cardSolid}
        borderRight={`1px solid ${colors.border.default}`}
        position="fixed"
        left={0}
        top={0}
        zIndex={50}
      >
        {/* Logo */}
        <Box p="28px 24px 24px">
          <HStack gap="10px" align="center">
            <DustLogo size={28} color={colors.accent.indigo} />
            <Text
              fontSize="20px"
              fontWeight={800}
              color={colors.text.primary}
              fontFamily={typography.fontFamily.heading}
              letterSpacing="-0.03em"
            >
              Dust
            </Text>
            <Box
              px="7px" py="2px"
              bgColor="rgba(74,117,240,0.12)"
              border="1px solid rgba(74,117,240,0.2)"
              borderRadius={radius.xs}
            >
              <Text
                fontSize="9px"
                fontWeight={700}
                color={colors.accent.indigoBright}
                letterSpacing="0.06em"
                fontFamily={typography.fontFamily.heading}
              >
                BETA
              </Text>
            </Box>
          </HStack>
        </Box>

        {/* Chain selector */}
        <Box px="16px" pb="8px">
          <ChainSelector />
        </Box>

        {/* Nav items */}
        <VStack gap="2px" p="8px 16px" flex={1} align="stretch">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link key={item.href} href={item.href} style={{ textDecoration: "none" }}>
                <HStack
                  gap="14px"
                  p="12px 14px"
                  borderRadius={radius.sm}
                  bgColor={isActive ? glass.cardHover.bg : "transparent"}
                  border={isActive ? glass.cardHover.border : "1px solid transparent"}
                  boxShadow={isActive ? shadows.focusRing : "none"}
                  color={isActive ? colors.text.primary : colors.text.secondary}
                  _hover={{
                    bgColor: isActive ? glass.cardHover.bg : glass.card.bg,
                    color: colors.text.primary,
                    border: isActive ? glass.cardHover.border : glass.card.border,
                  }}
                  transition={transitions.fast}
                  cursor="pointer"
                >
                  <item.Icon size={20} color={isActive ? colors.accent.indigo : "currentColor"} />
                  <Text
                    fontSize="15px"
                    fontWeight={isActive ? 600 : 500}
                    fontFamily={typography.fontFamily.body}
                  >
                    {item.label}
                  </Text>
                </HStack>
              </Link>
            );
          })}
        </VStack>

        {/* Wallet + docs/social */}
        <VStack gap="8px" p="16px" borderTop={`1px solid ${colors.border.default}`}>
          {address && (
            <>
              <Box
                w="100%"
                p="10px 14px"
                bgColor={glass.input.bg}
                border={glass.input.border}
                borderRadius={radius.xs}
              >
                {displayName ? (
                  <Text
                    fontSize="13px"
                    fontWeight={600}
                    color={colors.text.primary}
                    fontFamily={typography.fontFamily.body}
                  >
                    {displayName}
                  </Text>
                ) : (
                  <Text
                    fontSize="12px"
                    color={colors.text.secondary}
                    fontFamily={typography.fontFamily.mono}
                  >
                    {address.slice(0, 8)}...{address.slice(-6)}
                  </Text>
                )}
              </Box>
              <Box
                as="button"
                p="8px 14px"
                bgColor={buttonVariants.ghost.bg}
                borderRadius={radius.xs}
                cursor="pointer"
                color={colors.text.secondary}
                _hover={{
                  bgColor: buttonVariants.danger.bg,
                  color: colors.accent.red,
                }}
                transition={transitions.fast}
                onClick={() => disconnect()}
                display="flex"
                alignItems="center"
                gap="8px"
                w="100%"
              >
                <LogOutIcon size={14} color="currentColor" />
                <Text fontSize="13px" fontWeight={500} color="currentColor">Disconnect</Text>
              </Box>
            </>
          )}
        </VStack>
      </Box>

      {/* Mobile bottom nav */}
      <Box
        display={{ base: "flex", md: "none" }}
        position="fixed"
        bottom={0}
        left={0}
        right={0}
        bgColor={colors.bg.cardSolid}
        borderTop={`1px solid ${colors.border.default}`}
        boxShadow="0 -4px 16px rgba(0,0,0,0.4), 0 -1px 4px rgba(0,0,0,0.3)"
        zIndex={50}
        justifyContent="space-around"
        p="10px 0 env(safe-area-inset-bottom, 8px)"
      >
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link key={item.href} href={item.href} style={{ textDecoration: "none" }}>
              <VStack
                gap="4px"
                p="6px 14px"
                align="center"
                cursor="pointer"
                borderRadius={radius.xs}
                transition={transitions.fast}
                _hover={{ bgColor: glass.card.bg }}
              >
                <Box
                  position="relative"
                >
                  <item.Icon size={22} color={isActive ? colors.accent.indigo : colors.text.tertiary} />
                  {isActive && (
                    <Box
                      position="absolute"
                      bottom="-6px"
                      left="50%"
                      transform="translateX(-50%)"
                      w="4px"
                      h="4px"
                      borderRadius={radius.full}
                      bgColor={colors.accent.indigo}
                      boxShadow="0 0 6px rgba(74,117,240,0.5)"
                    />
                  )}
                </Box>
                <Text
                  fontSize="10px"
                  fontWeight={isActive ? 600 : 400}
                  color={isActive ? colors.accent.indigo : colors.text.tertiary}
                  fontFamily={typography.fontFamily.body}
                >
                  {item.label}
                </Text>
              </VStack>
            </Link>
          );
        })}
      </Box>
    </>
  );
}
