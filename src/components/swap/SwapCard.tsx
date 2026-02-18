"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { type Address, formatUnits } from "viem";
import { useSwitchChain } from "wagmi";
import { ChevronDownIcon } from "lucide-react";
import { SUPPORTED_TOKENS, RELAYER_FEE_BPS, DEFAULT_SLIPPAGE_MULTIPLIER, type SwapToken, isSwapSupported } from "@/lib/swap/constants";
import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { useAuth } from "@/contexts/AuthContext";
import { useSwapNotes, useDustSwap, useSwapMerkleTree, useDustSwapPool, useSwapQuote } from "@/hooks/swap";
import { checkRelayerHealth, getRelayerInfo, type RelayerInfo } from "@/lib/swap/relayer";
import { TokenSelector } from "./TokenSelector";
import { SwapExecuteModal, type SwapStep } from "./SwapExecuteModal";
import { DepositModal } from "./DepositModal";
import { AlertCircleIcon } from "@/components/stealth/icons";
import { type StoredSwapNote } from "@/lib/swap/storage/swap-notes";

function formatNoteAmount(amount: bigint, tokenSymbol: string): string {
  const decimals = tokenSymbol.toUpperCase() === 'USDC' ? 6 : 18;
  const formatted = formatUnits(amount, decimals);
  const num = parseFloat(formatted);
  if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
  if (num < 0.0001 && num > 0) return num.toExponential(2);
  return num.toFixed(decimals === 6 ? 2 : 4);
}

