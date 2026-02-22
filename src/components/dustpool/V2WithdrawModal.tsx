"use client";

import { useState, useEffect, type RefObject } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { parseEther, formatEther, isAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { useV2Withdraw, useV2Notes } from "@/hooks/dustpool/v2";
import {
  ShieldCheckIcon,
  AlertCircleIcon,
  XIcon,
} from "@/components/stealth/icons";
import type { V2Keys } from "@/lib/dustpool/v2/types";

interface V2WithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  keysRef: RefObject<V2Keys | null>;
  chainId?: number;
  shieldedBalance: bigint;
}

export function V2WithdrawModal({
  isOpen,
  onClose,
  keysRef,
  chainId,
  shieldedBalance,
}: V2WithdrawModalProps) {
  const { address } = useAccount();
  const { withdraw, isPending, txHash, error } = useV2Withdraw(keysRef, chainId);
  const { unspentNotes } = useV2Notes(keysRef, chainId);

  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");

  useEffect(() => {
    if (isOpen) {
      setAmount("");
      setRecipient(address ?? "");
    }
  }, [isOpen, address]);

  const parsedAmount = (() => {
    try {
      const num = parseFloat(amount);
      if (isNaN(num) || num <= 0) return null;
      return parseEther(amount);
    } catch {
      return null;
    }
  })();

  const exceedsBalance = parsedAmount !== null && parsedAmount > shieldedBalance;
  const isValidRecipient = isAddress(recipient);
  const canWithdraw = parsedAmount !== null && !exceedsBalance && isValidRecipient && !isPending;

  // Find notes that will be consumed (simplified: show largest note >= amount)
  const consumedNote = (() => {
    if (!parsedAmount) return null;
    const eligible = unspentNotes
      .filter(n => n.note.amount >= parsedAmount)
      .sort((a, b) => {
        const diff = a.note.amount - b.note.amount;
        if (diff < 0n) return -1;
        if (diff > 0n) return 1;
        return 0;
      });
    return eligible[0] ?? null;
  })();

  const changeAmount = consumedNote && parsedAmount
    ? consumedNote.note.amount - parsedAmount
    : null;

  const handleWithdraw = async () => {
    if (!parsedAmount || !isValidRecipient) return;
    await withdraw(parsedAmount, recipient as Address);
  };

  const handleClose = () => {
    if (!isPending) onClose();
  };

  const handleMaxClick = () => {
    if (shieldedBalance > 0n) {
      setAmount(formatEther(shieldedBalance));
    }
  };

  const isSuccess = txHash !== null && !isPending && !error;
  const formattedMax = parseFloat(formatEther(shieldedBalance)).toFixed(4);

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
                <span className="text-sm font-bold text-white font-mono tracking-wider">
                  [ WITHDRAW_V2 ]
                </span>
              </div>
              {!isPending && (
                <button onClick={handleClose} className="text-[rgba(255,255,255,0.4)] hover:text-white transition-colors">
                  <XIcon size={20} />
                </button>
              )}
            </div>

            <div className="flex flex-col gap-4">
              {/* Input state */}
              {!isPending && !isSuccess && !error && (
                <>
                  {/* Shielded balance */}
                  <div className="p-4 rounded-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.05)]">
                    <p className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono mb-1">
                      Shielded Balance
                    </p>
                    <p className="text-2xl font-extrabold text-white font-mono">
                      {formattedMax} <span className="text-base font-semibold text-[rgba(255,255,255,0.5)]">ETH</span>
                    </p>
                    <p className="text-xs text-[rgba(255,255,255,0.4)] font-mono mt-1">
                      {unspentNotes.length} unspent note{unspentNotes.length !== 1 ? "s" : ""}
                    </p>
                  </div>

                  {/* Amount input */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono">
                        Withdraw Amount (ETH)
                      </label>
                      <button
                        onClick={handleMaxClick}
                        className="text-[10px] text-[#00FF41] font-mono hover:underline"
                      >
                        MAX
                      </button>
                    </div>
                    <input
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
                      <p className="text-[11px] text-red-400 font-mono">Amount exceeds shielded balance</p>
                    )}
                  </div>

                  {/* Note consumption preview */}
                  {consumedNote && parsedAmount && (
                    <div className="p-3 rounded-sm bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]">
                      <p className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono mb-2">
                        Note Selection
                      </p>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[11px] text-[rgba(255,255,255,0.4)] font-mono">Input note</span>
                        <span className="text-[11px] font-semibold text-white font-mono">
                          {parseFloat(formatEther(consumedNote.note.amount)).toFixed(6)} ETH
                        </span>
                      </div>
                      {changeAmount !== null && changeAmount > 0n && (
                        <div className="flex justify-between items-center">
                          <span className="text-[11px] text-[rgba(255,255,255,0.4)] font-mono">Change returned</span>
                          <span className="text-[11px] font-semibold text-[#00FF41] font-mono">
                            {parseFloat(formatEther(changeAmount)).toFixed(6)} ETH
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Recipient input */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono">
                      Recipient Address
                    </label>
                    <input
                      type="text"
                      placeholder="0x..."
                      value={recipient}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRecipient(e.target.value)}
                      className="w-full p-3 rounded-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.1)] text-white font-mono text-sm focus:outline-none focus:border-[#00FF41] focus:bg-[rgba(0,255,65,0.02)] transition-all placeholder-[rgba(255,255,255,0.2)]"
                    />
                    {recipient && !isValidRecipient && (
                      <p className="text-[11px] text-red-400 font-mono">Invalid Ethereum address</p>
                    )}
                    <p className="text-[11px] text-[rgba(255,255,255,0.3)] font-mono">
                      Use a fresh address for maximum privacy. Defaults to connected wallet.
                    </p>
                  </div>

                  {/* Relayer fee notice */}
                  <div className="p-2.5 rounded-sm bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]">
                    <p className="text-[11px] text-[rgba(255,255,255,0.4)] font-mono">
                      Withdrawal is processed via relayer. A small fee may apply to cover gas.
                    </p>
                  </div>

                  {/* Withdraw button */}
                  <button
                    onClick={handleWithdraw}
                    disabled={!canWithdraw}
                    className="w-full py-3 rounded-sm bg-[rgba(0,255,65,0.1)] border border-[rgba(0,255,65,0.2)] hover:bg-[rgba(0,255,65,0.15)] hover:border-[#00FF41] hover:shadow-[0_0_15px_rgba(0,255,65,0.15)] transition-all text-sm font-bold text-[#00FF41] font-mono tracking-wider disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {parsedAmount ? `Withdraw ${amount} ETH` : "Enter Amount"}
                  </button>
                </>
              )}

              {/* Processing */}
              {isPending && (
                <div className="flex flex-col items-center gap-4 py-6">
                  <div className="w-8 h-8 border-2 border-[#00FF41] border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm font-semibold text-white font-mono">Generating ZK proof...</p>
                  <p className="text-xs text-[rgba(255,255,255,0.4)] text-center font-mono">This may take a moment while the proof is generated and submitted to the relayer</p>
                </div>
              )}

              {/* Success */}
              {isSuccess && (
                <div className="flex flex-col gap-4">
                  <div className="text-center py-2">
                    <div className="inline-flex mb-3">
                      <ShieldCheckIcon size={40} color="#00FF41" />
                    </div>
                    <p className="text-base font-bold text-white mb-1 font-mono">Withdrawal Successful</p>
                    <p className="text-[13px] text-[rgba(255,255,255,0.5)] font-mono">{amount} ETH withdrawn privately</p>
                  </div>

                  {txHash && (
                    <div className="p-3 rounded-sm bg-[rgba(0,255,65,0.04)] border border-[rgba(0,255,65,0.15)]">
                      <p className="text-[11px] text-[rgba(255,255,255,0.4)] mb-1 font-mono">Transaction</p>
                      <p className="text-xs font-mono text-[#00FF41] break-all">{txHash}</p>
                    </div>
                  )}

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
                    <p className="text-base font-bold text-white mb-1 font-mono">Withdrawal Failed</p>
                    <p className="text-[13px] text-[rgba(255,255,255,0.5)] font-mono">{error}</p>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={handleClose}
                      className="flex-1 py-3 rounded-sm bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.07)] text-sm font-semibold text-white font-mono transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => setAmount("")}
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
