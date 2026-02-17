"use client";

import React, { useState } from "react";
import { DEPOSIT_DENOMINATIONS, MIN_WAIT_BLOCKS, MIN_WAIT_MINUTES, type SwapToken } from "@/lib/swap/constants";
import { ShieldIcon, XIcon, CheckCircleIcon, AlertCircleIcon } from "@/components/stealth/icons";

type DepositStep = "input" | "approving" | "depositing" | "confirming" | "success" | "error";

interface DepositNote {
  commitment: bigint;
  nullifier: bigint;
  secret: bigint;
  amount: bigint;
  nullifierHash: bigint;
  leafIndex?: number;
}

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: SwapToken;
  onDeposit?: (amount: string) => Promise<{ note: DepositNote; txHash: string; leafIndex: number } | null>;
}

function Spinner() {
  return (
    <svg
      className="animate-spin"
      width="12"
      height="12"
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

function ProgressStep({
  step,
  label,
  isActive,
  isComplete,
}: {
  step: number;
  label: string;
  isActive: boolean;
  isComplete: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={[
          "w-7 h-7 rounded-full flex items-center justify-center border transition-all",
          isComplete
            ? "bg-[rgba(34,197,94,0.15)] border-[rgba(34,197,94,0.3)]"
            : isActive
            ? "bg-[rgba(0,255,65,0.15)] border-[rgba(0,255,65,0.3)]"
            : "bg-[rgba(255,255,255,0.06)] border-[rgba(255,255,255,0.08)]",
        ].join(" ")}
      >
        {isComplete ? (
          <CheckCircleIcon size={14} color="#22C55E" />
        ) : isActive ? (
          <Spinner />
        ) : (
          <span className="text-[11px] font-semibold text-[rgba(255,255,255,0.30)] font-mono">
            {step}
          </span>
        )}
      </div>
      <span
        className={[
          "text-[13px] font-mono transition-all",
          isComplete
            ? "font-normal text-[#22C55E]"
            : isActive
            ? "font-semibold text-[rgba(255,255,255,0.92)]"
            : "font-normal text-[rgba(255,255,255,0.30)]",
        ].join(" ")}
      >
        {label}
      </span>
    </div>
  );
}

export function DepositModal({ isOpen, onClose, token, onDeposit }: DepositModalProps) {
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<DepositStep>("input");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ note: DepositNote; txHash: string; leafIndex: number } | null>(null);

  if (!isOpen) return null;

  const denominations = DEPOSIT_DENOMINATIONS[token.symbol] ?? ["0.1", "1", "5", "10"];

  const handleDeposit = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    if (!onDeposit) return;

    try {
      setError(null);
      setStep("approving");

      // For ERC20 tokens, approval step is needed
      if (token.symbol !== "ETH") {
        // Approval happens in the hook
        await new Promise((r) => setTimeout(r, 500));
      }

      setStep("depositing");
      const depositResult = await onDeposit(amount);

      if (!depositResult) {
        throw new Error("Deposit failed");
      }

      setStep("confirming");
      await new Promise((r) => setTimeout(r, 1000));

      setResult(depositResult);
      setStep("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit failed");
      setStep("error");
    }
  };

  const handleClose = () => {
    setAmount("");
    setStep("input");
    setError(null);
    setResult(null);
    onClose();
  };

  const isProcessing = ["approving", "depositing", "confirming"].includes(step);
  const canDeposit = !!(amount && parseFloat(amount) > 0);

  return (
    <div
      className="fixed inset-0 z-[200] bg-[rgba(6,8,15,0.85)] flex items-center justify-center"
      onClick={(e: React.MouseEvent) => {
        if (e.target === e.currentTarget && !isProcessing) handleClose();
      }}
    >
      <div className="relative w-full max-w-[480px] mx-4 bg-[rgba(13,15,23,0.95)] border border-[rgba(255,255,255,0.08)] rounded-[24px] shadow-[0_24px_64px_rgba(0,0,0,0.65),0_8px_20px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-[24px] overflow-hidden">
        {/* Corner accents */}
        <div className="absolute top-0 left-0 w-8 h-8 border-t border-l border-[rgba(255,255,255,0.12)] rounded-tl-[24px] pointer-events-none" />
        <div className="absolute top-0 right-0 w-8 h-8 border-t border-r border-[rgba(255,255,255,0.12)] rounded-tr-[24px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-8 h-8 border-b border-l border-[rgba(255,255,255,0.12)] rounded-bl-[24px] pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-8 h-8 border-b border-r border-[rgba(255,255,255,0.12)] rounded-br-[24px] pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[16px] bg-[linear-gradient(135deg,#00FF41,#633CFF)] flex items-center justify-center">
              <ShieldIcon size={18} color="#fff" />
            </div>
            <div className="flex flex-col gap-0">
              <span className="text-[16px] font-bold text-[rgba(255,255,255,0.92)] font-mono">
                Deposit to Pool
              </span>
              <span className="text-[11px] text-[rgba(255,255,255,0.30)] font-medium font-mono">
                Add {token.symbol} to the privacy pool
              </span>
            </div>
          </div>
          {!isProcessing && (
            <button
              onClick={handleClose}
              className="cursor-pointer p-2 rounded-full transition-all hover:bg-[rgba(255,255,255,0.08)]"
            >
              <XIcon size={15} color="rgba(255,255,255,0.30)" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="px-6 pb-6 pt-0">
          {step === "input" && (
            <div className="flex flex-col gap-5">
              {/* Privacy info box */}
              <div className="p-3 rounded-[12px] bg-[rgba(0,255,65,0.06)] border border-[rgba(0,255,65,0.15)]">
                <div className="flex items-start gap-2">
                  <div className="mt-[2px] flex-shrink-0">
                    <ShieldIcon size={14} color="#00FF41" />
                  </div>
                  <p className="text-[12px] text-[rgba(255,255,255,0.45)] leading-[1.5] font-mono">
                    Deposits use fixed amounts to protect your privacy. All deposits of the
                    same amount are indistinguishable from each other, creating a strong
                    anonymity set.
                  </p>
                </div>
              </div>

              {/* Fixed denomination grid */}
              <div className="flex flex-col gap-2">
                <span className="text-[11px] text-[rgba(255,255,255,0.30)] font-semibold uppercase tracking-[0.04em] font-mono">
                  Select Amount
                </span>
                <div className="grid grid-cols-5 gap-2">
                  {denominations.map((denom) => (
                    <button
                      key={denom}
                      type="button"
                      onClick={() => setAmount(denom)}
                      className={[
                        "py-3 px-1 rounded-[12px] cursor-pointer transition-all text-center",
                        amount === denom
                          ? "bg-[rgba(0,255,65,0.12)] border border-[rgba(0,255,65,0.3)] hover:bg-[rgba(0,255,65,0.15)] hover:border-[rgba(0,255,65,0.4)]"
                          : "bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.08)] hover:border-[rgba(0,255,65,0.5)]",
                      ].join(" ")}
                    >
                      <div
                        className={[
                          "text-[13px] font-mono font-semibold",
                          amount === denom ? "text-[#00FF41]" : "text-[rgba(255,255,255,0.92)]",
                        ].join(" ")}
                      >
                        {denom}
                      </div>
                      <div className="text-[9px] text-[rgba(255,255,255,0.30)] mt-[2px] font-mono">
                        {token.symbol}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Wait time notice */}
              <div className="py-[10px] px-3 rounded-[12px] bg-[rgba(245,158,11,0.06)] border border-[rgba(245,158,11,0.12)]">
                <div className="flex items-start gap-2">
                  <span className="text-[12px] mt-[1px]">⏳</span>
                  <p className="text-[11px] text-[rgba(255,255,255,0.45)] leading-[1.5] font-mono">
                    After depositing, you must wait{" "}
                    <span className="font-bold text-[#F59E0B]">~{MIN_WAIT_MINUTES} minutes</span>{" "}
                    ({MIN_WAIT_BLOCKS} blocks) before swapping. This allows other deposits to mix
                    in, strengthening your anonymity.
                  </p>
                </div>
              </div>

              {/* Deposit button */}
              <button
                type="button"
                onClick={handleDeposit}
                disabled={!canDeposit}
                className={[
                  "w-full py-[14px] rounded-full text-[15px] font-bold text-white text-center transition-all",
                  canDeposit
                    ? "bg-[linear-gradient(135deg,#00FF41_0%,#00FF41_50%,#00FF41_100%)] shadow-[0_2px_8px_rgba(0,255,65,0.3),0_0_20px_rgba(0,255,65,0.1)] cursor-pointer hover:shadow-[0_4px_16px_rgba(0,255,65,0.4),0_0_40px_rgba(0,255,65,0.15)] hover:-translate-y-[1px] active:translate-y-0"
                    : "bg-[rgba(255,255,255,0.06)] cursor-not-allowed opacity-50",
                ].join(" ")}
              >
                {canDeposit ? `Deposit ${amount} ${token.symbol}` : "Select an Amount"}
              </button>
            </div>
          )}

          {/* Processing steps */}
          {isProcessing && (
            <div className="flex flex-col gap-4 py-2">
              <ProgressStep
                step={1}
                label={token.symbol === "ETH" ? "Preparing deposit..." : "Approving token..."}
                isActive={step === "approving"}
                isComplete={step !== "approving"}
              />
              <ProgressStep
                step={2}
                label="Depositing to privacy pool..."
                isActive={step === "depositing"}
                isComplete={step === "confirming"}
              />
              <ProgressStep
                step={3}
                label="Confirming on-chain..."
                isActive={step === "confirming"}
                isComplete={false}
              />
            </div>
          )}

          {/* Success */}
          {step === "success" && result && (
            <div className="flex flex-col gap-4">
              <div className="text-center py-2">
                <div className="inline-flex mb-3">
                  <CheckCircleIcon size={40} color="#22C55E" />
                </div>
                <div className="text-[16px] font-bold text-[rgba(255,255,255,0.92)] mb-1 font-mono">
                  Deposit Successful
                </div>
                <div className="text-[13px] text-[rgba(255,255,255,0.65)] font-mono">
                  {amount} {token.symbol} deposited to privacy pool
                </div>
              </div>

              {/* Wait time warning */}
              <div className="p-[14px] rounded-[12px] bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.2)]">
                <div className="flex items-start gap-[10px]">
                  <span className="text-[18px] mt-[-1px]">⏳</span>
                  <div className="flex flex-col gap-1">
                    <div className="text-[13px] font-bold text-[#F59E0B] font-mono">
                      Wait ~{MIN_WAIT_MINUTES} Minutes Before Swapping
                    </div>
                    <p className="text-[11px] text-[rgba(255,255,255,0.45)] leading-[1.6] font-mono">
                      Your deposit needs to age for at least {MIN_WAIT_BLOCKS} blocks (~{MIN_WAIT_MINUTES} minutes)
                      before it can be used in a private swap. This mandatory waiting period lets other
                      users&apos; deposits enter the pool, making your transaction indistinguishable from theirs.
                      Without this wait, the timing of your deposit and swap could be correlated by an observer.
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-[12px] bg-[rgba(34,197,94,0.06)] border border-[rgba(34,197,94,0.15)]">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[rgba(255,255,255,0.30)] font-mono">Leaf Index</span>
                    <span className="text-[11px] font-mono text-[rgba(255,255,255,0.92)]">
                      #{result.leafIndex}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[rgba(255,255,255,0.30)] font-mono">Commitment</span>
                    <span className="text-[11px] font-mono text-[rgba(255,255,255,0.92)]">
                      {(() => {
                        const hex = '0x' + result.note.commitment.toString(16).padStart(64, '0');
                        return `${hex.slice(0, 10)}...${hex.slice(-8)}`;
                      })()}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const noteData = {
                        commitment: '0x' + result.note.commitment.toString(16).padStart(64, '0'),
                        nullifier: '0x' + result.note.nullifier.toString(16).padStart(64, '0'),
                        secret: '0x' + result.note.secret.toString(16).padStart(64, '0'),
                        amount: result.note.amount.toString(),
                        leafIndex: result.leafIndex,
                        txHash: result.txHash,
                      };
                      navigator.clipboard.writeText(JSON.stringify(noteData, null, 2));
                    }}
                    className="mt-1 py-2 px-3 rounded-[12px] bg-[rgba(34,197,94,0.1)] border border-[rgba(34,197,94,0.2)] cursor-pointer hover:bg-[rgba(34,197,94,0.15)] transition-all"
                  >
                    <span className="text-[11px] text-[#22C55E] font-semibold font-mono">
                      📋 Copy Full Note Details
                    </span>
                  </button>
                </div>
              </div>

              <div className="p-3 rounded-[12px] bg-[rgba(245,158,11,0.06)] border border-[rgba(245,158,11,0.15)]">
                <div className="text-[12px] text-[#F59E0B] font-semibold mb-1 font-mono">
                  Save Your Deposit Note
                </div>
                <p className="text-[11px] text-[rgba(255,255,255,0.45)] leading-[1.5] font-mono">
                  Your deposit note has been saved to this browser. If you clear browser data, you will lose access to this deposit.
                </p>
              </div>

              <button
                type="button"
                onClick={handleClose}
                className="w-full py-[14px] rounded-full bg-[linear-gradient(135deg,#00FF41_0%,#00FF41_50%,#00FF41_100%)] shadow-[0_2px_8px_rgba(0,255,65,0.3),0_0_20px_rgba(0,255,65,0.1)] cursor-pointer transition-all text-[15px] font-bold text-white text-center hover:shadow-[0_4px_16px_rgba(0,255,65,0.4),0_0_40px_rgba(0,255,65,0.15)] hover:-translate-y-[1px] active:translate-y-0 font-mono"
              >
                Done
              </button>
            </div>
          )}

          {/* Error */}
          {step === "error" && (
            <div className="flex flex-col gap-4">
              <div className="text-center py-2">
                <div className="inline-flex mb-3">
                  <AlertCircleIcon size={40} color="#EF4444" />
                </div>
                <div className="text-[16px] font-bold text-[rgba(255,255,255,0.92)] mb-1 font-mono">
                  Deposit Failed
                </div>
                <div className="text-[13px] text-[rgba(255,255,255,0.65)] font-mono">
                  {error}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 py-[14px] rounded-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] cursor-pointer transition-all text-[14px] font-semibold text-[rgba(255,255,255,0.92)] text-center hover:bg-[rgba(255,255,255,0.08)] font-mono"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep("input");
                    setError(null);
                  }}
                  className="flex-1 py-[14px] rounded-full bg-[linear-gradient(135deg,#00FF41_0%,#00FF41_50%,#00FF41_100%)] shadow-[0_2px_8px_rgba(0,255,65,0.3),0_0_20px_rgba(0,255,65,0.1)] cursor-pointer transition-all text-[14px] font-bold text-white text-center hover:shadow-[0_4px_16px_rgba(0,255,65,0.4),0_0_40px_rgba(0,255,65,0.15)] hover:-translate-y-[1px] active:translate-y-0 font-mono"
                >
                  Try Again
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