function truncateId(note: StoredSwapNote): string {
  if (note.id !== undefined) return `#${note.id}`;
  const hex = note.commitment.toString(16).padStart(64, '0');
  return `#${hex.slice(0, 4)}`;
}

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
  const [showToTokenDropdown, setShowToTokenDropdown] = useState(false);

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
      <div className="w-full max-w-[620px]">
        {/* Terminal card */}
        <div className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-sm backdrop-blur-sm relative overflow-hidden">
          {/* Corner accents */}
          <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[rgba(255,255,255,0.1)]" />
          <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[rgba(255,255,255,0.1)]" />
          <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[rgba(255,255,255,0.1)]" />
          <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[rgba(255,255,255,0.1)]" />

          <div className="p-6 sm:p-8">
            {/* Terminal header */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <span className="text-xs font-bold font-mono text-white tracking-widest uppercase">
                  PRIVACY_SWAP
                </span>
                <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-sm border text-[10px] font-mono font-bold ${
                  relayerOnline
                    ? 'bg-[rgba(0,255,65,0.08)] border-[rgba(0,255,65,0.25)] text-[#00FF41]'
                    : 'bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.3)]'
                }`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${relayerOnline ? 'bg-[#00FF41] animate-pulse' : 'bg-[rgba(255,255,255,0.2)]'}`} />
                  {relayerOnline ? 'ONLINE' : 'OFFLINE'}
                </div>
              </div>
              <button
                onClick={() => setShowDepositModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] hover:bg-[rgba(0,255,65,0.06)] hover:border-[rgba(0,255,65,0.25)] transition-all text-[11px] font-mono text-[rgba(255,255,255,0.6)] hover:text-[#00FF41]"
              >
                <span className="text-[13px] leading-none">+</span>
                <span className="tracking-wider">Deposit</span>
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

            {/* ── PAY WITH NOTE ─────────────────────────────────────────── */}
            <div className="relative z-20 mb-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] text-[rgba(255,255,255,0.4)] uppercase tracking-widest font-mono">PAY WITH NOTE</span>
                {selectedNote && (
                  <span className="text-[10px] text-[#00FF41] font-mono">
                    ID: {truncateId(selectedNote)}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowNoteSelector(!showNoteSelector)}
                disabled={isSwapping}
                className={`w-full flex items-center justify-between p-3.5 rounded-sm border bg-[rgba(255,255,255,0.02)] transition-all ${
                  showNoteSelector
                    ? 'border-[#00FF41] shadow-[0_0_15px_rgba(0,255,65,0.08)]'
                    : 'border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.14)]'
                } ${isSwapping ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <div className="flex items-center gap-3">
                  {/* Token badge — click to switch token */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); openTokenSelector("from"); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); openTokenSelector("from"); } }}
                    className="w-9 h-9 rounded-sm bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] flex items-center justify-center hover:border-[#00FF41] hover:bg-[rgba(0,255,65,0.08)] transition-all shrink-0 cursor-pointer"
                    title={`Switch token (currently ${fromToken.symbol})`}
                  >
                    <span className="text-[13px] font-bold text-white">{fromToken.symbol[0]}</span>
                  </div>

                  <div className="flex flex-col items-start">
                    {selectedNote ? (
                      <>
                        <span className="text-[14px] font-bold text-white font-mono">
                          {formatNoteAmount(selectedNote.amount, selectedNote.tokenSymbol)} {selectedNote.tokenSymbol}
                        </span>
                        <span className="text-[10px] text-[rgba(255,255,255,0.35)] font-mono">Private Note</span>
                      </>
                    ) : availableNotes.length === 0 ? (
                      <>
                        <span className="text-[13px] text-[rgba(255,255,255,0.25)] font-mono">No {fromToken.symbol} notes</span>
                        <span className="text-[10px] text-[rgba(255,255,255,0.2)] font-mono">Deposit first →</span>
                      </>
                    ) : (
                      <>
                        <span className="text-[13px] text-[rgba(255,255,255,0.4)] font-mono">Select a note</span>
                        <span className="text-[10px] text-[rgba(255,255,255,0.2)] font-mono">{availableNotes.length} available</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {availableNotes.length > 0 && (
                    <span className="text-[9px] text-[rgba(255,255,255,0.25)] font-mono">
                      {availableNotes.length} notes
                    </span>
                  )}
                  <ChevronDownIcon
                    className={`w-4 h-4 text-[rgba(255,255,255,0.3)] transition-transform duration-200 ${
                      showNoteSelector ? 'rotate-180 !text-[#00FF41]' : ''
                    }`}
                  />
                </div>
              </button>

              {/* Note dropdown */}
              {showNoteSelector && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[#06080F] border border-[rgba(255,255,255,0.1)] rounded-sm shadow-2xl overflow-hidden z-30">
                  {availableNotes.length === 0 ? (
                    <div className="p-4 text-center">
                      <p className="text-[11px] text-[rgba(255,255,255,0.3)] font-mono mb-2">No {fromToken.symbol} deposit notes</p>
                      <button
                        type="button"
                        onClick={() => { setShowNoteSelector(false); setShowDepositModal(true); }}
                        className="px-3 py-1.5 rounded-sm bg-[rgba(0,255,65,0.08)] border border-[rgba(0,255,65,0.2)] text-[#00FF41] text-[11px] font-mono hover:bg-[rgba(0,255,65,0.12)] transition-all"
                      >
                        + Deposit {fromToken.symbol}
                      </button>
                    </div>
                  ) : (
                    <div className="max-h-52 overflow-y-auto">
                      {availableNotes.map((note, idx) => (
                        <button
                          key={note.id ?? idx}
                          type="button"
                          onClick={() => { handleNoteSelect(note); setShowNoteSelector(false); }}
                          className="w-full flex items-center justify-between px-4 py-3 hover:bg-[rgba(0,255,65,0.04)] transition-colors border-b border-[rgba(255,255,255,0.04)] last:border-0 group/item"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-sm bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] flex items-center justify-center group-hover/item:border-[rgba(0,255,65,0.3)] transition-colors shrink-0">
                              <span className="text-[11px] font-bold text-white group-hover/item:text-[#00FF41]">{note.tokenSymbol[0]}</span>
                            </div>
                            <div className="flex flex-col items-start">
                              <span className="text-[13px] font-bold font-mono text-white group-hover/item:text-[#00FF41]">
                                {formatNoteAmount(note.amount, note.tokenSymbol)} {note.tokenSymbol}
                              </span>
                              <span className="text-[9px] text-[rgba(255,255,255,0.3)] font-mono">
                                ID: {truncateId(note)}
                              </span>
                            </div>
                          </div>
                          {selectedNote?.id === note.id && selectedNote?.id !== undefined && (
                            <span className="text-[#00FF41] text-xs font-mono">✓</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── SWAP DIRECTION ARROW ──────────────────────────────────── */}
            <div className="flex justify-center items-center pt-4 pb-2.5 relative z-10">
              <div className="p-2 rounded-sm bg-[#06080F] border border-[rgba(0,255,65,0.2)] cursor-default">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00FF41" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <polyline points="19 12 12 19 5 12" />
                </svg>
              </div>
            </div>

            {/* ── RECEIVE (STEALTH) ─────────────────────────────────────── */}
            <div className="mb-0">
              <span className="text-[9px] text-[rgba(255,255,255,0.4)] uppercase tracking-widest font-mono block mb-2">RECEIVE (STEALTH)</span>
              <div className="flex items-center justify-between p-3.5 rounded-sm border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                {/* Token dropdown */}
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowToTokenDropdown((v) => !v)}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-sm border transition-all ${
                      showToTokenDropdown
                        ? 'bg-[rgba(0,255,65,0.08)] border-[rgba(0,255,65,0.3)]'
                        : 'bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.08)] hover:border-[rgba(0,255,65,0.25)] hover:bg-[rgba(0,255,65,0.05)]'
                    }`}
                  >
                    <div className="w-6 h-6 rounded-sm bg-[rgba(255,255,255,0.08)] flex items-center justify-center">
                      <span className="text-[10px] font-bold text-white">{toToken.symbol[0]}</span>
                    </div>
                    <span className="text-[13px] font-bold font-mono text-white">{toToken.symbol}</span>
                    <ChevronDownIcon className={`w-3 h-3 text-[rgba(255,255,255,0.35)] transition-transform duration-150 ${showToTokenDropdown ? 'rotate-180 !text-[#00FF41]' : ''}`} />
                  </button>

                  {showToTokenDropdown && (
                    <div className="absolute top-full left-0 mt-1 w-36 bg-[#06080F] border border-[rgba(255,255,255,0.1)] rounded-sm shadow-xl overflow-hidden z-40">
                      {Object.values(SUPPORTED_TOKENS)
                        .filter((t) => t.address !== fromToken.address)
                        .map((t) => (
                          <button
                            key={t.symbol}
                            type="button"
                            onClick={() => { handleTokenSelect(t); setShowToTokenDropdown(false); }}
                            className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[rgba(0,255,65,0.05)] border-b border-[rgba(255,255,255,0.04)] last:border-0 ${
                              toToken.symbol === t.symbol ? 'bg-[rgba(0,255,65,0.04)]' : ''
                            }`}
                          >
                            <div className="w-6 h-6 rounded-sm bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] flex items-center justify-center shrink-0">
                              <span className="text-[10px] font-bold text-white">{t.symbol[0]}</span>
                            </div>
                            <span className="text-[12px] font-bold font-mono text-white">{t.symbol}</span>
                            {toToken.symbol === t.symbol && (
                              <span className="ml-auto text-[#00FF41] text-xs">✓</span>
                            )}
                          </button>
                        ))}
                    </div>
                  )}
                </div>

                {/* Amount display */}
                <div className="flex flex-col items-end">
                  {isQuoting ? (
                    <div className="w-4 h-4 border-2 border-[#00FF41] border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <span className={`text-2xl font-bold font-mono leading-none ${
                        toAmount ? 'text-[#00FF41]' : 'text-[rgba(255,255,255,0.12)]'
                      }`}>
                        {toAmount || '—'}
                      </span>
                      <span className="text-[9px] text-[rgba(255,255,255,0.25)] font-mono mt-1">
                        {toAmount ? 'Auto-calculated' : 'Select a note first'}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

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
