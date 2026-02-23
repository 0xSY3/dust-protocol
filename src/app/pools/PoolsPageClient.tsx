"use client";

import { useState, useCallback, useEffect } from "react";
import { type Address } from "viem";
import { useAccount, useSwitchChain, useChainId } from "wagmi";
import { useAuth } from "@/contexts/AuthContext";
import { getExplorerBase } from "@/lib/design/tokens";
import { V2SwapCard } from "@/components/swap/V2SwapCard";
import {
  SUPPORTED_TOKENS,
  getSwapContracts,
  isSwapSupported,
  getPoolForToken,
  DEPOSIT_DENOMINATIONS,
  type SwapToken,
} from "@/lib/swap/constants";
import { useDustSwapPool } from "@/hooks/swap";
import { useSwapNotes } from "@/hooks/swap";
import {
  ShieldIcon,
  ShieldCheckIcon,
  AlertCircleIcon,
  ExternalLinkIcon,
  PlusIcon,
  XIcon,
  RefreshIcon,
} from "@/components/stealth/icons";

const CoinsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="6" />
    <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
    <path d="M7 6h1v4" />
    <path d="m16.71 13.88.7.71-2.82 2.82" />
  </svg>
);

const DropletsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z" />
    <path d="M12.56 14.69c1.46 0 2.64-1.22 2.64-2.7 0-.78-.38-1.51-1.13-2.13C13.32 9.23 12.77 8.6 12.56 7.94c-.19.67-.75 1.3-1.51 1.92-.75.62-1.13 1.35-1.13 2.13 0 1.48 1.18 2.7 2.64 2.7z" />
  </svg>
);

const BarChartIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" />
  </svg>
);

const LockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

interface PoolInfo {
  id: string;
  token: SwapToken;
  poolAddress: string | null;
  isPrivacy: boolean;
}

function formatNumber(num: number, decimals: number = 2): string {
  if (num >= 1e9) return `${(num / 1e9).toFixed(decimals)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(decimals)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(decimals)}K`;
  if (num < 0.01 && num > 0) return num.toFixed(6);
  return num.toFixed(decimals);
}

function shortenAddress(addr: string): string {
  return `${addr.slice(0, 10)}...${addr.slice(-8)}`;
}

