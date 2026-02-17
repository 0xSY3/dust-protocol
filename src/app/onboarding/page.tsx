"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { ConnectButton } from "@/components/ConnectButton";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { DustLogo } from "@/components/DustLogo";

import { SpiritPortal } from "@/components/SpiritPortal";

export default function OnboardingPage() {
  const { isConnected, isOnboarded, isHydrated, address } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isHydrated) return;
    if (!isConnected) router.replace("/");
    // Wait for address before checking isOnboarded — avoids flash of onboarding wizard
    // when wallet is connected but address hasn't populated yet
    if (isConnected && !address) return;
    if (isOnboarded) router.replace("/dashboard");
  }, [isConnected, isOnboarded, isHydrated, address, router]);

  if (!isConnected || !isHydrated) return null;

  return (
    <>
      <style>{`
        @keyframes wizard-enter {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .wizard-enter {
          animation: wizard-enter 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>

      {/* Container with background */}
      <div className="min-h-screen bg-[#06080F] text-white flex flex-col relative overflow-hidden">

        {/* Background image layer */}
        <div className="absolute top-0 left-0 w-full h-full z-0">
          <div
            className="absolute inset-0 brightness-75"
            style={{
              backgroundImage: "url('/nature_privacy_portal_bg.png')",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
        </div>

        {/* Header — transparent overlay */}
        <header className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(6,8,15,0.2)] backdrop-blur-md relative z-[100] px-6 py-4">
          <div className="flex items-center justify-between max-w-[1200px] mx-auto">
            <div className="flex items-center gap-2.5">
              <DustLogo size={26} color="#00FF41" />
              <span
                className="text-[22px] font-bold text-white tracking-tight"
                style={{ fontFamily: "var(--font-instrument-serif), serif" }}
              >
                Dust
              </span>
              <span className="text-[13px] font-medium text-white/35">Protocol</span>
            </div>
            <ConnectButton />
          </div>
        </header>

        {/* Wizard — centered in remaining space */}
        <div className="flex-1 flex items-center justify-center px-5 py-8 relative z-10 wizard-enter">
          <OnboardingWizard />
        </div>
      </div>
    </>
  );
}
