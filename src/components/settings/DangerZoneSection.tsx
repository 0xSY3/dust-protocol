"use client";

import React, { useState } from "react";
import { TrashIcon, AlertCircleIcon } from "@/components/stealth/icons";

interface DangerZoneSectionProps {
  clearKeys: () => void;
  clearPin: () => void;
}

export function DangerZoneSection({ clearKeys, clearPin }: DangerZoneSectionProps) {
  const [confirmReset, setConfirmReset] = useState(false);

  const handleReset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    clearKeys();
    clearPin();
    setConfirmReset(false);
    window.location.href = "/";
  };

  return (
    <div className="p-6 bg-[rgba(255,255,255,0.02)] border border-[rgba(239,68,68,0.25)] rounded-sm">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-[rgba(239,68,68,0.06)] flex items-center justify-center flex-shrink-0">
            <TrashIcon size={16} color="#EF4444" />
          </div>
          <span className="text-[15px] text-red-500 font-semibold">Danger Zone</span>
        </div>

        {confirmReset && (
          <div className="flex items-center gap-2 px-4 py-3 bg-[rgba(229,62,62,0.04)] rounded-sm">
            <div className="flex-shrink-0">
              <AlertCircleIcon size={14} color="#EF4444" />
            </div>
            <span className="text-[12px] text-red-500">
              Are you sure? This will clear all keys and PIN. Click again to confirm.
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={handleReset}
          className="w-full py-3 bg-[rgba(239,68,68,0.06)] rounded-full hover:bg-[rgba(239,68,68,0.1)] transition-colors cursor-pointer text-center"
        >
          <span className="text-[14px] font-medium text-red-500">
            {confirmReset ? "Confirm Reset" : "Reset Private Wallet"}
          </span>
        </button>

        <p className="text-[12px] text-[rgba(255,255,255,0.5)] text-center">
          This will clear your keys and PIN. You can recover by signing with the same wallet and PIN.
        </p>
      </div>
    </div>
  );
}
