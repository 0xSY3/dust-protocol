"use client";

import { useState, useEffect, useCallback, useRef, type RefObject } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { parseEther, formatEther, isAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { useV2Withdraw, useV2Notes, useV2Split } from "@/hooks/dustpool/v2";
import { useV2Compliance } from "@/hooks/dustpool/v2/useV2Compliance";
import { useChainlinkPrice } from "@/hooks/swap/useChainlinkPrice";
import { COMPLIANCE_COOLDOWN_THRESHOLD_USD } from "@/lib/dustpool/v2/constants";
import {
  ShieldCheckIcon,
  AlertCircleIcon,
  XIcon,
  InfoIcon,
  ETHIcon,
} from "@/components/stealth/icons";
import type { V2Keys } from "@/lib/dustpool/v2/types";
import { errorToUserMessage } from "@/lib/dustpool/v2/errors";
import { decomposeForToken, formatChunks, suggestRoundedAmounts } from "@/lib/dustpool/v2/denominations";

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
  const { withdraw, isPending, status, txHash, error, clearError } = useV2Withdraw(keysRef, chainId);
  const { split, isPending: isSplitPending, status: splitStatus, error: splitError, clearError: clearSplitError } = useV2Split(keysRef, chainId);
  const { unspentNotes } = useV2Notes(keysRef, chainId);
  const { checkCooldown, cooldown } = useV2Compliance(chainId);
  const { price: chainlinkPrice } = useChainlinkPrice();

  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Find notes that will be consumed (simplified: show largest note >= amount)
  // Filter leafIndex >= 0 to match the hook's actual note selection (pending notes excluded)
  const consumedNote = (() => {
    if (!parsedAmount) return null;
    const eligible = unspentNotes
      .filter(n => n.leafIndex >= 0 && n.note.amount >= parsedAmount)
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

  // Check cooldown on consumed note
  useEffect(() => {
    if (!consumedNote) return;
    const commitmentHex = ("0x" + consumedNote.commitment.toString(16).padStart(64, "0")) as `0x${string}`;
    checkCooldown(commitmentHex);
  }, [consumedNote, checkCooldown]);

  // Countdown timer
  useEffect(() => {
    if (cooldown?.inCooldown && cooldown.remainingSeconds > 0) {
      setCooldownRemaining(cooldown.remainingSeconds);
      cooldownTimerRef.current = setInterval(() => {
        setCooldownRemaining(prev => {
          if (prev <= 1) {
            if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setCooldownRemaining(0);
    }
    return () => {
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, [cooldown]);

  const cooldownActive = cooldownRemaining > 0;
  const cooldownOriginator = cooldown?.originator;
  const recipientMatchesOriginator = cooldownOriginator
    ? recipient.toLowerCase() === cooldownOriginator.toLowerCase()
    : false;

  // Only enforce compliance cooldown for amounts >= $10K USD (BSA/AML threshold)
  const amountExceedsThreshold = parsedAmount !== null && chainlinkPrice != null
    ? (parseFloat(formatEther(parsedAmount)) * chainlinkPrice) >= COMPLIANCE_COOLDOWN_THRESHOLD_USD
    : parsedAmount !== null;
  const cooldownBlocksSubmit = cooldownActive && !recipientMatchesOriginator && amountExceedsThreshold;

  const formatCooldownTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const canWithdraw = parsedAmount !== null && !exceedsBalance && isValidRecipient && !isPending && !isSplitPending && !cooldownBlocksSubmit;

  const chunks = parsedAmount ? decomposeForToken(parsedAmount, "ETH") : [];
  const formattedChunkValues = chunks.length > 0 ? formatChunks(chunks, "ETH") : [];
  const roundSuggestions = parsedAmount && chunks.length > 1
    ? suggestRoundedAmounts(parsedAmount, "ETH", 2)
    : [];

  const useSplitFlow = chunks.length > 1;
  const activePending = useSplitFlow ? isSplitPending : isPending;
  const activeStatus = useSplitFlow ? splitStatus : status;
  const activeError = useSplitFlow ? splitError : error;
  const activeClearError = useSplitFlow ? clearSplitError : clearError;

  const handleWithdraw = async () => {
    if (!parsedAmount || !isValidRecipient) return;
    if (useSplitFlow) {
      await split(parsedAmount, recipient as Address);
    } else {
      await withdraw(parsedAmount, recipient as Address);
    }
  };

  const handleClose = useCallback(() => {
    if (!activePending) onClose();
  }, [activePending, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !activePending) handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, activePending, handleClose]);

  const handleMaxClick = () => {
    if (shieldedBalance > 0n) {
      setAmount(formatEther(shieldedBalance));
    }
  };

  const isSuccess = txHash !== null && !activePending && !activeError;
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
              {!activePending && (
                <button onClick={handleClose} data-testid="modal-close" className="text-[rgba(255,255,255,0.4)] hover:text-white transition-colors">
                  <XIcon size={20} />
                </button>
              )}
            </div>

            <div className="flex flex-col gap-4">
              {/* Input state */}
              {!activePending && !isSuccess && !activeError && (
                <>
                  {/* Shielded balance */}
                  <div className="p-4 rounded-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.05)]">
                    <p className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono mb-1">
                      Shielded Balance
                    </p>
                    <p className="text-2xl font-extrabold text-white font-mono flex items-baseline gap-2">
                      {formattedMax} <span className="text-base font-semibold text-[rgba(255,255,255,0.5)] flex items-center gap-1"><ETHIcon size={16} />ETH</span>
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
                      data-testid="withdraw-amount"
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
                        <span className="text-[11px] font-semibold text-white font-mono flex items-center gap-1">
                          {parseFloat(formatEther(consumedNote.note.amount)).toFixed(6)} <ETHIcon size={12} /> ETH
                        </span>
                      </div>
                      {changeAmount !== null && changeAmount > 0n && (
                        <div className="flex justify-between items-center">
                          <span className="text-[11px] text-[rgba(255,255,255,0.4)] font-mono">Change returned</span>
                          <span className="text-[11px] font-semibold text-[#00FF41] font-mono flex items-center gap-1">
                            {parseFloat(formatEther(changeAmount)).toFixed(6)} <ETHIcon size={12} /> ETH
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Denomination chunk preview — shows how withdrawal will be split for privacy */}
                  {parsedAmount && chunks.length > 1 && !exceedsBalance && (
                    <div className="p-3 rounded-sm bg-[rgba(0,255,65,0.03)] border border-[rgba(0,255,65,0.1)]">
                      <p className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono mb-2">
                        Privacy Split &mdash; {chunks.length} chunks
                      </p>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {formattedChunkValues.map((val, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 rounded-sm bg-[rgba(0,255,65,0.08)] border border-[rgba(0,255,65,0.15)] text-[10px] font-mono text-[#00FF41] inline-flex items-center gap-1"
                          >
                            <ETHIcon size={10} />{val} ETH
                          </span>
                        ))}
                      </div>
                      <p className="text-[10px] text-[rgba(255,255,255,0.35)] font-mono">
                        Each chunk blends into its denomination anonymity set.
                      </p>
                      {roundSuggestions.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-[rgba(255,255,255,0.05)]">
                          <p className="text-[10px] text-[rgba(255,255,255,0.4)] font-mono mb-1">
                            Fewer chunks = better privacy:
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {roundSuggestions.map((s, i) => (
                              <button
                                key={i}
                                onClick={() => setAmount(s.formatted)}
                                className="px-2 py-0.5 rounded-sm bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] hover:border-[#00FF41] text-[10px] font-mono text-[rgba(255,255,255,0.6)] hover:text-[#00FF41] transition-colors"
                              >
                                {s.formatted} ETH ({s.chunks} chunk{s.chunks !== 1 ? "s" : ""})
                              </button>
                            ))}
                          </div>
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
                      data-testid="withdraw-recipient"
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

                  {/* Cooldown warning — only for amounts >= $10K USD */}
                  {cooldownActive && consumedNote && amountExceedsThreshold && (
                    <div className="p-3 rounded-sm bg-[rgba(245,158,11,0.06)] border border-[rgba(245,158,11,0.15)]">
                      <div className="flex items-start gap-2">
                        <div className="flex-shrink-0 mt-0.5">
                          <InfoIcon size={14} color="#FFB000" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <p className="text-xs text-amber-400 font-semibold font-mono">
                            Deposit in cooldown &mdash; {formatCooldownTime(cooldownRemaining)} remaining
                          </p>
                          {cooldownOriginator && (
                            <p className="text-[11px] text-[rgba(255,255,255,0.4)] font-mono leading-relaxed">
                              Withdrawal must go to original depositor:{" "}
                              <span className="text-[rgba(255,255,255,0.6)] break-all">{cooldownOriginator}</span>
                            </p>
                          )}
                          {cooldownBlocksSubmit && (
                            <p className="text-[11px] text-red-400 font-mono">
                              Change recipient to the original depositor, or wait for cooldown to expire.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Relayer fee notice */}
                  <div className="p-2.5 rounded-sm bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]">
                    <p className="text-[11px] text-[rgba(255,255,255,0.4)] font-mono">
                      Withdrawal is processed via relayer. A small fee may apply to cover gas.
                    </p>
                  </div>

                  {/* Withdraw button */}
                  <button
                    data-testid="withdraw-submit"
                    onClick={handleWithdraw}
                    disabled={!canWithdraw}
                    className="w-full py-3 rounded-sm bg-[rgba(0,255,65,0.1)] border border-[rgba(0,255,65,0.2)] hover:bg-[rgba(0,255,65,0.15)] hover:border-[#00FF41] hover:shadow-[0_0_15px_rgba(0,255,65,0.15)] transition-all text-sm font-bold text-[#00FF41] font-mono tracking-wider disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {parsedAmount
                      ? useSplitFlow
                        ? `Split & Withdraw ${amount} ETH`
                        : `Withdraw ${amount} ETH`
                      : "Enter Amount"}
                  </button>
                </>
              )}

              {/* Processing */}
              {activePending && (
                <div className="flex flex-col items-center gap-4 py-6">
                  <div className="w-8 h-8 border-2 border-[#00FF41] border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm font-semibold text-white font-mono">
                    {activeStatus || (useSplitFlow ? "Generating denomination split proof..." : "Generating ZK proof...")}
                  </p>
                  {useSplitFlow ? (
                    <div className="flex items-center gap-2 text-[10px] text-[rgba(255,255,255,0.3)] font-mono">
                      <span className="text-[#00FF41]">proof</span>
                      <span>&rarr;</span>
                      <span className={activeStatus?.includes("Verifying") ? "text-[#00FF41]" : ""}>verify</span>
                      <span>&rarr;</span>
                      <span className={activeStatus?.includes("Submitting") ? "text-[#00FF41]" : ""}>submit</span>
                      <span>&rarr;</span>
                      <span className={activeStatus?.includes("Confirming") ? "text-[#00FF41]" : ""}>confirm</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-[10px] text-[rgba(255,255,255,0.3)] font-mono">
                      <span className="text-[#00FF41]">proof</span>
                      <span>&rarr;</span>
                      <span className={activeStatus?.includes("Submitting") || activeStatus?.includes("Confirming") ? "text-[#00FF41]" : ""}>submit</span>
                      <span>&rarr;</span>
                      <span className={activeStatus?.includes("Confirming") ? "text-[#00FF41]" : ""}>confirm</span>
                    </div>
                  )}
                </div>
              )}

              {/* Success */}
              {isSuccess && (
                <div className="flex flex-col gap-4">
                  <div className="text-center py-2">
                    <div className="inline-flex mb-3">
                      <ShieldCheckIcon size={40} color="#00FF41" />
                    </div>
                    <p className="text-base font-bold text-white mb-1 font-mono">
                      {useSplitFlow ? "Denomination Split Successful" : "Withdrawal Successful"}
                    </p>
                    <p className="text-[13px] text-[rgba(255,255,255,0.5)] font-mono">{amount} ETH withdrawn privately</p>
                  </div>

                  {useSplitFlow && (
                    <div className="p-3 rounded-sm bg-[rgba(0,255,65,0.04)] border border-[rgba(0,255,65,0.15)]">
                      <p className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono mb-2">
                        {chunks.length} denomination notes created
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {formattedChunkValues.map((val, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 rounded-sm bg-[rgba(0,255,65,0.08)] border border-[rgba(0,255,65,0.15)] text-[10px] font-mono text-[#00FF41]"
                          >
                            {val} ETH
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {txHash && (
                    <div className="p-3 rounded-sm bg-[rgba(0,255,65,0.04)] border border-[rgba(0,255,65,0.15)]">
                      <p className="text-[11px] text-[rgba(255,255,255,0.4)] mb-1 font-mono">Transaction</p>
                      <p className="text-xs font-mono text-[#00FF41] break-all">{txHash}</p>
                    </div>
                  )}

                  <div className="p-3 rounded-sm bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)]">
                    <p className="text-[11px] text-[rgba(255,255,255,0.4)] mb-1 font-mono">Recipient</p>
                    <p className="text-xs font-mono text-white break-all">{recipient}</p>
                  </div>

                  {changeAmount !== null && changeAmount > 0n && (
                    <div className="p-3 rounded-sm bg-[rgba(245,158,11,0.06)] border border-[rgba(245,158,11,0.15)]">
                      <p className="text-xs text-amber-400 font-semibold mb-1 font-mono">Change Note Saved</p>
                      <p className="text-[11px] text-[rgba(255,255,255,0.4)] leading-relaxed font-mono">
                        {parseFloat(formatEther(changeAmount)).toFixed(6)} ETH returned as a new shielded note.
                      </p>
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
              {activeError && !activePending && (
                <div className="flex flex-col gap-4">
                  <div className="text-center py-2">
                    <div className="inline-flex mb-3">
                      <AlertCircleIcon size={40} color="#ef4444" />
                    </div>
                    <p className="text-base font-bold text-white mb-1 font-mono">
                      {useSplitFlow ? "Split Failed" : "Withdrawal Failed"}
                    </p>
                    <p className="text-[13px] text-[rgba(255,255,255,0.5)] font-mono">{errorToUserMessage(activeError)}</p>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={handleClose}
                      className="flex-1 py-3 rounded-sm bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.07)] text-sm font-semibold text-white font-mono transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => { activeClearError(); setAmount(""); }}
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
