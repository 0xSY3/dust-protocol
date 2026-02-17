"use client";

import React, { useState } from "react";
import { getExplorerBase } from "@/lib/design/tokens";
import { ShieldCheckIcon, XIcon, CheckCircleIcon, AlertCircleIcon, ArrowUpRightIcon } from "@/components/stealth/icons";
import type { SwapToken } from "@/lib/swap/constants";

export type SwapStep =
  | "preparing"
  | "building-merkle"
  | "creating-stealth"
  | "computing-proof"
  | "submitting"
  | "success"
  | "error";

interface SwapExecuteModalProps {
  isOpen: boolean;
  onClose: () => void;
  step: SwapStep;
  stepMessage: string;
  fromToken: SwapToken;
  toToken: SwapToken;
  fromAmount: string;
  toAmount: string;
  error?: string | null;
  rawError?: string | null;
  txHash?: string | null;
  stealthAddress?: string | null;
  retryCount?: number;
  onRetry?: () => void;
  chainId?: number;
}

const STEPS_ORDER: SwapStep[] = [
  "preparing",
  "building-merkle",
  "creating-stealth",
  "computing-proof",
  "submitting",
];

const STEP_LABELS: Record<string, string> = {
  "preparing": "Preparing swap...",
  "building-merkle": "Building Merkle tree...",
  "creating-stealth": "Creating stealth address...",
  "computing-proof": "Computing ZK-SNARK proof...",
  "submitting": "Submitting transaction...",
};

function Spinner() {
  return (
    <svg
      className="animate-spin"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#00FF41"
      strokeWidth="3"
      strokeLinecap="round"
    >
      <path d="M12 2a10 10 0 0 1 10 10" />
    </svg>
  );
}

function StepIndicator({
  label,
  isActive,
  isComplete,
  showSpinner,
  suffix,
}: {
  label: string;
  isActive: boolean;
  isComplete: boolean;
  showSpinner?: boolean;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={[
          "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 border transition-all",
          isComplete
            ? "bg-[rgba(34,197,94,0.15)] border-[rgba(34,197,94,0.3)]"
            : isActive
            ? "bg-[rgba(0,255,65,0.15)] border-[rgba(0,255,65,0.3)]"
            : "bg-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.08)]",
        ].join(" ")}
      >
        {isComplete ? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#22C55E"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : isActive && showSpinner !== false ? (
          <Spinner />
        ) : (
          <div className="w-[6px] h-[6px] rounded-full bg-[rgba(255,255,255,0.30)]" />
        )}
      </div>
      <div className="flex items-center gap-[6px]">
        <span
          className={[
            "text-[13px] font-mono",
            isComplete
              ? "font-normal text-[#22C55E]"
              : isActive
              ? "font-semibold text-[rgba(255,255,255,0.92)]"
              : "font-normal text-[rgba(255,255,255,0.30)]",
          ].join(" ")}
        >
          {label}
        </span>
        {suffix && isActive && (
          <span className="text-[11px] font-medium text-[#F59E0B] font-mono">{suffix}</span>
        )}
      </div>
    </div>
  );
}

