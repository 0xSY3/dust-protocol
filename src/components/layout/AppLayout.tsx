"use client";

import { Box } from "@chakra-ui/react";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Sidebar } from "./Sidebar";
import { colors } from "@/lib/design/tokens";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { isConnected, isOnboarded, isHydrated, address } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Don't redirect on landing page, onboarding, or public pay pages
    if (pathname === "/" || pathname.startsWith("/pay/") || pathname === "/onboarding") return;
    if (!isHydrated) return; // Wait for localStorage before redirecting

    if (!isConnected) {
      router.replace("/");
      return;
    }

    // Wait for address to be populated — isConnected can be true before address is available,
    // which causes all isOnboarded checks to fail and incorrectly routes to /onboarding
    if (!address) return;

    if (!isOnboarded) {
      router.replace("/onboarding");
      return;
    }
  }, [isConnected, isOnboarded, isHydrated, address, pathname, router]);

  // For landing, onboarding, and public pay pages — no sidebar
  if (pathname === "/" || pathname === "/onboarding" || pathname.startsWith("/pay/")) {
    return <>{children}</>;
  }

  // Show minimal loading until hydration completes to prevent content flash
  if (!isHydrated || !isConnected || !address) {
    return (
      <Box minH="100vh" bg={colors.bg.page} display="flex" alignItems="center" justifyContent="center">
        <Box w="24px" h="24px" border="2px solid" borderColor={colors.accent.indigo} borderTopColor="transparent" borderRadius="50%"
          animation="spin 0.6s linear infinite" />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </Box>
    );
  }

  return (
    <Box minH="100vh" bg={colors.bg.page} color={colors.text.primary}>
      <Sidebar />
      {/* Main content */}
      <Box
        ml={{ base: 0, md: "240px" }}
        pb={{ base: "96px", md: 0 }}
        minH="100vh"
      >
        {children}
      </Box>
    </Box>
  );
}
