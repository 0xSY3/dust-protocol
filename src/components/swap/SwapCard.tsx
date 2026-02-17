"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { type Address } from "viem";
import { useSwitchChain } from "wagmi";
import { SUPPORTED_TOKENS, RELAYER_FEE_BPS, DEFAULT_SLIPPAGE_MULTIPLIER, type SwapToken, isSwapSupported } from "@/lib/swap/constants";
import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { useAuth } from "@/contexts/AuthContext";
import { useSwapNotes, useDustSwap, useSwapMerkleTree, useDustSwapPool, useSwapQuote } from "@/hooks/swap";
import { checkRelayerHealth, getRelayerInfo, type RelayerInfo } from "@/lib/swap/relayer";
import { TokenInput } from "./TokenInput";
import { TokenSelector } from "./TokenSelector";
import { SwapExecuteModal, type SwapStep } from "./SwapExecuteModal";
import { DepositModal } from "./DepositModal";
import { AlertCircleIcon } from "@/components/stealth/icons";
import { NoteSelector } from "./NoteSelector";
import { type StoredSwapNote } from "@/lib/swap/storage/swap-notes";

type SwapState = "idle" | SwapStep;

/** Map useDustSwap hook states → SwapExecuteModal step */
function mapDustSwapStateToStep(hookState: string): SwapStep {
  switch (hookState) {
    case "selecting-note": return "preparing";
    case "syncing-tree": return "building-merkle";
    case "generating-proof": return "computing-proof";
    case "submitting":
    case "confirming": return "submitting";
    case "success": return "success";
    case "error": return "error";
    default: return "preparing";
  }
}

/** Human-readable step message for each useDustSwap state */
function getDustSwapStepMessage(hookState: string): string {
  switch (hookState) {
    case "selecting-note": return "Preparing swap...";
    case "syncing-tree": return "Building Merkle tree...";
    case "generating-proof": return "Computing ZK-SNARK proof...";
    case "submitting": return "Submitting to relayer...";
    case "confirming": return "Waiting for confirmation...";
    case "success": return "Swap complete!";
    case "error": return "Swap failed";
    default: return "Preparing swap...";
  }
}

