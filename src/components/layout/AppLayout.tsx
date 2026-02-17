"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Navbar } from "./Navbar";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { isConnected, isOnboarded, isHydrated, address } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === "/" || pathname.startsWith("/pay/") || pathname === "/onboarding") return;
    if (!isHydrated) return;
    if (!isConnected) { router.replace("/"); return; }
    if (!address) return;
    if (!isOnboarded) { router.replace("/onboarding"); return; }
  }, [isConnected, isOnboarded, isHydrated, address, pathname, router]);

  if (pathname === "/" || pathname === "/onboarding" || pathname.startsWith("/pay/")) {
    return <>{children}</>;
  }

  if (!isHydrated || !isConnected || !address) {
    return (
      <div className="min-h-screen bg-[#06080F] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#00FF41] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#06080F] text-white">
      <Navbar />
      <main className="pt-14">
        {children}
      </main>
    </div>
  );
}
