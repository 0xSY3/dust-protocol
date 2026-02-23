"use client";

import { useState, useEffect, useCallback, type RefObject } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { parseEther, formatEther } from "viem";
import { useAccount, useBalance } from "wagmi";
import { useV2Deposit, useV2Compliance } from "@/hooks/dustpool/v2";
import {
  ShieldIcon,
  ShieldCheckIcon,
  AlertCircleIcon,
  XIcon,
} from "@/components/stealth/icons";
import type { V2Keys } from "@/lib/dustpool/v2/types";
import { errorToUserMessage } from "@/lib/dustpool/v2/errors";

interface V2DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  keysRef: RefObject<V2Keys | null>;
  chainId?: number;
}

export function V2DepositModal({ isOpen, onClose, keysRef, chainId }: V2DepositModalProps) {
  const { address } = useAccount();
  const { data: walletBalance } = useBalance({ address });
  const { deposit, isPending, txHash, error, clearError } = useV2Deposit(keysRef, chainId);
  const { screenAddress, screeningResult, isScreening, clearScreening } = useV2Compliance(chainId);

  const [amount, setAmount] = useState("");
  const [maxWarning, setMaxWarning] = useState("");

  useEffect(() => {
    if (isOpen) {
      setAmount("");
      setMaxWarning("");
      clearScreening();
      if (address) screenAddress();
    }
  }, [isOpen, address, clearScreening, screenAddress]);

  const parsedAmount = (() => {
    try {
      const num = parseFloat(amount);
      if (isNaN(num) || num <= 0) return null;
      return parseEther(amount);
    } catch {
      return null;
    }
  })();

  const walletBalanceFormatted = walletBalance
    ? parseFloat(formatEther(walletBalance.value)).toFixed(4)
    : "0.0000";

  const exceedsBalance = parsedAmount !== null && walletBalance
    ? parsedAmount > walletBalance.value
    : false;

  const isScreeningBlocked = screeningResult?.status === 'blocked';
  const isScreeningPassed = screeningResult?.status === 'clear' || screeningResult?.status === 'no-screening';
  const canDeposit = parsedAmount !== null && !exceedsBalance && !isPending && !isScreening && isScreeningPassed;

  const handleDeposit = async () => {
    if (!parsedAmount) return;
    await deposit(parsedAmount);
  };

  const handleClose = useCallback(() => {
    if (!isPending) onClose();
  }, [isPending, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, isPending, handleClose]);

  const handleMaxClick = () => {
    if (!walletBalance) return;
    const reserved = parseEther("0.005");
    const max = walletBalance.value > reserved ? walletBalance.value - reserved : 0n;
    if (max > 0n) {
      setAmount(formatEther(max));
      setMaxWarning("");
    } else {
      setAmount("0");
      setMaxWarning("Wallet balance too low (gas reserve: 0.005 ETH)");
    }
  };

  const isSuccess = txHash !== null && !isPending && !error;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className="relative w-full max-w-[440px] p-6 rounded-md border border-[rgba(255,255,255,0.1)] bg-[#06080F] shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-2">
                <ShieldIcon size={16} color="#00FF41" />
                <span className="text-sm font-bold text-white font-mono tracking-wider">
                  [ DEPOSIT_V2 ]
                </span>
              </div>
              {!isPending && (
                <button onClick={handleClose} data-testid="modal-close" className="text-[rgba(255,255,255,0.4)] hover:text-white transition-colors">
                  <XIcon size={20} />
                </button>
              )}
            </div>

            <div className="flex flex-col gap-4">
              {/* Input state */}
              {!isPending && !isSuccess && !error && (
                <>
                  {/* Compliance screening status */}
                  {isScreening && (
                    <div className="p-3 rounded-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.1)]">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 border border-[#00FF41] border-t-transparent rounded-full animate-spin" />
                        <p className="text-xs text-[rgba(255,255,255,0.5)] font-mono">Screening address...</p>
                      </div>
                    </div>
                  )}
                  {isScreeningBlocked && (
                    <div className="p-3 rounded-sm bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.2)]">
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 shrink-0"><AlertCircleIcon size={14} color="#ef4444" /></div>
                        <p className="text-xs text-red-400 font-mono">
                          Address blocked by compliance screening. Deposits are not available.
                        </p>
                      </div>
                    </div>
                  )}
                  {isScreeningPassed && !isScreening && (
                    <div className="p-3 rounded-sm bg-[rgba(0,255,65,0.04)] border border-[rgba(0,255,65,0.15)]">
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 shrink-0"><ShieldCheckIcon size={14} color="#00FF41" /></div>
                        <p className="text-xs text-[rgba(255,255,255,0.4)] leading-relaxed font-mono">
                          Address cleared. V2 pool supports arbitrary deposit amounts. Note stored locally in IndexedDB.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Info (fallback when screening errored) */}
                  {screeningResult?.status === 'error' && (
                    <div className="p-3 rounded-sm bg-[rgba(245,158,11,0.06)] border border-[rgba(245,158,11,0.15)]">
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 shrink-0"><ShieldIcon size={14} color="#f59e0b" /></div>
                        <p className="text-xs text-amber-400 font-mono">
                          Compliance check unavailable. Deposit may fail if address is blocked on-chain.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Amount input */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono">
                        Amount (ETH)
                      </label>
                      <button
                        onClick={handleMaxClick}
                        className="text-[10px] text-[#00FF41] font-mono hover:underline"
                      >
                        MAX: {walletBalanceFormatted} ETH
                      </button>
                    </div>
                    <input
                      data-testid="deposit-amount"
                      type="text"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        setAmount(e.target.value.replace(/[^0-9.]/g, ""));
                      }}
                      placeholder="0.0"
                      className="w-full p-3 rounded-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.1)] text-white font-mono text-sm focus:outline-none focus:border-[#00FF41] focus:bg-[rgba(0,255,65,0.02)] transition-all placeholder-[rgba(255,255,255,0.2)]"
                    />
                    {exceedsBalance && (
                      <p className="text-[11px] text-red-400 font-mono">Insufficient wallet balance</p>
                    )}
                    {maxWarning && (
                      <p className="text-[11px] text-amber-400 font-mono">{maxWarning}</p>
                    )}
                  </div>

                  {/* Deposit button */}
                  <button
                    data-testid="deposit-submit"
                    onClick={handleDeposit}
                    disabled={!canDeposit}
                    className="w-full py-3 rounded-sm bg-[rgba(0,255,65,0.1)] border border-[rgba(0,255,65,0.2)] hover:bg-[rgba(0,255,65,0.15)] hover:border-[#00FF41] hover:shadow-[0_0_15px_rgba(0,255,65,0.15)] transition-all text-sm font-bold text-[#00FF41] font-mono tracking-wider disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {parsedAmount ? `Deposit ${amount} ETH` : "Enter Amount"}
                  </button>
                </>
              )}

              {/* Processing */}
              {isPending && (
                <div className="flex flex-col items-center gap-4 py-6">
                  <div className="w-8 h-8 border-2 border-[#00FF41] border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm font-semibold text-white font-mono">Depositing to V2 pool...</p>
                  <p className="text-xs text-[rgba(255,255,255,0.4)] text-center font-mono">Confirm the transaction in your wallet</p>
                </div>
              )}

              {/* Success */}
              {isSuccess && (
                <div className="flex flex-col gap-4">
                  <div className="text-center py-2">
                    <div className="inline-flex mb-3">
                      <ShieldCheckIcon size={40} color="#00FF41" />
                    </div>
                    <p className="text-base font-bold text-white mb-1 font-mono">Deposit Successful</p>
                    <p className="text-[13px] text-[rgba(255,255,255,0.5)] font-mono">{amount} ETH deposited to V2 privacy pool</p>
                  </div>

                  {txHash && (
                    <div className="p-3 rounded-sm bg-[rgba(0,255,65,0.04)] border border-[rgba(0,255,65,0.15)]">
                      <p className="text-[11px] text-[rgba(255,255,255,0.4)] mb-1 font-mono">Transaction</p>
                      <p className="text-xs font-mono text-[#00FF41] break-all">{txHash}</p>
                    </div>
                  )}

                  <div className="p-3 rounded-sm bg-[rgba(245,158,11,0.06)] border border-[rgba(245,158,11,0.15)]">
                    <p className="text-xs text-amber-400 font-semibold mb-1 font-mono">Note Saved Locally</p>
                    <p className="text-[11px] text-[rgba(255,255,255,0.4)] leading-relaxed font-mono">
                      Your UTXO note is stored in this browser&apos;s IndexedDB. Clearing browser data will lose access to this deposit.
                    </p>
                  </div>

                  <div className="p-3 rounded-sm bg-[rgba(99,102,241,0.06)] border border-[rgba(99,102,241,0.15)]">
                    <p className="text-xs text-indigo-400 font-semibold mb-1 font-mono">1-Hour Cooldown Active</p>
                    <p className="text-[11px] text-[rgba(255,255,255,0.4)] leading-relaxed font-mono">
                      For compliance, private transfers are available after a 1-hour cooldown. During this period, you can only withdraw back to your deposit address.
                    </p>
                  </div>

                  <button
                    onClick={handleClose}
                    className="w-full py-3 rounded-sm bg-[rgba(0,255,65,0.1)] border border-[rgba(0,255,65,0.2)] hover:bg-[rgba(0,255,65,0.15)] hover:border-[#00FF41] transition-all text-sm font-bold text-[#00FF41] font-mono tracking-wider"
                  >
                    Done
                  </button>
                </div>
              )}

              {/* Error */}
              {error && !isPending && (
                <div className="flex flex-col gap-4">
                  <div className="text-center py-2">
                    <div className="inline-flex mb-3">
                      <AlertCircleIcon size={40} color="#ef4444" />
                    </div>
                    <p className="text-base font-bold text-white mb-1 font-mono">Deposit Failed</p>
                    <p className="text-[13px] text-[rgba(255,255,255,0.5)] font-mono">{errorToUserMessage(error)}</p>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={handleClose}
                      className="flex-1 py-3 rounded-sm bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.07)] text-sm font-semibold text-white font-mono transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => { clearError(); setAmount(""); }}
                      className="flex-1 py-3 rounded-sm bg-[rgba(0,255,65,0.1)] border border-[rgba(0,255,65,0.2)] hover:bg-[rgba(0,255,65,0.15)] hover:border-[#00FF41] text-sm font-bold text-[#00FF41] font-mono tracking-wider transition-all"
                    >
                      Try Again
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Corner accents */}
            <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[rgba(255,255,255,0.1)]" />
            <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[rgba(255,255,255,0.1)]" />
            <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[rgba(255,255,255,0.1)]" />
            <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[rgba(255,255,255,0.1)]" />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
