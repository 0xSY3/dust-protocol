"use client";

import React, { useState } from "react";
import { DEPOSIT_DENOMINATIONS, MIN_WAIT_BLOCKS, MIN_WAIT_MINUTES, type SwapToken } from "@/lib/swap/constants";
import { ShieldIcon, XIcon, AlertCircleIcon } from "@/components/stealth/icons";

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

// ─── Progress Step ────────────────────────────────────────────────────────────

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
          "w-6 h-6 rounded-sm flex items-center justify-center border transition-all shrink-0",
          isComplete
            ? "bg-[rgba(0,255,65,0.15)] border-[rgba(0,255,65,0.3)]"
            : isActive
            ? "bg-[rgba(0,255,65,0.08)] border-[rgba(0,255,65,0.25)]"
            : "bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)]",
        ].join(" ")}
      >
        {isComplete ? (
          <span className="text-[10px] text-[#00FF41] font-bold font-mono">✓</span>
        ) : isActive ? (
          <div className="w-2.5 h-2.5 border border-[#00FF41] border-t-transparent rounded-full animate-spin" />
        ) : (
          <span className="text-[10px] font-semibold text-[rgba(255,255,255,0.25)] font-mono">{step}</span>
        )}
      </div>
      <span
        className={[
          "text-[12px] font-mono transition-all",
          isComplete
            ? "text-[#00FF41]"
            : isActive
            ? "text-white font-semibold"
            : "text-[rgba(255,255,255,0.3)]",
        ].join(" ")}
      >
        {label}
      </span>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function DepositModal({ isOpen, onClose, token, onDeposit }: DepositModalProps) {
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<DepositStep>("input");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ note: DepositNote; txHash: string; leafIndex: number } | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const denominations = DEPOSIT_DENOMINATIONS[token.symbol] ?? ["0.1", "1", "5", "10"];

  const handleDeposit = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    if (!onDeposit) return;

    try {
      setError(null);
      setStep("approving");

      if (token.symbol !== "ETH") {
        await new Promise((r) => setTimeout(r, 500));
      }

      setStep("depositing");
      const depositResult = await onDeposit(amount);

      if (!depositResult) throw new Error("Deposit failed");

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
    setCopied(false);
    onClose();
  };

  const handleCopyNote = () => {
    if (!result) return;
    const noteData = {
      commitment: "0x" + result.note.commitment.toString(16).padStart(64, "0"),
      nullifier: "0x" + result.note.nullifier.toString(16).padStart(64, "0"),
      secret: "0x" + result.note.secret.toString(16).padStart(64, "0"),
      amount: result.note.amount.toString(),
      leafIndex: result.leafIndex,
      txHash: result.txHash,
    };
    navigator.clipboard.writeText(JSON.stringify(noteData, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isProcessing = ["approving", "depositing", "confirming"].includes(step);
  const canDeposit = !!(amount && parseFloat(amount) > 0);

  return (
    <div
      className="fixed inset-0 z-[200] bg-[rgba(6,8,15,0.88)] backdrop-blur-sm flex items-center justify-center"
      onClick={(e: React.MouseEvent) => {
        if (e.target === e.currentTarget && !isProcessing) handleClose();
      }}
    >
      <div className="relative w-full max-w-[480px] mx-4 bg-[rgba(6,8,15,0.97)] border border-[rgba(255,255,255,0.08)] rounded-sm shadow-[0_24px_64px_rgba(0,0,0,0.6)] overflow-hidden">
        {/* Corner accents */}
        <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[rgba(255,255,255,0.12)] pointer-events-none" />
        <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[rgba(255,255,255,0.12)] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[rgba(255,255,255,0.12)] pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[rgba(255,255,255,0.12)] pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-sm bg-[rgba(0,255,65,0.08)] border border-[rgba(0,255,65,0.2)] flex items-center justify-center shrink-0">
              <ShieldIcon size={16} color="#00FF41" />
            </div>
            <div>
              <p className="text-[13px] font-bold text-white font-mono tracking-wider">
                DEPOSIT_TO_POOL
              </p>
              <p className="text-[10px] text-[rgba(255,255,255,0.35)] font-mono">
                Add {token.symbol} to the privacy pool
              </p>
            </div>
          </div>
          {!isProcessing && (
            <button
              onClick={handleClose}
              className="cursor-pointer p-1.5 rounded-sm transition-all hover:bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.3)] hover:text-[rgba(255,255,255,0.7)]"
            >
              <XIcon size={14} color="currentColor" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="px-5 pb-5 pt-4">

          {/* ── INPUT ─────────────────────────────────────────────────────── */}
          {step === "input" && (
            <div className="flex flex-col gap-4">
              {/* Privacy info */}
              <div className="p-3 rounded-sm bg-[rgba(0,255,65,0.03)] border border-[rgba(0,255,65,0.12)]">
                <div className="flex items-start gap-2">
                  <div className="mt-px shrink-0">
                    <ShieldIcon size={12} color="#00FF41" />
                  </div>
                  <p className="text-[11px] text-[rgba(255,255,255,0.4)] leading-relaxed font-mono">
                    Fixed-amount deposits generate indistinguishable on-chain commitments,
                    maximising your anonymity set.
                  </p>
                </div>
              </div>

              {/* Denomination grid */}
              <div className="flex flex-col gap-1.5">
                <p className="text-[9px] text-[rgba(255,255,255,0.35)] uppercase tracking-widest font-mono">
                  SELECT_AMOUNT
                </p>
                <div className="grid grid-cols-5 gap-1.5">
                  {denominations.map((denom) => (
                    <button
                      key={denom}
                      type="button"
                      onClick={() => setAmount(denom)}
                      className={[
                        "py-2.5 px-1 rounded-sm cursor-pointer transition-all text-center border",
                        amount === denom
                          ? "bg-[rgba(0,255,65,0.08)] border-[rgba(0,255,65,0.3)] text-[#00FF41]"
                          : "bg-[rgba(255,255,255,0.02)] border-[rgba(255,255,255,0.07)] text-[rgba(255,255,255,0.65)] hover:bg-[rgba(255,255,255,0.05)] hover:border-[rgba(0,255,65,0.2)]",
                      ].join(" ")}
                    >
                      <div className="text-[12px] font-mono font-semibold">{denom}</div>
                      <div className="text-[9px] text-[rgba(255,255,255,0.3)] mt-0.5 font-mono">{token.symbol}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Wait notice */}
              <div className="p-3 rounded-sm bg-[rgba(245,158,11,0.04)] border border-[rgba(245,158,11,0.12)]">
                <div className="flex items-start gap-2">
                  <span className="text-[11px] shrink-0 mt-px text-[#F59E0B]">⏳</span>
                  <p className="text-[11px] text-[rgba(255,255,255,0.4)] leading-relaxed font-mono">
                    After depositing, wait{" "}
                    <span className="font-bold text-[#F59E0B]">~{MIN_WAIT_MINUTES} min</span>{" "}
                    ({MIN_WAIT_BLOCKS} blocks) before swapping to strengthen anonymity.
                  </p>
                </div>
              </div>

              {/* Deposit button */}
              <button
                type="button"
                onClick={handleDeposit}
                disabled={!canDeposit}
                className={[
                  "w-full py-3 rounded-sm text-[12px] font-bold font-mono tracking-wider transition-all border",
                  canDeposit
                    ? "bg-[rgba(0,255,65,0.08)] border-[rgba(0,255,65,0.25)] text-[#00FF41] cursor-pointer hover:bg-[rgba(0,255,65,0.13)] hover:border-[rgba(0,255,65,0.5)] hover:shadow-[0_0_12px_rgba(0,255,65,0.1)]"
                    : "bg-[rgba(255,255,255,0.02)] border-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.3)] cursor-not-allowed",
                ].join(" ")}
              >
                {canDeposit ? `> DEPOSIT ${amount} ${token.symbol}` : "> SELECT_AMOUNT"}
              </button>
            </div>
          )}

          {/* ── PROCESSING ────────────────────────────────────────────────── */}
          {isProcessing && (
            <div className="flex flex-col gap-3 py-2">
              <ProgressStep
                step={1}
                label={token.symbol === "ETH" ? "Preparing deposit..." : "Approving token..."}
                isActive={step === "approving"}
                isComplete={["depositing", "confirming"].includes(step)}
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
              <p className="text-[10px] text-[rgba(255,255,255,0.3)] font-mono mt-1">
                Confirm the transaction in your wallet
              </p>
            </div>
          )}

          {/* ── SUCCESS ───────────────────────────────────────────────────── */}
          {step === "success" && result && (
            <div className="flex flex-col gap-3">
              {/* Status banner */}
              <div className="flex items-center gap-2.5 p-3 rounded-sm bg-[rgba(0,255,65,0.04)] border border-[rgba(0,255,65,0.15)]">
                <div className="w-2 h-2 rounded-full bg-[#00FF41] shrink-0" />
                <div>
                  <p className="text-[11px] font-bold text-[#00FF41] font-mono tracking-wider">
                    DEPOSIT_CONFIRMED
                  </p>
                  <p className="text-[10px] text-[rgba(255,255,255,0.4)] font-mono">
                    {amount} {token.symbol} added to privacy pool
                  </p>
                </div>
              </div>

              {/* Wait warning */}
              <div className="p-3 rounded-sm bg-[rgba(245,158,11,0.04)] border border-[rgba(245,158,11,0.15)]">
                <div className="flex items-start gap-2">
                  <span className="text-[11px] shrink-0 mt-px text-[#F59E0B]">⏳</span>
                  <div>
                    <p className="text-[11px] font-bold text-[#F59E0B] font-mono mb-1">
                      Wait ~{MIN_WAIT_MINUTES} min before swapping
                    </p>
                    <p className="text-[10px] text-[rgba(255,255,255,0.35)] leading-relaxed font-mono">
                      Deposit must age {MIN_WAIT_BLOCKS} blocks (~{MIN_WAIT_MINUTES} min). Other deposits mix in,
                      making yours indistinguishable from theirs.
                    </p>
                  </div>
                </div>
              </div>

              {/* Note details */}
              <div className="p-3 rounded-sm bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.07)]">
                <p className="text-[9px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest font-mono mb-2">
                  DEPOSIT_NOTE
                </p>
                <div className="flex flex-col gap-1.5 mb-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-[rgba(255,255,255,0.35)] font-mono">Leaf Index</span>
                    <span className="text-[10px] font-mono text-[rgba(255,255,255,0.75)]">#{result.leafIndex}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-[rgba(255,255,255,0.35)] font-mono">Commitment</span>
                    <span className="text-[10px] font-mono text-[rgba(255,255,255,0.75)]">
                      {(() => {
                        const hex = "0x" + result.note.commitment.toString(16).padStart(64, "0");
                        return `${hex.slice(0, 10)}...${hex.slice(-8)}`;
                      })()}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCopyNote}
                  className="w-full py-2 rounded-sm bg-[rgba(0,255,65,0.05)] border border-[rgba(0,255,65,0.15)] cursor-pointer hover:bg-[rgba(0,255,65,0.1)] hover:border-[rgba(0,255,65,0.3)] transition-all"
                >
                  <span className="text-[10px] text-[#00FF41] font-semibold font-mono tracking-wider">
                    {copied ? "✓ COPIED" : "[ COPY_FULL_NOTE_DETAILS ]"}
                  </span>
                </button>
              </div>

              {/* Save note notice */}
              <div className="p-3 rounded-sm bg-[rgba(245,158,11,0.04)] border border-[rgba(245,158,11,0.12)]">
                <p className="text-[10px] text-[#F59E0B] font-semibold font-mono mb-1">
                  SAVE_YOUR_DEPOSIT_NOTE
                </p>
                <p className="text-[10px] text-[rgba(255,255,255,0.35)] leading-relaxed font-mono">
                  Note saved to this browser. Clearing browser data will lose access to this deposit.
                </p>
              </div>

              {/* Done */}
              <button
                type="button"
                onClick={handleClose}
                className="w-full py-3 rounded-sm bg-[rgba(0,255,65,0.08)] border border-[rgba(0,255,65,0.25)] text-[#00FF41] text-[12px] font-bold font-mono tracking-wider cursor-pointer hover:bg-[rgba(0,255,65,0.13)] hover:border-[rgba(0,255,65,0.5)] hover:shadow-[0_0_12px_rgba(0,255,65,0.1)] transition-all"
              >
                &gt; DONE
              </button>
            </div>
          )}

          {/* ── ERROR ─────────────────────────────────────────────────────── */}
          {step === "error" && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2.5 p-3 rounded-sm bg-[rgba(239,68,68,0.04)] border border-[rgba(239,68,68,0.2)]">
                <AlertCircleIcon size={14} color="#ef4444" />
                <div>
                  <p className="text-[11px] font-bold text-[#ef4444] font-mono">DEPOSIT_FAILED</p>
                  <p className="text-[10px] text-[rgba(255,255,255,0.4)] font-mono mt-0.5">{error}</p>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 py-3 rounded-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] cursor-pointer transition-all text-[11px] font-semibold text-[rgba(255,255,255,0.5)] hover:text-white hover:bg-[rgba(255,255,255,0.06)] font-mono tracking-wider"
                >
                  CANCEL
                </button>
                <button
                  type="button"
                  onClick={() => { setStep("input"); setError(null); }}
                  className="flex-1 py-3 rounded-sm bg-[rgba(0,255,65,0.08)] border border-[rgba(0,255,65,0.25)] cursor-pointer transition-all text-[11px] font-bold text-[#00FF41] hover:bg-[rgba(0,255,65,0.13)] hover:border-[rgba(0,255,65,0.5)] hover:shadow-[0_0_10px_rgba(0,255,65,0.1)] font-mono tracking-wider"
                >
                  TRY_AGAIN
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
