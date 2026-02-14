"use client";

import { Box, Text, VStack, HStack } from "@chakra-ui/react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useAccount, useDisconnect } from "wagmi";
import { useAuth } from "@/contexts/AuthContext";
import { colors, radius, shadows } from "@/lib/design/tokens";
import {
  GridIcon, LinkIcon, ActivityIcon, SettingsIcon, LogOutIcon, StarIcon,
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
        bgColor={colors.bg.card}
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
            <Text fontSize="20px" fontWeight={800} color={colors.text.primary} letterSpacing="-0.03em">
              Dust
            </Text>
            <Box
              px="7px" py="2px"
              bgColor="rgba(43, 90, 226, 0.08)"
              borderRadius={radius.xs}
            >
              <Text fontSize="9px" fontWeight={700} color={colors.accent.indigo} letterSpacing="0.06em">
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
                  color={isActive ? colors.text.primary : colors.text.muted}
                  _hover={{ color: colors.text.primary }}
                  transition="all 0.15s ease"
                  cursor="pointer"
                >
                  <item.Icon size={20} color={isActive ? colors.text.primary : colors.text.muted} />
                  <Text fontSize="15px" fontWeight={isActive ? 700 : 500}>{item.label}</Text>
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
                bgColor={colors.bg.input}
                borderRadius={radius.xs}
              >
                {displayName ? (
                  <Text fontSize="13px" fontWeight={600} color={colors.text.primary}>
                    {displayName}
                  </Text>
                ) : (
                  <Text fontSize="12px" color={colors.text.muted} fontFamily="'JetBrains Mono', monospace">
                    {address.slice(0, 8)}...{address.slice(-6)}
                  </Text>
                )}
              </Box>
              <Box
                as="button"
                p="8px 14px"
                bgColor="transparent"
                borderRadius={radius.xs}
                cursor="pointer"
                _hover={{ color: colors.accent.red }}
                onClick={() => disconnect()}
                display="flex"
                alignItems="center"
                gap="8px"
                w="100%"
              >
                <LogOutIcon size={14} color={colors.text.muted} />
                <Text fontSize="13px" color={colors.text.muted} fontWeight={400}>Disconnect</Text>
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
        bgColor={colors.bg.card}
        borderTop={`1px solid ${colors.border.default}`}
        boxShadow="0 -2px 8px rgba(0, 0, 0, 0.04)"
        zIndex={50}
        justifyContent="space-around"
        p="10px 0 env(safe-area-inset-bottom, 8px)"
      >
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link key={item.href} href={item.href} style={{ textDecoration: "none" }}>
              <VStack gap="4px" p="6px 14px" align="center" cursor="pointer">
                <item.Icon size={22} color={isActive ? colors.accent.indigo : colors.text.muted} />
                <Text fontSize="10px" fontWeight={isActive ? 600 : 400} color={isActive ? colors.accent.indigo : colors.text.muted}>
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
