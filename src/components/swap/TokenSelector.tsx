"use client";

import React from "react";
import { SUPPORTED_TOKENS, type SwapToken } from "@/lib/swap/constants";
import { XIcon } from "@/components/stealth/icons";

const AVAILABLE_TOKENS = Object.values(SUPPORTED_TOKENS);

interface TokenSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (token: SwapToken) => void;
  selectedToken?: SwapToken | null;
  balances?: Record<string, string>;
}

export function TokenSelector({
  isOpen,
  onClose,
  onSelect,
  selectedToken,
  balances = {},
}: TokenSelectorProps) {
  if (!isOpen) return null;

  const handleSelect = (token: SwapToken) => {
    onSelect(token);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[200] bg-[rgba(6,8,15,0.85)] flex items-center justify-center"
      onClick={(e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[440px] mx-4 bg-[rgba(13,15,23,0.95)] border border-[rgba(255,255,255,0.08)] rounded-[24px] shadow-[0_24px_64px_rgba(0,0,0,0.65),0_8px_20px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-[24px] overflow-hidden">
        {/* Corner accents */}
        <div className="absolute top-0 left-0 w-8 h-8 border-t border-l border-[rgba(255,255,255,0.12)] rounded-tl-[24px] pointer-events-none" />
        <div className="absolute top-0 right-0 w-8 h-8 border-t border-r border-[rgba(255,255,255,0.12)] rounded-tr-[24px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-8 h-8 border-b border-l border-[rgba(255,255,255,0.12)] rounded-bl-[24px] pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-8 h-8 border-b border-r border-[rgba(255,255,255,0.12)] rounded-br-[24px] pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[rgba(255,255,255,0.05)]">
          <span className="text-[16px] font-bold text-[rgba(255,255,255,0.92)] font-mono">
            Select Token
          </span>
          <button
            onClick={onClose}
            className="cursor-pointer p-2 rounded-full transition-all hover:bg-[rgba(255,255,255,0.08)]"
          >
            <XIcon size={15} color="rgba(255,255,255,0.30)" />
          </button>
        </div>

        {/* Info banner */}
        <div className="px-5 pt-4 pb-2">
          <div className="p-3 rounded-[12px] bg-[rgba(0,255,65,0.06)] border border-[rgba(0,255,65,0.15)]">
            <p className="text-[12px] text-[rgba(255,255,255,0.45)] font-mono">
              Trading pair:{" "}
              <span className="text-[rgba(255,255,255,0.92)] font-semibold">ETH/USDC</span>{" "}
              on Ethereum Sepolia
            </p>
          </div>
        </div>

        {/* Token list */}
        <div className="flex flex-col gap-0 p-2">
          {AVAILABLE_TOKENS.map((token) => {
            const isSelected =
              selectedToken?.address.toLowerCase() === token.address.toLowerCase();
            const balance = balances[token.symbol] ?? "\u2014";

            return (
              <button
                key={token.address}
                onClick={() => handleSelect(token)}
                className={[
                  "w-full flex items-center gap-3 p-4 rounded-[16px] cursor-pointer transition-all text-left",
                  isSelected
                    ? "bg-[rgba(0,255,65,0.08)] border border-[rgba(0,255,65,0.25)]"
                    : "bg-transparent border border-transparent hover:bg-[rgba(255,255,255,0.08)]",
                ].join(" ")}
              >
                {/* Token icon */}
                <div className="w-10 h-10 rounded-full bg-[#0D0F17] flex items-center justify-center flex-shrink-0">
                  <span className="text-[14px] font-bold text-[rgba(255,255,255,0.92)] font-mono">
                    {token.symbol.charAt(0)}
                  </span>
                </div>

                {/* Token info */}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-[2px]">
                    <span className="font-semibold text-[rgba(255,255,255,0.92)] text-[14px] font-mono">
                      {token.symbol}
                    </span>
                    {isSelected && (
                      <span className="px-2 py-[2px] rounded-[8px] bg-[rgba(0,255,65,0.12)] text-[10px] font-semibold text-[#00FF41] font-mono">
                        Selected
                      </span>
                    )}
                  </div>
                  <span className="text-[13px] text-[rgba(255,255,255,0.30)] font-mono">
                    {token.name}
                  </span>
                </div>

                {/* Balance */}
                <div className="flex flex-col items-end gap-0">
                  <span className="text-[13px] font-mono text-[rgba(255,255,255,0.92)] font-medium">
                    {balance}
                  </span>
                  <span className="text-[11px] text-[rgba(255,255,255,0.30)] font-mono">
                    Balance
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-[rgba(255,255,255,0.05)]">
          <p className="text-[12px] text-[rgba(255,255,255,0.30)] text-center font-mono">
            More trading pairs coming soon
          </p>
        </div>
      </div>
    </div>
  );
}