export function SwapCard() {
  const { isConnected, activeChainId, selectedClaimAddress } = useAuth();
  const swapSupported = isSwapSupported(activeChainId);
  const { switchChain } = useSwitchChain();

  // ── Token state (must be before useSwapMerkleTree so poolType can be derived) ──
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [fromToken, setFromToken] = useState<SwapToken>(SUPPORTED_TOKENS.ETH);
  const [toToken, setToToken] = useState<SwapToken>(SUPPORTED_TOKENS.USDC);

  // Determine which pool's Merkle tree to sync based on the from-token
  const poolType = fromToken.symbol === 'USDC' ? 'usdc' as const : 'eth' as const;

  // ── Real hooks ──────────────────────────────────────────────────────────────
  const { unspentNotes, loading: notesLoading } = useSwapNotes();
  const {
    leafCount,
    isSyncing: treeSyncing,
    isSynced: treeSynced,
    isError: treeError,
    error: treeErrorMessage,
    syncTree,
    forceRefresh,
    getProof,
    getRoot,
  } = useSwapMerkleTree(activeChainId, poolType);
  const {
    state: dustSwapState,
    error: dustSwapError,
    txHash: dustSwapTxHash,
    executeSwap,
    reset: resetDustSwap,
    isLoading: isDustSwapLoading,
  } = useDustSwap({
    chainId: activeChainId,
    poolType,
    merkleTree: { getProof, syncTree, getRoot, isSyncing: treeSyncing },
  });
  const { deposit: depositToPool } = useDustSwapPool(activeChainId);

  // Price quote from Uniswap V4 quoter
  const {
    amountOut: quotedAmountOut,
    isLoading: isQuoteLoading,
    error: quoteError,
  } = useSwapQuote({
    fromToken: fromToken.address as Address,
    toToken: toToken.address as Address,
    amountIn: fromAmount,
    chainId: activeChainId,
  });

  // UI state
  const [showSettings, setShowSettings] = useState(false);
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [selectingFor, setSelectingFor] = useState<"from" | "to">("from");
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [arrowRotation, setArrowRotation] = useState(0);

  // Swap UI state
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [completedStealthAddress, setCompletedStealthAddress] = useState<string | null>(null);

  // Note selector state — switched from index to object for NoteSelector compatibility
  const [selectedNoteIndex, setSelectedNoteIndex] = useState(0);
  const [showNoteSelector, setShowNoteSelector] = useState(false);

  // Relayer state
  const [relayerOnline, setRelayerOnline] = useState(false);
  const [relayerInfo, setRelayerInfo] = useState<RelayerInfo | null>(null);
  const relayerFee = relayerInfo?.feeBps ?? RELAYER_FEE_BPS;

  // Auto-switch to Ethereum Sepolia if on wrong chain
  useEffect(() => {
    if (isConnected && !swapSupported && switchChain) {
      // Auto-prompt to switch to the default swap chain
      const timer = setTimeout(() => {
        switchChain({ chainId: DEFAULT_CHAIN_ID });
      }, 1000); // 1 second delay to avoid immediate popup
      return () => clearTimeout(timer);
    }
  }, [isConnected, swapSupported, switchChain]);

  // ── Derived: available notes filtered for current from-token ────────────────
  const availableNotes = useMemo(() => {
    return unspentNotes.filter(
      (note) =>
        note.tokenAddress.toLowerCase() === fromToken.address.toLowerCase() &&
        note.leafIndex !== undefined
    );
  }, [unspentNotes, fromToken.address]);

  // Pool / quote state derived from hooks
  const poolLoading = notesLoading || treeSyncing;
  const isInitialized = treeSynced || leafCount > 0;
  const isPrivacyPool = true;
  const isQuoting = isQuoteLoading;

  // Exchange rate derived from quoted amounts
  const exchangeRate =
    fromAmount && toAmount && parseFloat(fromAmount) > 0
      ? parseFloat(toAmount) / parseFloat(fromAmount)
      : 0;
  const priceImpact = 0;
  const minReceived = toAmount
    ? (parseFloat(toAmount) * DEFAULT_SLIPPAGE_MULTIPLIER).toFixed(toToken.decimals > 6 ? 6 : 2)
    : "0";

  // Map dustSwap hook state to component state
  const swapState: SwapState = dustSwapState === "idle" ? "idle" : mapDustSwapStateToStep(dustSwapState);
  const isSwapping = isDustSwapLoading;
  const swapError = dustSwapError;
  const txHash = dustSwapTxHash;
  const swapStep = getDustSwapStepMessage(dustSwapState);

  // Calculate total notes balance
  const totalNotesBalance = availableNotes.reduce((acc, note) => {
    return acc + Number(note.amount) / Math.pow(10, fromToken.decimals);
  }, 0);

  // Derive selected note object from index (for NoteSelector compatibility)
  const selectedNote: StoredSwapNote | null = availableNotes[selectedNoteIndex] ?? null;

  const canSwap =
    isConnected &&
    fromAmount &&
    parseFloat(fromAmount) > 0 &&
    toAmount &&
    parseFloat(toAmount) > 0 &&
    dustSwapState === "idle" &&
    !poolLoading &&
    !treeError &&
    !isQuoting &&
    availableNotes.length > 0 &&
    !!selectedClaimAddress;

  // ── Effects ─────────────────────────────────────────────────────────────────

  // Auto-set fromAmount when a note is selected (privacy pool = full note)
  useEffect(() => {
    if (availableNotes.length > 0 && selectedNoteIndex < availableNotes.length) {
      const note = availableNotes[selectedNoteIndex];
      const amount = Number(note.amount) / Math.pow(10, fromToken.decimals);
      setFromAmount(amount.toString());
    }
  }, [selectedNoteIndex, availableNotes, fromToken.decimals]);

  // Sync toAmount from quoter result
  useEffect(() => {
    if (quotedAmountOut > 0n) {
      const amount = Number(quotedAmountOut) / Math.pow(10, toToken.decimals);
      setToAmount(amount.toFixed(toToken.decimals > 6 ? 6 : 2));
    } else if (!fromAmount || parseFloat(fromAmount) <= 0) {
      setToAmount("");
    }
  }, [quotedAmountOut, toToken.decimals, fromAmount]);

  // Reset selected note index when from-token changes
  useEffect(() => {
    setSelectedNoteIndex(0);
  }, [fromToken.address]);

  // useSwapMerkleTree already handles initial sync on mount - no need to duplicate

  // Check relayer health periodically (every 30s)
  useEffect(() => {
    let cancelled = false;
    async function check() {
      const healthy = await checkRelayerHealth();
      if (cancelled) return;
      setRelayerOnline(healthy);
      if (healthy) {
        const info = await getRelayerInfo();
        if (!cancelled && info) setRelayerInfo(info);
      }
    }
    check();
    const interval = setInterval(check, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Show swap modal when swap is in progress
  useEffect(() => {
    if (isDustSwapLoading || dustSwapState === "success" || dustSwapState === "error") {
      setShowSwapModal(true);
    }
  }, [isDustSwapLoading, dustSwapState]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleFlipTokens = () => {
    setArrowRotation((prev) => prev + 180);
    const tempToken = fromToken;
    setFromToken(toToken);
    setToToken(tempToken);
    const tempAmount = fromAmount;
    setFromAmount(toAmount);
    setToAmount(tempAmount);
  };

  const openTokenSelector = (type: "from" | "to") => {
    setSelectingFor(type);
    setTokenModalOpen(true);
  };

  const handleTokenSelect = (token: SwapToken) => {
    if (selectingFor === "from") {
      if (token.address === toToken.address) setToToken(fromToken);
      setFromToken(token);
    } else {
      if (token.address === fromToken.address) setFromToken(toToken);
      setToToken(token);
    }
  };

  // Handle note selection from NoteSelector component (object → index)
  const handleNoteSelect = useCallback((note: StoredSwapNote) => {
    const idx = availableNotes.findIndex((n) => n.id === note.id && n.id !== undefined);
    if (idx !== -1) setSelectedNoteIndex(idx);
  }, [availableNotes]);

  const resetSwapState = useCallback(() => {
    resetDustSwap();
    setCompletedStealthAddress(null);
    setShowSwapModal(false);
  }, [resetDustSwap]);

  const handleDeposit = useCallback(
    async (amount: string) => {
      if (!depositToPool) return null;

      const amountWei = BigInt(
        Math.floor(parseFloat(amount) * Math.pow(10, fromToken.decimals))
      );

      const result = await depositToPool(
        fromToken.address as Address,
        fromToken.symbol,
        amountWei
      );

      if (!result) return null;

      return result;
    },
    [depositToPool, fromToken]
  );

  const handleSwap = useCallback(async () => {
    if (!canSwap) return;

    const selectedNoteObj = availableNotes[selectedNoteIndex];
    if (!selectedNoteObj || selectedNoteObj.id === undefined) return;

    const recipient = selectedClaimAddress?.address;
    if (!recipient) return;

    setShowSwapModal(true);
    setCompletedStealthAddress(null);

    const minAmountOut = BigInt(
      Math.floor(parseFloat(toAmount) * Math.pow(10, toToken.decimals) * DEFAULT_SLIPPAGE_MULTIPLIER)
    );

    const result = await executeSwap({
      fromToken: fromToken.address as Address,
      toToken: toToken.address as Address,
      minAmountOut,
      recipient: recipient as Address,
      depositNoteId: selectedNoteObj.id,
    });

    if (result) {
      setCompletedStealthAddress(result.stealthAddress);
    }
  }, [
    canSwap,
    availableNotes,
    selectedNoteIndex,
    selectedClaimAddress,
    toAmount,
    toToken,
    fromToken,
    executeSwap,
  ]);

  // Button content
  const getButtonContent = () => {
    if (!isConnected) return "Connect Wallet";
    if (!swapSupported) return "Swaps Not Available on This Chain";
    if (treeError) return "Pool Connection Failed";
    if (poolLoading) return "Loading Pool...";
    if (!isInitialized) return "Pool Not Initialized";
    if (isQuoting) return "Getting Quote...";
    if (isPrivacyPool && availableNotes.length === 0 && isConnected) return "Deposit Required";
    if (!selectedClaimAddress && isConnected) return "No Stealth Address";
    if (isSwapping) return swapStep || "Processing...";
    if (swapState === "success") return "Swap Complete!";
    if (swapState === "error") return "Try Again";
    if (!fromAmount || parseFloat(fromAmount) <= 0) return "Enter Amount";
    return "Swap";
  };

  const buttonDisabled =
    swapState === "error" ? false : !canSwap || !swapSupported;

  return (
    <>
      <div className="w-full max-w-[480px]">
        {/* Terminal card */}
        <div className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-sm backdrop-blur-sm relative overflow-hidden">
          {/* Corner accents */}
          <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[rgba(255,255,255,0.1)]" />
          <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[rgba(255,255,255,0.1)]" />
          <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[rgba(255,255,255,0.1)]" />
          <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[rgba(255,255,255,0.1)]" />

          <div className="p-5 sm:p-6">
            {/* Terminal header */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#00FF41] animate-pulse" />
                <span className="text-xs font-mono text-[#00FF41] tracking-widest uppercase">
                  [ PRIVACY_SWAP ]
                </span>
              </div>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="p-2 rounded-sm hover:bg-[rgba(255,255,255,0.04)] transition-all group"
                aria-label="Settings"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={showSettings ? "#00FF41" : "rgba(255,255,255,0.4)"}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            </div>

            {/* Unsupported Chain Banner */}
            {!swapSupported && isConnected && (
              <div className="mb-4 p-3 rounded-sm bg-[rgba(255,176,0,0.06)] border border-[rgba(255,176,0,0.2)]">
                <div className="flex items-start gap-2 mb-3">
                  <AlertCircleIcon size={14} color="#FFB000" />
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-bold text-[#FFB000] font-mono">
                      PRIVACY_SWAPS: CHAIN_UNSUPPORTED
                    </span>
                    <span className="text-[11px] text-[rgba(255,255,255,0.4)] font-mono leading-relaxed">
                      DustSwap is deployed on Ethereum Sepolia testnet only.
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => switchChain?.({ chainId: DEFAULT_CHAIN_ID })}
                  className="w-full py-2 rounded-sm text-xs font-bold font-mono text-[#FFB000] bg-[rgba(255,176,0,0.08)] border border-[rgba(255,176,0,0.25)] hover:bg-[rgba(255,176,0,0.14)] hover:border-[#FFB000] transition-all tracking-wider"
                >
                  SWITCH TO ETHEREUM SEPOLIA
                </button>
              </div>
            )}

            {/* Pool Error */}
            {treeError && (
              <div className="mb-4 p-3 rounded-sm bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.2)]">
                <div className="flex items-start gap-2 mb-2">
                  <AlertCircleIcon size={14} color="rgb(239,68,68)" />
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-bold text-[rgb(239,68,68)] font-mono">POOL_SYNC: FAILED</span>
                    <span className="text-[11px] text-[rgba(255,255,255,0.4)] font-mono leading-relaxed">
                      {treeErrorMessage || "Unable to connect to RPC endpoints"}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => forceRefresh()}
                  className="px-3 py-1.5 text-[11px] font-bold font-mono text-[#00FF41] bg-[rgba(0,255,65,0.06)] border border-[rgba(0,255,65,0.2)] rounded-sm hover:bg-[rgba(0,255,65,0.1)] hover:border-[#00FF41] transition-all tracking-wider"
                >
                  RETRY_CONNECTION
                </button>
              </div>
            )}

            {/* Pool Loading */}
            {poolLoading && !treeError && (
              <div className="mb-4 p-3 rounded-sm bg-[rgba(0,255,65,0.03)] border border-[rgba(0,255,65,0.1)]">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 border-2 border-[#00FF41] border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs font-mono text-[rgba(255,255,255,0.5)]">Loading pool...</span>
                </div>
              </div>
            )}

            {/* Pool Status */}
            {!poolLoading && isInitialized && isPrivacyPool && (
              <div className="mb-4 p-3 rounded-sm bg-[rgba(0,255,65,0.03)] border border-[rgba(0,255,65,0.1)]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[#00FF41] animate-pulse" />
                    <span className="text-[11px] font-mono text-[#00FF41] font-bold tracking-wider">
                      PRIVACY_POOL: {fromToken.symbol} &rarr; {toToken.symbol}
                    </span>
                  </div>
                  {leafCount > 0 && (
                    <span className="text-[10px] font-mono text-[rgba(255,255,255,0.3)]">
                      {leafCount} deposits
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Relayer Status */}
            {relayerOnline && !poolLoading && (
              <div className="mb-4 p-3 rounded-sm bg-[rgba(0,255,65,0.02)] border border-[rgba(0,255,65,0.08)]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[#00FF41]" />
                    <span className="text-[11px] font-mono text-[rgba(255,255,255,0.4)]">RELAYER: ONLINE</span>
                  </div>
                  <span className="text-[11px] font-mono text-[rgba(255,255,255,0.3)]">
                    FEE: {relayerFee / 100}%
                  </span>
                </div>
              </div>
            )}

            {/* Deposit Warning */}
            {isPrivacyPool && availableNotes.length === 0 && isConnected && !poolLoading && swapSupported && (
              <div className="mb-4 p-3 rounded-sm bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.15)]">
                <div className="flex items-start gap-2">
                  <AlertCircleIcon size={14} color="rgb(239,68,68)" />
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-bold text-[rgb(239,68,68)] font-mono">
                      NO_{fromToken.symbol}_DEPOSIT_NOTES
                    </span>
                    <span className="text-[11px] text-[rgba(255,255,255,0.4)] font-mono">
                      Deposit {fromToken.symbol} to the privacy pool first.{" "}
                      <button
                        className="text-[#00FF41] underline font-bold hover:opacity-80 transition-opacity"
                        onClick={() => setShowDepositModal(true)}
                      >
                        Deposit now
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Note Selector — using NoteSelector component */}
            {isPrivacyPool && availableNotes.length > 0 && !poolLoading && (
              <div className="mb-4">
                <NoteSelector
                  label={`Select deposit note (${availableNotes.length} available)`}
                  notes={availableNotes}
                  selectedNote={selectedNote}
                  onSelect={handleNoteSelect}
                />
                {availableNotes.length > 0 && (
                  <div className="mt-1.5 flex items-center justify-between px-0.5">
                    <span className="text-[10px] font-mono text-[rgba(255,255,255,0.25)]">
                      One note per swap. Each note is spent in full.
                    </span>
                    <span className="text-[10px] font-mono text-[rgba(255,255,255,0.25)]">
                      Total: {totalNotesBalance.toFixed(fromToken.decimals > 6 ? 4 : 2)} {fromToken.symbol}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Error Display */}
            {swapState === "error" && swapError && !showSwapModal && (
              <div className="mb-4 p-3 rounded-sm bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.15)]">
                <div className="flex items-start gap-2">
                  <AlertCircleIcon size={14} color="rgb(239,68,68)" />
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-bold text-[rgb(239,68,68)] font-mono">SWAP: FAILED</span>
                    <span className="text-[11px] text-[rgba(255,255,255,0.4)] font-mono">{swapError}</span>
                  </div>
                </div>
              </div>
            )}

            {/* From Token Input */}
            <TokenInput
              label={isPrivacyPool && availableNotes.length > 0 ? "You send (full note)" : "You send"}
              amount={fromAmount}
              onAmountChange={setFromAmount}
              token={fromToken}
              onTokenSelect={() => openTokenSelector("from")}
              disabled={isSwapping || (isPrivacyPool && availableNotes.length > 0)}
            />

            {/* Swap Direction Button */}
            <div className="flex justify-center my-[-6px] relative z-10">
              <button
                onClick={!isSwapping ? handleFlipTokens : undefined}
                disabled={isSwapping}
                style={{ transform: `rotate(${arrowRotation}deg)` }}
                className="p-2.5 rounded-sm bg-[#06080F] border border-[rgba(255,255,255,0.08)] hover:border-[#00FF41] hover:shadow-[0_0_10px_rgba(0,255,65,0.1)] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Flip tokens"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#00FF41"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <polyline points="19 12 12 19 5 12" />
                </svg>
              </button>
            </div>

            {/* To Token Input */}
            <TokenInput
              label={isPrivacyPool ? "You receive (stealth)" : "You receive"}
              amount={toAmount}
              onAmountChange={setToAmount}
              token={toToken}
              onTokenSelect={() => openTokenSelector("to")}
              disabled
            />

            {/* Price Info */}
            {fromAmount && parseFloat(fromAmount) > 0 && !isSwapping && isInitialized && (
              <div className="mt-4 p-3 rounded-sm bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)]">
                <div className="flex flex-col gap-2">
                  {/* Rate */}
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5 text-[rgba(255,255,255,0.35)] font-mono">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                      <span>RATE</span>
                    </div>
                    <span className="font-mono text-[rgba(255,255,255,0.7)]">
                      1 {fromToken.symbol} &asymp;{" "}
                      {exchangeRate > 0
                        ? exchangeRate >= 1
                          ? exchangeRate.toLocaleString(undefined, { maximumFractionDigits: 2 })
                          : exchangeRate.toFixed(6)
                        : "\u2014"}{" "}
                      {toToken.symbol}
                    </span>
                  </div>

                  {/* Price Impact */}
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5 text-[rgba(255,255,255,0.35)] font-mono">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="19" y1="5" x2="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" />
                      </svg>
                      <span>IMPACT</span>
                    </div>
                    <span
                      className="font-mono"
                      style={{
                        color:
                          priceImpact < 1
                            ? "#00FF41"
                            : priceImpact < 3
                            ? "#FFB000"
                            : "rgb(239,68,68)",
                      }}
                    >
                      {priceImpact.toFixed(2)}%
                    </span>
                  </div>

                  {/* Min Received */}
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5 text-[rgba(255,255,255,0.35)] font-mono">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                      </svg>
                      <span>MIN_RECEIVED</span>
                    </div>
                    <span className="font-mono text-[rgba(255,255,255,0.7)]">
                      {minReceived} {toToken.symbol}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Swap Button */}
            <button
              onClick={
                swapState === "error"
                  ? resetSwapState
                  : buttonDisabled
                  ? undefined
                  : handleSwap
              }
              disabled={swapState !== "error" && buttonDisabled}
              className={`w-full mt-5 py-3 px-4 rounded-sm font-bold font-mono text-sm tracking-wider transition-all
                ${
                  swapState !== "error" && buttonDisabled
                    ? "bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.25)] cursor-not-allowed opacity-50"
                    : "bg-[rgba(0,255,65,0.1)] border border-[rgba(0,255,65,0.2)] text-[#00FF41] hover:bg-[rgba(0,255,65,0.15)] hover:border-[#00FF41] hover:shadow-[0_0_15px_rgba(0,255,65,0.15)] cursor-pointer"
                }
              `}
            >
              <div className="flex items-center justify-center gap-2">
                {isSwapping && (
                  <div className="w-4 h-4 border-2 border-[#00FF41] border-t-transparent rounded-full animate-spin" />
                )}
                <span>{getButtonContent()}</span>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Token Selector Modal */}
      <TokenSelector
        isOpen={tokenModalOpen}
        onClose={() => setTokenModalOpen(false)}
        onSelect={handleTokenSelect}
        selectedToken={selectingFor === "from" ? fromToken : toToken}
      />

      {/* Deposit Modal */}
      <DepositModal
        isOpen={showDepositModal}
        onClose={() => setShowDepositModal(false)}
        token={fromToken}
        onDeposit={handleDeposit}
      />

      {/* Swap Execute Modal */}
      <SwapExecuteModal
        isOpen={showSwapModal}
        onClose={resetSwapState}
        step={swapState === "idle" ? "preparing" : (swapState as SwapStep)}
        stepMessage={swapStep}
        fromToken={fromToken}
        toToken={toToken}
        fromAmount={fromAmount}
        toAmount={toAmount}
        error={swapError}
        txHash={txHash}
        stealthAddress={completedStealthAddress}
        onRetry={resetSwapState}
        chainId={activeChainId}
      />
    </>
  );
}
