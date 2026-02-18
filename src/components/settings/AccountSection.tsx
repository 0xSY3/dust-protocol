"use client";

import React from "react";
import type { OwnedName } from "@/lib/design/types";
import { UserIcon, CheckCircleIcon } from "@/components/stealth/icons";
import { useAuth } from "@/contexts/AuthContext";
import { getChainConfig } from "@/config/chains";

interface AccountSectionProps {
  address: string | undefined;
  ownedNames: OwnedName[];
  isRegistered: boolean;
}

export function AccountSection({ address, ownedNames, isRegistered }: AccountSectionProps) {
  const { activeChainId } = useAuth();
  return (
    <div className="p-6 bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-sm">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-[rgba(255,255,255,0.03)] flex items-center justify-center flex-shrink-0">
            <UserIcon size={16} color="rgba(255,255,255,0.5)" />
          </div>
          <span className="text-[15px] text-white font-semibold">Account</span>
        </div>

        <div className="flex flex-col">
          {ownedNames.length > 0 && (
            <div className="flex items-center justify-between py-3.5 border-b border-[rgba(255,255,255,0.06)]">
              <span className="text-[13px] text-[rgba(255,255,255,0.5)]">Username</span>
              <span className="text-[14px] font-semibold text-[#7C3AED]">{ownedNames[0].fullName}</span>
            </div>
          )}
          {address && (
            <div className="flex items-center justify-between py-3.5 border-b border-[rgba(255,255,255,0.06)]">
              <span className="text-[13px] text-[rgba(255,255,255,0.5)]">Wallet</span>
              <span className="text-[12px] text-[rgba(255,255,255,0.35)] font-mono">
                {address.slice(0, 10)}...{address.slice(-8)}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between py-3.5 border-b border-[rgba(255,255,255,0.06)]">
            <span className="text-[13px] text-[rgba(255,255,255,0.5)]">Network</span>
              <span className="text-[13px] text-[rgba(255,255,255,0.7)]">{getChainConfig(activeChainId).name}</span>
          </div>
          <div className="flex items-center justify-between py-3.5">
            <span className="text-[13px] text-[rgba(255,255,255,0.5)]">On-chain</span>
            <div className="flex items-center gap-1.5">
              {isRegistered && <CheckCircleIcon size={14} color="#7C3AED" />}
              <span className={`text-[13px] ${isRegistered ? "text-[#7C3AED]" : "text-[rgba(255,255,255,0.5)]"}`}>
                {isRegistered ? "Registered" : "Not registered"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