export function SwapExecuteModal({
  isOpen,
  onClose,
  step,
  stepMessage,
  fromToken,
  toToken,
  fromAmount,
  toAmount,
  error,
  rawError,
  txHash,
  stealthAddress,
  retryCount,
  onRetry,
  chainId,
}: SwapExecuteModalProps) {
  const [showRawError, setShowRawError] = useState(false);

  if (!isOpen) return null;

  const isProcessing = STEPS_ORDER.includes(step as SwapStep);
  const explorerBase = getExplorerBase(chainId);
  const currentStepIndex = STEPS_ORDER.indexOf(step as SwapStep);

  const headerBg =
    step === "success"
      ? "linear-gradient(135deg, #22C55E, #16A34A)"
      : step === "error"
      ? "linear-gradient(135deg, #EF4444, #DC2626)"
      : "linear-gradient(135deg, #00FF41, #633CFF)";

  return (
    <div
      className="fixed inset-0 z-[200] bg-[rgba(6,8,15,0.85)] flex items-center justify-center"
      onClick={(e: React.MouseEvent) => {
        if (e.target === e.currentTarget && !isProcessing) onClose();
      }}
    >
      <div className="relative w-full max-w-[440px] mx-4 bg-[rgba(13,15,23,0.95)] border border-[rgba(255,255,255,0.08)] rounded-[24px] shadow-[0_24px_64px_rgba(0,0,0,0.65),0_8px_20px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-[24px] overflow-hidden">
        {/* Corner accents */}
        <div className="absolute top-0 left-0 w-8 h-8 border-t border-l border-[rgba(255,255,255,0.12)] rounded-tl-[24px] pointer-events-none" />
        <div className="absolute top-0 right-0 w-8 h-8 border-t border-r border-[rgba(255,255,255,0.12)] rounded-tr-[24px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-8 h-8 border-b border-l border-[rgba(255,255,255,0.12)] rounded-bl-[24px] pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-8 h-8 border-b border-r border-[rgba(255,255,255,0.12)] rounded-br-[24px] pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-[16px] flex items-center justify-center"
              style={{ background: headerBg }}
            >
              {step === "success" ? (
                <CheckCircleIcon size={18} color="#fff" />
              ) : step === "error" ? (
                <AlertCircleIcon size={18} color="#fff" />
              ) : (
                <ShieldCheckIcon size={18} color="#fff" />
              )}
            </div>
            <div className="flex flex-col gap-0">
              <span className="text-[16px] font-bold text-[rgba(255,255,255,0.92)] font-mono">
                {step === "success"
                  ? "Swap Complete"
                  : step === "error"
                  ? "Swap Failed"
                  : "Executing Swap"}
              </span>
              <span className="text-[11px] text-[rgba(255,255,255,0.30)] font-medium font-mono">
                {step === "success"
                  ? "Privacy-preserving swap succeeded"
                  : step === "error"
                  ? "Something went wrong"
                  : stepMessage || STEP_LABELS[step] || "Processing..."}
              </span>
            </div>
          </div>
          {!isProcessing && (
            <button
              onClick={onClose}
              className="cursor-pointer p-2 rounded-full transition-all hover:bg-[rgba(255,255,255,0.08)]"
            >
              <XIcon size={15} color="rgba(255,255,255,0.30)" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="px-6 pb-6 pt-0">
          {/* Processing steps */}
          {isProcessing && (
            <div className="flex flex-col gap-[14px] py-2">
              {STEPS_ORDER.map((s, i) => {
                const isActive = s === step;
                const isComplete = currentStepIndex > i;
                const suffix =
                  s === "submitting" && isActive && retryCount && retryCount > 1
                    ? `(retry ${retryCount}/3)`
                    : undefined;

                return (
                  <StepIndicator
                    key={s}
                    label={STEP_LABELS[s]}
                    isActive={isActive}
                    isComplete={isComplete}
                    showSpinner={isActive}
                    suffix={suffix}
                  />
                );
              })}

              {/* Swap summary */}
              <div className="mt-2 p-3 rounded-[12px] bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-0 items-start">
                    <span className="text-[11px] text-[rgba(255,255,255,0.30)] font-mono">Sending</span>
                    <span className="text-[14px] font-mono text-[rgba(255,255,255,0.92)] font-semibold">
                      {fromAmount} {fromToken.symbol}
                    </span>
                  </div>
                  <div className="text-[rgba(255,255,255,0.30)]">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                    </svg>
                  </div>
                  <div className="flex flex-col gap-0 items-end">
                    <span className="text-[11px] text-[rgba(255,255,255,0.30)] font-mono">Receiving</span>
                    <span className="text-[14px] font-mono text-[#22C55E] font-semibold">
                      {toAmount} {toToken.symbol}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Success */}
          {step === "success" && (
            <div className="flex flex-col gap-4">
              {/* Swap result */}
              <div className="p-4 rounded-[16px] bg-[rgba(34,197,94,0.06)] border border-[rgba(34,197,94,0.15)]">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex flex-col gap-0 items-start">
                    <span className="text-[11px] text-[rgba(255,255,255,0.30)] font-mono">Sent</span>
                    <span className="text-[18px] font-mono text-[rgba(255,255,255,0.92)] font-semibold">
                      {fromAmount} {fromToken.symbol}
                    </span>
                  </div>
                  <div className="text-[#22C55E]">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                    </svg>
                  </div>
                  <div className="flex flex-col gap-0 items-end">
                    <span className="text-[11px] text-[rgba(255,255,255,0.30)] font-mono">Received</span>
                    <span className="text-[18px] font-mono text-[#22C55E] font-semibold">
                      {toAmount} {toToken.symbol}
                    </span>
                  </div>
                </div>

                {txHash && (
                  <div className="flex items-center justify-between pt-2 border-t border-[rgba(34,197,94,0.1)]">
                    <span className="text-[11px] text-[rgba(255,255,255,0.30)] font-mono">Transaction</span>
                    <a
                      href={`${explorerBase}/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[11px] font-mono text-[#00FF41] hover:underline"
                    >
                      {txHash.slice(0, 10)}...{txHash.slice(-8)}
                      <ArrowUpRightIcon size={10} />
                    </a>
                  </div>
                )}

                {stealthAddress && (
                  <div className="flex items-center justify-between pt-2 mt-1 border-t border-[rgba(34,197,94,0.1)]">
                    <span className="text-[11px] text-[rgba(255,255,255,0.30)] font-mono">Stealth Address</span>
                    <span className="text-[11px] font-mono text-[rgba(255,255,255,0.65)]">
                      {stealthAddress.slice(0, 10)}...{stealthAddress.slice(-8)}
                    </span>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-[14px] rounded-full bg-[linear-gradient(135deg,#00FF41_0%,#00FF41_50%,#00FF41_100%)] shadow-[0_2px_8px_rgba(0,255,65,0.3),0_0_20px_rgba(0,255,65,0.1)] cursor-pointer transition-all text-[15px] font-bold text-white text-center hover:shadow-[0_4px_16px_rgba(0,255,65,0.4),0_0_40px_rgba(0,255,65,0.15)] hover:-translate-y-[1px] active:translate-y-0 font-mono"
              >
                Close
              </button>
            </div>
          )}

          {/* Error */}
          {step === "error" && (
            <div className="flex flex-col gap-4">
              <div className="p-3 rounded-[12px] bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.15)]">
                <div className="text-[13px] text-[#EF4444] font-semibold mb-1 font-mono">
                  Error Details
                </div>
                <p className="text-[12px] text-[rgba(255,255,255,0.45)] leading-[1.5] font-mono">
                  {error || "An unknown error occurred"}
                </p>

                {/* Collapsible raw error */}
                {rawError && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => setShowRawError(!showRawError)}
                      className="flex items-center gap-1 cursor-pointer"
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="rgba(255,255,255,0.30)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{
                          transform: showRawError ? "rotate(90deg)" : "rotate(0deg)",
                          transition: "transform 0.15s ease",
                        }}
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      <span className="text-[11px] text-[rgba(255,255,255,0.30)] font-medium font-mono">
                        {showRawError ? "Hide" : "Show"} raw error
                      </span>
                    </button>
                    {showRawError && (
                      <div className="mt-2 p-[10px] rounded-[8px] bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.05)] max-h-[140px] overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-[rgba(255,255,255,0.1)] [&::-webkit-scrollbar-thumb]:rounded">
                        <pre className="text-[10px] font-mono text-[rgba(255,255,255,0.30)] whitespace-pre-wrap break-all leading-[1.5]">
                          {rawError}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-[14px] rounded-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] cursor-pointer transition-all text-[14px] font-semibold text-[rgba(255,255,255,0.92)] text-center hover:bg-[rgba(255,255,255,0.08)] font-mono"
                >
                  Cancel
                </button>
                {onRetry && (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="flex-1 py-[14px] rounded-full bg-[linear-gradient(135deg,#00FF41_0%,#00FF41_50%,#00FF41_100%)] shadow-[0_2px_8px_rgba(0,255,65,0.3),0_0_20px_rgba(0,255,65,0.1)] cursor-pointer transition-all text-[14px] font-bold text-white text-center hover:shadow-[0_4px_16px_rgba(0,255,65,0.4),0_0_40px_rgba(0,255,65,0.15)] hover:-translate-y-[1px] active:translate-y-0 font-mono"
                  >
                    Try Again
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