function PoolStatsModal({
  isOpen,
  onClose,
  pool,
  depositCount,
  notesCount,
  notesBalance,
}: {
  isOpen: boolean;
  onClose: () => void;
  pool: PoolInfo | null;
  depositCount: number;
  notesCount: number;
  notesBalance: number;
}) {
  if (!isOpen || !pool) return null;

  const explorerBase = getExplorerBase();

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[200]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-[480px] mx-4 bg-[rgba(10,10,15,0.95)] border border-[rgba(255,255,255,0.08)] rounded-sm shadow-2xl backdrop-blur-xl overflow-hidden relative">
        <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[rgba(255,255,255,0.1)]" />
        <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[rgba(255,255,255,0.1)]" />
        <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[rgba(255,255,255,0.1)]" />
        <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[rgba(255,255,255,0.1)]" />

        <div className="flex items-center justify-between px-6 py-5 border-b border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-sm bg-[rgba(0,255,65,0.1)] border border-[rgba(0,255,65,0.2)] flex items-center justify-center">
              <ShieldIcon size={18} color="#00FF41" />
            </div>
            <div>
              <p className="text-base font-bold text-white font-mono">{pool.token.symbol} Privacy Pool</p>
              <p className="text-[11px] text-[rgba(255,255,255,0.4)] font-mono">Poseidon commitment-based pool</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-sm hover:bg-[rgba(255,255,255,0.06)] transition-all cursor-pointer"
          >
            <XIcon size={15} color="rgba(255,255,255,0.4)" />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-4">
          <div className="p-3 rounded-sm bg-[rgba(0,255,65,0.04)] border border-[rgba(0,255,65,0.15)]">
            <div className="flex items-center gap-2 mb-1">
              <LockIcon />
              <span className="text-[11px] text-[#00FF41] font-semibold font-mono">Privacy Pool</span>
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.4)] leading-relaxed font-mono">
              Deposits are hidden using Poseidon hash commitments. Withdrawals require ZK-SNARK proofs, ensuring complete sender-receiver unlinkability.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="p-3 rounded-sm bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)]">
              <div className="flex items-center gap-1.5 mb-1 text-[#00FF41]">
                <BarChartIcon />
                <span className="text-[11px] text-[rgba(255,255,255,0.4)] font-medium font-mono">Total Deposits</span>
              </div>
              <p className="text-[13px] font-mono text-white font-medium">{depositCount}</p>
              <p className="text-[10px] text-[rgba(255,255,255,0.3)] mt-0.5 font-mono">On-chain commitments</p>
            </div>

            <div className="p-3 rounded-sm bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)]">
              <div className="flex items-center gap-1.5 mb-1 text-[#00FF41]">
                <CoinsIcon />
                <span className="text-[11px] text-[rgba(255,255,255,0.4)] font-medium font-mono">Your Notes</span>
              </div>
              <p className="text-[13px] font-mono text-white font-medium">{notesCount}</p>
              <p className="text-[10px] text-[rgba(255,255,255,0.3)] mt-0.5 font-mono">Unspent deposit notes</p>
            </div>
          </div>

          {notesCount > 0 && (
            <div className="p-3 rounded-sm bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.08)]">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-[11px] text-[rgba(255,255,255,0.4)] font-mono">Your Balance</p>
                  <p className="text-base font-mono text-[#00FF41] font-semibold">
                    {formatNumber(notesBalance, pool.token.decimals > 6 ? 4 : 2)} {pool.token.symbol}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-[rgba(255,255,255,0.4)] font-mono">Status</p>
                  <div className="flex items-center gap-1 justify-end">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#00FF41]" />
                    <span className="text-xs text-[#00FF41] font-semibold font-mono">Ready</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {pool.poolAddress && (
            <div className="p-3 rounded-sm bg-[rgba(0,255,65,0.04)] border border-[rgba(0,255,65,0.12)]">
              <p className="text-[11px] text-[rgba(255,255,255,0.4)] mb-1 font-mono">Pool Contract</p>
              <a
                href={`${explorerBase}/address/${pool.poolAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 no-underline"
              >
                <span className="text-xs font-mono text-[#00FF41]">{shortenAddress(pool.poolAddress)}</span>
                <ExternalLinkIcon size={12} color="#00FF41" />
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PoolRow({
  pool,
  depositCount,
  isLoading,
  notesCount,
  notesBalance,
  onDeposit,
  onViewStats,
}: {
  pool: PoolInfo;
  depositCount: number;
  isLoading: boolean;
  notesCount: number;
  notesBalance: number;
  onDeposit: (pool: PoolInfo) => void;
  onViewStats: (pool: PoolInfo) => void;
}) {
  const isActive = pool.poolAddress !== null;

  return (
    <button
      className="w-full text-left cursor-pointer"
      onClick={() => onViewStats(pool)}
    >
      <div className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-sm backdrop-blur-sm hover:border-[rgba(0,255,65,0.15)] hover:bg-[rgba(0,255,65,0.02)] transition-all relative">
        <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[rgba(255,255,255,0.1)]" />
        <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[rgba(255,255,255,0.1)]" />
        <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[rgba(255,255,255,0.1)]" />
        <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[rgba(255,255,255,0.1)]" />
        <div className="p-4">
          <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-3 items-center">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-sm bg-[rgba(255,255,255,0.06)] flex items-center justify-center shrink-0">
                <span className="text-[13px] font-bold text-white font-mono">
                  {pool.token.symbol === "ETH" ? "E" : "$"}
                </span>
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-white font-mono">{pool.token.symbol}</span>
                  <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-[rgba(0,255,65,0.1)]">
                    <ShieldIcon size={10} color="#00FF41" />
                    <span className="text-[10px] text-[#00FF41] font-semibold font-mono">Privacy</span>
                  </div>
                </div>
                <p className="text-[11px] text-[rgba(255,255,255,0.4)] font-mono">{pool.token.name} Privacy Pool</p>
              </div>
            </div>

            <div className="hidden sm:block">
              {isLoading ? (
                <div className="w-3 h-3 border-2 border-[#00FF41] border-t-transparent rounded-full animate-spin" />
              ) : (
                <div>
                  <p className="text-[13px] font-mono text-white">{depositCount}</p>
                  <p className="text-[10px] text-[rgba(255,255,255,0.4)] font-mono">Deposits</p>
                </div>
              )}
            </div>

            <div className="hidden sm:block">
              <p className={`text-[13px] font-mono ${notesCount > 0 ? "text-[#00FF41]" : "text-white"}`}>{notesCount}</p>
              <p className="text-[10px] text-[rgba(255,255,255,0.4)] font-mono">Your Notes</p>
            </div>

            <div className="hidden sm:block">
              {isActive ? (
                <div className="flex items-center gap-1 px-2 py-1 rounded-sm bg-[rgba(0,255,65,0.1)] w-fit">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#00FF41]" />
                  <span className="text-[11px] text-[#00FF41] font-semibold font-mono">Active</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 px-2 py-1 rounded-sm bg-[rgba(239,68,68,0.1)] w-fit">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  <span className="text-[11px] text-red-400 font-semibold font-mono">Unavailable</span>
                </div>
              )}
            </div>

            <button
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-sm border transition-all text-xs font-semibold font-mono
                ${isActive
                  ? "bg-[rgba(0,255,65,0.1)] border-[rgba(0,255,65,0.2)] hover:bg-[rgba(0,255,65,0.15)] hover:border-[#00FF41] hover:shadow-[0_0_15px_rgba(0,255,65,0.15)] text-[#00FF41] cursor-pointer"
                  : "bg-[rgba(255,255,255,0.02)] border-[rgba(255,255,255,0.06)] text-white cursor-not-allowed opacity-40"}`}
              onClick={(e) => {
                e.stopPropagation();
                if (isActive) onDeposit(pool);
              }}
            >
              <DropletsIcon />
              Deposit
            </button>
          </div>
        </div>
      </div>
    </button>
  );
}

function PoolDepositModal({
  isOpen,
  onClose,
  pool,
  onDeposit,
  depositState,
  depositError,
  onReset,
  depositNote,
}: {
  isOpen: boolean;
  onClose: () => void;
  pool: PoolInfo | null;
  onDeposit: (amount: string) => void;
  depositState: string;
  depositError: string | null;
  onReset: () => void;
  depositNote: any;
}) {
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (isOpen) {
      setAmount("");
      onReset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen || !pool) return null;

  const isProcessing = ["generating", "approving", "depositing", "confirming"].includes(depositState);
  const isSuccess = depositState === "success";
  const isError = depositState === "error";

  const denominations = DEPOSIT_DENOMINATIONS[pool.token.symbol] || DEPOSIT_DENOMINATIONS.ETH;

  const handleClose = () => {
    if (!isProcessing) {
      setAmount("");
      onReset();
      onClose();
    }
  };

  const stepLabel = (() => {
    switch (depositState) {
      case "generating": return "Generating commitment...";
      case "approving": return "Approving token...";
      case "depositing": return "Depositing to pool...";
      case "confirming": return "Confirming on-chain...";
      default: return "";
    }
  })();

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[200]"
      onClick={(e) => { if (e.target === e.currentTarget && !isProcessing) handleClose(); }}
    >
      <div className="w-full max-w-[440px] mx-4 bg-[rgba(10,10,15,0.95)] border border-[rgba(255,255,255,0.08)] rounded-sm shadow-2xl backdrop-blur-xl overflow-hidden relative">
        <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[rgba(255,255,255,0.1)]" />
        <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[rgba(255,255,255,0.1)]" />
        <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[rgba(255,255,255,0.1)]" />
        <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[rgba(255,255,255,0.1)]" />

        <div className="flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-sm bg-[rgba(0,255,65,0.1)] border border-[rgba(0,255,65,0.2)] flex items-center justify-center">
              <ShieldIcon size={18} color="#00FF41" />
            </div>
            <div>
              <p className="text-base font-bold text-white font-mono">Deposit {pool.token.symbol}</p>
              <p className="text-[11px] text-[rgba(255,255,255,0.4)] font-mono">Add to the {pool.token.symbol} privacy pool</p>
            </div>
          </div>
          {!isProcessing && (
            <button
              onClick={handleClose}
              className="p-2 rounded-sm hover:bg-[rgba(255,255,255,0.06)] transition-all cursor-pointer"
            >
              <XIcon size={15} color="rgba(255,255,255,0.4)" />
            </button>
          )}
        </div>

        <div className="px-6 pb-6">
          {!isProcessing && !isSuccess && !isError && (
            <div className="flex flex-col gap-5">
              <div className="p-3 rounded-sm bg-[rgba(0,255,65,0.04)] border border-[rgba(0,255,65,0.15)]">
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 shrink-0"><ShieldIcon size={14} color="#00FF41" /></div>
                  <p className="text-xs text-[rgba(255,255,255,0.4)] leading-relaxed font-mono">
                    Deposits are hidden using Poseidon commitments. Your deposit note is stored locally for swap execution.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono">Quick Select</p>
                <div className="flex gap-2">
                  {denominations.map((denom) => (
                    <button
                      key={denom}
                      className={`flex-1 py-2.5 rounded-sm border cursor-pointer transition-all text-center font-mono text-[13px] font-semibold
                        ${amount === denom
                          ? "bg-[rgba(0,255,65,0.1)] border-[rgba(0,255,65,0.3)] text-[#00FF41]"
                          : "bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.08)] text-white hover:bg-[rgba(255,255,255,0.07)]"}`}
                      onClick={() => setAmount(denom)}
                    >
                      {denom}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono">Or Enter Custom Amount</p>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setAmount(e.target.value.replace(/[^0-9.]/g, ""));
                  }}
                  placeholder={`0.0 ${pool.token.symbol}`}
                  className="w-full p-3 rounded-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.1)] text-white font-mono text-sm focus:outline-none focus:border-[#00FF41] focus:bg-[rgba(0,255,65,0.02)] transition-all placeholder-[rgba(255,255,255,0.2)]"
                />
              </div>

              <button
                className={`w-full py-3.5 rounded-sm text-[15px] font-bold text-center transition-all font-mono tracking-wider
                  ${amount && parseFloat(amount) > 0
                    ? "bg-[rgba(0,255,65,0.1)] border border-[rgba(0,255,65,0.2)] hover:bg-[rgba(0,255,65,0.15)] hover:border-[#00FF41] hover:shadow-[0_0_15px_rgba(0,255,65,0.15)] text-[#00FF41] cursor-pointer"
                    : "bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] text-white cursor-not-allowed opacity-40"}`}
                onClick={() => {
                  console.log('[PoolDepositModal] Deposit button clicked, amount:', amount);
                  if (amount && parseFloat(amount) > 0) {
                    console.log('[PoolDepositModal] Amount valid, calling onDeposit');
                    onDeposit(amount);
                  } else {
                    console.log('[PoolDepositModal] Amount invalid or empty');
                  }
                }}
              >
                {amount && parseFloat(amount) > 0 ? `Deposit ${amount} ${pool.token.symbol}` : "Enter Amount"}
              </button>
            </div>
          )}

          {isProcessing && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="w-8 h-8 border-2 border-[#00FF41] border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-semibold text-white font-mono">{stepLabel}</p>
              <p className="text-xs text-[rgba(255,255,255,0.4)] text-center font-mono">Please confirm the transaction in your wallet</p>
            </div>
          )}

          {isSuccess && (
            <div className="flex flex-col gap-4">
              <div className="text-center py-2">
                <div className="inline-flex mb-3">
                  <ShieldCheckIcon size={40} color="#00FF41" />
                </div>
                <p className="text-base font-bold text-white mb-1 font-mono">Deposit Successful</p>
                <p className="text-[13px] text-[rgba(255,255,255,0.5)] font-mono">{amount} {pool.token.symbol} deposited to privacy pool</p>
              </div>

              {depositNote && (
                <div className="p-3 rounded-sm bg-[rgba(0,255,65,0.04)] border border-[rgba(0,255,65,0.15)]">
                  <p className="text-xs text-[#00FF41] font-semibold mb-2 font-mono">Deposit Note Details</p>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between">
                      <span className="text-[11px] text-[rgba(255,255,255,0.4)] font-mono">Leaf Index</span>
                      <span className="text-[11px] font-mono text-white">#{depositNote.leafIndex ?? 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[11px] text-[rgba(255,255,255,0.4)] font-mono">Commitment</span>
                      <span className="text-[11px] font-mono text-white">
                        {depositNote.commitment ? (() => {
                          const hex = `0x${depositNote.commitment.toString(16).padStart(64, '0')}`;
                          return `${hex.slice(0, 10)}...${hex.slice(-8)}`;
                        })() : 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[11px] text-[rgba(255,255,255,0.4)] font-mono">Secret</span>
                      <span className="text-[11px] font-mono text-white">
                        {depositNote.secret ? (() => {
                          const hex = `0x${depositNote.secret.toString(16).padStart(64, '0')}`;
                          return `${hex.slice(0, 10)}...${hex.slice(-8)}`;
                        })() : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="p-3 rounded-sm bg-[rgba(245,158,11,0.06)] border border-[rgba(245,158,11,0.15)]">
                <p className="text-xs text-amber-400 font-semibold mb-1 font-mono">Save Your Deposit Note</p>
                <p className="text-[11px] text-[rgba(255,255,255,0.4)] leading-relaxed font-mono">
                  Your deposit note has been saved to this browser. If you clear browser data, you will lose access to this deposit.
                </p>
              </div>

              <button
                className="w-full py-3.5 rounded-sm bg-[rgba(0,255,65,0.1)] border border-[rgba(0,255,65,0.2)] hover:bg-[rgba(0,255,65,0.15)] hover:border-[#00FF41] hover:shadow-[0_0_15px_rgba(0,255,65,0.15)] text-[15px] font-bold text-[#00FF41] text-center cursor-pointer transition-all font-mono tracking-wider"
                onClick={handleClose}
              >
                Done
              </button>
            </div>
          )}

          {isError && (
            <div className="flex flex-col gap-4">
              <div className="text-center py-2">
                <div className="inline-flex mb-3">
                  <AlertCircleIcon size={40} color="#ef4444" />
                </div>
                <p className="text-base font-bold text-white mb-1 font-mono">Deposit Failed</p>
                <p className="text-[13px] text-[rgba(255,255,255,0.5)] font-mono">{depositError}</p>
              </div>

              <div className="flex gap-3">
                <button
                  className="flex-1 py-3.5 rounded-sm bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.07)] text-sm font-semibold text-white text-center cursor-pointer transition-all font-mono"
                  onClick={handleClose}
                >
                  Cancel
                </button>
                <button
                  className="flex-1 py-3.5 rounded-sm bg-[rgba(0,255,65,0.1)] border border-[rgba(0,255,65,0.2)] hover:bg-[rgba(0,255,65,0.15)] hover:border-[#00FF41] hover:shadow-[0_0_15px_rgba(0,255,65,0.15)] text-sm font-bold text-[#00FF41] text-center cursor-pointer transition-all font-mono tracking-wider"
                  onClick={onReset}
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

export default function PoolsPageClient() {
  const { isConnected, activeChainId } = useAuth();
  const walletChainId = useChainId();
  const swapSupported = isSwapSupported(activeChainId);
  const contracts = getSwapContracts(activeChainId);
  const explorerBase = getExplorerBase(activeChainId);
  const { switchChain } = useSwitchChain();

  const isWalletOnCorrectChain = walletChainId === 11155111;

  const pools: PoolInfo[] = [
    {
      id: "eth-privacy",
      token: SUPPORTED_TOKENS.ETH,
      poolAddress: contracts.dustSwapPoolETH,
      isPrivacy: true,
    },
    {
      id: "usdc-privacy",
      token: SUPPORTED_TOKENS.USDC,
      poolAddress: contracts.dustSwapPoolUSDC,
      isPrivacy: true,
    },
  ];

  const { deposit, state: depositState, error: depositError, reset: resetDeposit, getDepositCount, currentNote } = useDustSwapPool(activeChainId);
  const { unspentNotes, loading: notesLoading } = useSwapNotes();

  const [selectedPool, setSelectedPool] = useState<PoolInfo | null>(null);
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [statsPool, setStatsPool] = useState<PoolInfo | null>(null);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [ethDepositCount, setEthDepositCount] = useState(0);
  const [usdcDepositCount, setUsdcDepositCount] = useState(0);
  const [countsLoading, setCountsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"swap" | "global">("swap");

  const fetchCounts = useCallback(async () => {
    setCountsLoading(true);
    const [ethCount, usdcCount] = await Promise.all([
      getDepositCount(SUPPORTED_TOKENS.ETH.address as Address),
      getDepositCount(SUPPORTED_TOKENS.USDC.address as Address),
    ]);
    setEthDepositCount(ethCount);
    setUsdcDepositCount(usdcCount);
    setCountsLoading(false);
  }, [getDepositCount]);

  useEffect(() => {
    if (isConnected && swapSupported) {
      fetchCounts();
    }
  }, [isConnected, swapSupported, fetchCounts]);

  const ethNotes = unspentNotes.filter(
    (n) => n.tokenAddress.toLowerCase() === SUPPORTED_TOKENS.ETH.address.toLowerCase()
  );
  const usdcNotes = unspentNotes.filter(
    (n) => n.tokenAddress.toLowerCase() === SUPPORTED_TOKENS.USDC.address.toLowerCase()
  );
  const ethNotesBalance = ethNotes.reduce((acc, n) => acc + Number(n.amount) / 1e18, 0);
  const usdcNotesBalance = usdcNotes.reduce((acc, n) => acc + Number(n.amount) / 1e6, 0);

  const getPoolDepositCount = (pool: PoolInfo) =>
    pool.token.symbol === "ETH" ? ethDepositCount : usdcDepositCount;
  const getPoolNotes = (pool: PoolInfo) =>
    pool.token.symbol === "ETH" ? ethNotes : usdcNotes;
  const getPoolNotesBalance = (pool: PoolInfo) =>
    pool.token.symbol === "ETH" ? ethNotesBalance : usdcNotesBalance;

  const totalDeposits = ethDepositCount + usdcDepositCount;
  const activePools = pools.filter((p) => p.poolAddress !== null).length;
  const totalNotes = ethNotes.length + usdcNotes.length;

  useEffect(() => {
    if (isConnected && !swapSupported && switchChain) {
      const timer = setTimeout(() => {
        switchChain({ chainId: 11155111 });
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isConnected, swapSupported, switchChain]);

  const handleDeposit = (pool: PoolInfo) => {
    setSelectedPool(pool);
    setIsDepositOpen(true);
  };

  const handleViewStats = (pool: PoolInfo) => {
    setStatsPool(pool);
    setIsStatsOpen(true);
  };

  const handleExecuteDeposit = useCallback(
    async (amount: string) => {
      console.log('[PoolsPage] handleExecuteDeposit called with amount:', amount);
      console.log('[PoolsPage] selectedPool:', selectedPool);
      console.log('[PoolsPage] deposit function:', deposit);
      console.log('[PoolsPage] isConnected:', isConnected);
      console.log('[PoolsPage] walletChainId:', walletChainId);
      console.log('[PoolsPage] isWalletOnCorrectChain:', isWalletOnCorrectChain);

      if (!selectedPool) {
        console.log('[PoolsPage] No selected pool, returning');
        return;
      }

      if (!isConnected) {
        console.error('[PoolsPage] Wallet not connected!');
        return;
      }

      if (!isWalletOnCorrectChain && switchChain) {
        console.log('[PoolsPage] Wallet on wrong chain, switching to Ethereum Sepolia...');
        try {
          await switchChain({ chainId: 11155111 });
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (err) {
          console.error('[PoolsPage] Failed to switch chain:', err);
          return;
        }
      }

      const decimals = selectedPool.token.decimals;
      const amountBigInt = BigInt(
        Math.floor(parseFloat(amount) * Math.pow(10, decimals))
      );

      console.log('[PoolsPage] Calling deposit with:', {
        tokenAddress: selectedPool.token.address,
        tokenSymbol: selectedPool.token.symbol,
        amount: amountBigInt.toString(),
      });

      const result = await deposit(
        selectedPool.token.address as Address,
        selectedPool.token.symbol,
        amountBigInt
      );

      console.log('[PoolsPage] Deposit result:', result);
      console.log('[PoolsPage] Deposit error:', depositError);
      console.log('[PoolsPage] Deposit state:', depositState);

      if (result) {
        fetchCounts();
      } else {
        console.error('[PoolsPage] Deposit failed - check depositError state');
      }
    },
    [selectedPool, deposit, fetchCounts, walletChainId, isWalletOnCorrectChain, switchChain]
  );

  return (
    <div className="min-h-screen p-4 md:p-8 relative">
      <div className="max-w-[900px] mx-auto flex flex-col gap-6">
        <div>
          <h1 className="text-[28px] font-bold text-white tracking-tight mb-1 font-mono">[Privacy Pools]</h1>
          <p className="text-sm text-[rgba(255,255,255,0.5)] font-mono">Manage your shielded balances and swap pool deposits</p>
        </div>

        <div className="flex gap-6 border-b border-[rgba(255,255,255,0.08)] mb-2">
          <button
            className={`pb-3 text-sm font-bold font-mono transition-all cursor-pointer border-b-2 flex items-center gap-2 ${activeTab === "swap"
                ? "border-[#00FF41] text-white"
                : "border-transparent text-[rgba(255,255,255,0.5)] hover:text-[rgba(255,255,255,0.8)]"
              }`}
            onClick={() => setActiveTab("swap")}
          >
            Swap Pools <span className={`px-1.5 py-0.5 rounded-sm text-[9px] font-bold ${activeTab === "swap" ? "bg-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.8)]" : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.4)]"}`}>V1</span>
          </button>
          <button
            className={`pb-3 text-sm font-bold font-mono transition-all cursor-pointer border-b-2 flex items-center gap-2 ${activeTab === "global"
                ? "border-[#00FF41] text-white"
                : "border-transparent text-[rgba(255,255,255,0.5)] hover:text-[rgba(255,255,255,0.8)]"
              }`}
            onClick={() => setActiveTab("global")}
          >
            Global Pool <span className={`px-1.5 py-0.5 rounded-sm text-[9px] font-bold ${activeTab === "global" ? "bg-[rgba(0,255,65,0.15)] text-[#00FF41]" : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.4)]"}`}>V2</span>
          </button>
        </div>

        {activeTab === "global" && (
          <div className="flex flex-col gap-4 animate-in fade-in duration-300">
            <div className="p-3 rounded-sm bg-[rgba(0,255,65,0.04)] border border-[rgba(0,255,65,0.12)]">
              <p className="text-[12px] text-[rgba(255,255,255,0.4)] leading-relaxed font-mono">
                Deposit any amount of ETH into a single global pool. Transfer privately between users with hidden amounts,
                or withdraw to a fresh address with no link to the depositor. All operations use ZK proofs (FFLONK).
              </p>
            </div>
            <div className="flex justify-center mt-1">
              <V2SwapCard chainId={activeChainId} />
            </div>
          </div>
        )}

        {activeTab === "swap" && (
          <div className="flex flex-col gap-5 animate-in fade-in duration-300">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div className="p-3 rounded-sm bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] flex-1">
                <p className="text-[12px] text-[rgba(255,255,255,0.4)] leading-relaxed font-mono">
                  Fixed-denomination pools for private token swaps via Uniswap V4 hooks. Deposits are hidden using
                  Poseidon commitments and withdrawals require ZK-SNARK proofs for sender-receiver unlinkability.
                </p>
              </div>
              {swapSupported && (
                <button
                  className="flex items-center gap-1.5 px-4 py-3 rounded-sm bg-[rgba(0,255,65,0.1)] border border-[rgba(0,255,65,0.2)] hover:bg-[rgba(0,255,65,0.15)] hover:border-[#00FF41] transition-all text-sm font-bold text-[#00FF41] font-mono tracking-wider shrink-0 cursor-pointer h-[calc(100%-2px)]"
                  onClick={() => handleDeposit(pools[0])}
                >
                  <PlusIcon size={16} color="#00FF41" />
                  New Deposit
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-sm backdrop-blur-sm p-4 text-center relative">
                <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[rgba(255,255,255,0.1)]" />
                <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[rgba(255,255,255,0.1)]" />
                <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[rgba(255,255,255,0.1)]" />
                <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[rgba(255,255,255,0.1)]" />
                <p className="text-[9px] uppercase tracking-wider font-mono text-[rgba(255,255,255,0.5)] mb-1">Total Deposits</p>
                <p className="text-[22px] font-mono font-bold text-white">
                  {countsLoading
                    ? <span className="inline-block w-4 h-4 border-2 border-[#00FF41] border-t-transparent rounded-full animate-spin align-middle" />
                    : totalDeposits}
                </p>
              </div>

              <div className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-sm backdrop-blur-sm p-4 text-center relative">
                <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[rgba(255,255,255,0.1)]" />
                <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[rgba(255,255,255,0.1)]" />
                <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[rgba(255,255,255,0.1)]" />
                <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[rgba(255,255,255,0.1)]" />
                <p className="text-[9px] uppercase tracking-wider font-mono text-[rgba(255,255,255,0.5)] mb-1">Active Pools</p>
                <p className="text-[22px] font-mono font-bold text-white">{activePools}</p>
              </div>

              <div className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-sm backdrop-blur-sm p-4 text-center relative">
                <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[rgba(255,255,255,0.1)]" />
                <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[rgba(255,255,255,0.1)]" />
                <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[rgba(255,255,255,0.1)]" />
                <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[rgba(255,255,255,0.1)]" />
                <p className="text-[9px] uppercase tracking-wider font-mono text-[rgba(255,255,255,0.5)] mb-1">Your Notes</p>
                <p className="text-[22px] font-mono font-bold text-white">
                  {notesLoading
                    ? <span className="inline-block w-4 h-4 border-2 border-[#00FF41] border-t-transparent rounded-full animate-spin align-middle" />
                    : totalNotes}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <h2 className="text-[18px] font-bold text-white tracking-tight font-mono">[Available Swap Pools]</h2>

              <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-3 px-4 py-2">
                <p className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono">Pool</p>
                <p className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono">Deposits</p>
                <p className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono">Your Notes</p>
                <p className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono">Status</p>
                <div className="w-[90px]" />
              </div>

              {pools.map((pool) => (
                <PoolRow
                  key={pool.id}
                  pool={pool}
                  depositCount={getPoolDepositCount(pool)}
                  isLoading={countsLoading}
                  notesCount={getPoolNotes(pool).length}
                  notesBalance={getPoolNotesBalance(pool)}
                  onDeposit={handleDeposit}
                  onViewStats={handleViewStats}
                />
              ))}

              {!swapSupported && isConnected && (
                <div className="p-4 rounded-sm bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.2)]">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5"><AlertCircleIcon size={16} color="#f59e0b" /></div>
                      <div className="flex flex-col gap-1.5 flex-1">
                        <p className="text-[13px] font-semibold text-amber-400 font-mono">
                          Privacy Pools Only Available on Ethereum Sepolia
                        </p>
                        <p className="text-xs text-[rgba(255,255,255,0.4)] leading-relaxed font-mono">
                          DustSwap is currently deployed on Ethereum Sepolia testnet. More chains coming soon!
                        </p>
                      </div>
                    </div>
                    <button
                      className="w-full py-2.5 rounded-sm bg-[rgba(245,158,11,0.12)] border border-[rgba(245,158,11,0.3)] hover:bg-[rgba(245,158,11,0.18)] hover:border-[rgba(245,158,11,0.4)] text-[13px] font-semibold text-amber-400 cursor-pointer transition-all font-mono"
                      onClick={() => switchChain?.({ chainId: 11155111 })}
                    >
                      Switch to Ethereum Sepolia
                    </button>
                  </div>
                </div>
              )}
            </div>

            {swapSupported && (
              <div className="p-4 rounded-sm bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)]">
                <p className="text-[9px] uppercase tracking-wider font-mono text-[rgba(255,255,255,0.5)] mb-3">Contract Addresses</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {contracts.dustSwapPoolETH && (
                    <div>
                      <p className="text-[11px] text-[rgba(255,255,255,0.4)] mb-1 font-mono">ETH Privacy Pool</p>
                      <a
                        href={`${explorerBase}/address/${contracts.dustSwapPoolETH}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 no-underline"
                      >
                        <span className="text-xs font-mono text-[#00FF41]">{shortenAddress(contracts.dustSwapPoolETH)}</span>
                        <ExternalLinkIcon size={11} color="#00FF41" />
                      </a>
                    </div>
                  )}
                  {contracts.dustSwapPoolUSDC && (
                    <div>
                      <p className="text-[11px] text-[rgba(255,255,255,0.4)] mb-1 font-mono">USDC Privacy Pool</p>
                      <a
                        href={`${explorerBase}/address/${contracts.dustSwapPoolUSDC}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 no-underline"
                      >
                        <span className="text-xs font-mono text-[#00FF41]">{shortenAddress(contracts.dustSwapPoolUSDC)}</span>
                        <ExternalLinkIcon size={11} color="#00FF41" />
                      </a>
                    </div>
                  )}
                  {contracts.dustSwapHook && (
                    <div>
                      <p className="text-[11px] text-[rgba(255,255,255,0.4)] mb-1 font-mono">DustSwap Hook</p>
                      <a
                        href={`${explorerBase}/address/${contracts.dustSwapHook}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 no-underline"
                      >
                        <span className="text-xs font-mono text-[#00FF41]">{shortenAddress(contracts.dustSwapHook)}</span>
                        <ExternalLinkIcon size={11} color="#00FF41" />
                      </a>
                    </div>
                  )}
                  {contracts.dustSwapVerifier && (
                    <div>
                      <p className="text-[11px] text-[rgba(255,255,255,0.4)] mb-1 font-mono">ZK Verifier</p>
                      <a
                        href={`${explorerBase}/address/${contracts.dustSwapVerifier}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 no-underline"
                      >
                        <span className="text-xs font-mono text-[#00FF41]">{shortenAddress(contracts.dustSwapVerifier)}</span>
                        <ExternalLinkIcon size={11} color="#00FF41" />
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <PoolDepositModal
        isOpen={isDepositOpen}
        onClose={() => setIsDepositOpen(false)}
        pool={selectedPool}
        onDeposit={handleExecuteDeposit}
        depositState={depositState}
        depositError={depositError}
        onReset={resetDeposit}
        depositNote={currentNote}
      />

      <PoolStatsModal
        isOpen={isStatsOpen}
        onClose={() => setIsStatsOpen(false)}
        pool={statsPool}
        depositCount={statsPool ? getPoolDepositCount(statsPool) : 0}
        notesCount={statsPool ? getPoolNotes(statsPool).length : 0}
        notesBalance={statsPool ? getPoolNotesBalance(statsPool) : 0}
      />
    </div>
  );
}
