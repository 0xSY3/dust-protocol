"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Box, Text, VStack, HStack, Grid } from "@chakra-ui/react";
import { useAuth } from "@/contexts/AuthContext";
import { usePaymentLinks } from "@/hooks/stealth/usePaymentLinks";
import { useStealthScanner } from "@/hooks/stealth";
import { colors, radius, cardAccents } from "@/lib/design/tokens";
import { LinkCard } from "@/components/links/LinkCard";
import { PlusIcon } from "@/components/stealth/icons";

export default function LinksPage() {
  const router = useRouter();
  const { ownedNames, stealthKeys } = useAuth();
  const { links } = usePaymentLinks();
  const { payments, scanInBackground, stopBackgroundScan } = useStealthScanner(stealthKeys);
  const username = ownedNames[0]?.name || "";

  useEffect(() => {
    if (stealthKeys) {
      scanInBackground();
      return () => stopBackgroundScan();
    }
  }, [stealthKeys, scanInBackground, stopBackgroundScan]);

  // Compute per-link payment counts — only payments tagged with that link's slug
  const linkStats = useMemo(() => {
    const stats: Record<string, { count: number; total: number }> = {};
    for (const p of payments) {
      const slug = p.announcement.linkSlug;
      if (!slug) continue;
      const amount = parseFloat(p.originalAmount || p.balance || "0");
      if (!stats[slug]) stats[slug] = { count: 0, total: 0 };
      stats[slug].count++;
      stats[slug].total += amount;
    }
    return stats;
  }, [payments]);

  return (
    <Box p={{ base: "20px 16px", md: "40px" }} maxW="780px" mx="auto">
      <VStack gap="28px" align="stretch">
        {/* Page heading */}
        <Text fontSize="24px" fontWeight={700} color={colors.text.primary} textAlign="center">
          Links
        </Text>

        {/* Grid: Create New Link + Existing Links */}
        <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap="16px">
          {/* Create New Link card */}
          <Box
            p="24px"
            bgColor={colors.bg.card}
            borderRadius={radius.lg}
            border={`2.5px dashed ${colors.border.default}`}
            cursor="pointer"
            _hover={{ borderColor: colors.border.light, bgColor: colors.bg.input }}
            transition="all 0.2s ease"
            display="flex"
            alignItems="center"
            justifyContent="center"
            minH="200px"
            onClick={() => router.push("/links/create")}
          >
            <VStack gap="14px">
              <Box
                w="48px" h="48px"
                borderRadius={radius.full}
                bgColor={colors.bg.input}
                display="flex" alignItems="center" justifyContent="center"
              >
                <PlusIcon size={24} color={colors.text.muted} />
              </Box>
              <Text fontSize="14px" fontWeight={500} color={colors.text.secondary}>Create New Link</Text>
            </VStack>
          </Box>

          {/* Personal link (from owned names) */}
          {ownedNames.map((name, i) => (
            <LinkCard key={name.name} name={name} type="personal" accentColor={cardAccents[i % cardAccents.length]} />
          ))}

          {/* Custom links — override payments count with real scanned data */}
          {links.map((link, i) => {
            const stats = linkStats[link.slug];
            const enrichedLink = stats
              ? { ...link, payments: stats.count }
              : link;
            return (
              <LinkCard key={link.id} link={enrichedLink} username={username} type="custom"
                accentColor={cardAccents[(ownedNames.length + i) % cardAccents.length]} />
            );
          })}
        </Grid>

      </VStack>
    </Box>
  );
}
