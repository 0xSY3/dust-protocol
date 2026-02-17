"use client";

import { useState, useCallback, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useStealthScanner, useUnifiedBalance, useDustPool } from "@/hooks/stealth";
import { useSwapNotes } from "@/hooks/swap";
import { useDustSwapPool } from "@/hooks/swap";
import { getExplorerBase } from "@/lib/design/tokens";
import { getChainConfig } from "@/config/chains";
import { SUPPORTED_TOKENS } from "@/lib/swap/constants";
import { ConsolidateModal } from "@/components/dashboard/ConsolidateModal";
import {
  WalletIcon, ShieldIcon, LockIcon, KeyIcon, RefreshIcon,
  EyeIcon, EyeOffIcon, CopyIcon, CheckIcon, TrashIcon,
  DownloadIcon, UploadIcon, PlusIcon, SendIcon,
  ExternalLinkIcon, AlertCircleIcon, CheckCircleIcon, XIcon,
  ActivityIcon,
} from "@/components/stealth/icons";
import type { StoredSwapNote } from "@/lib/swap/storage/swap-notes";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatNoteAmount(note: StoredSwapNote): string {
  const decimals = note.tokenSymbol === "USDC" ? 6 : 18;
  const raw = BigInt(note.amount.toString());
  const divisor = BigInt(10 ** decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(decimals, "0");
  const display = decimals === 18 ? fracStr.slice(0, 4) : fracStr.slice(0, 2);
  return `${whole}.${display}`;
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  accentColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  accentColor?: string;
}) {
  return (
    <div className="w-full p-4 rounded-sm border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-[rgba(255,255,255,0.04)] flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div>
          <p className="text-[11px] text-[rgba(255,255,255,0.4)] font-medium mb-0.5">{label}</p>
          <p className="text-xl font-extrabold text-white font-mono tracking-tight leading-none">{value}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Modal Shell ──────────────────────────────────────────────────────────────

function ModalShell({
  isOpen,
  onClose,
  title,
  preventClose,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  preventClose?: boolean;
  children: React.ReactNode;
}) {
  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[200]"
      onClick={(e) => { if (e.target === e.currentTarget && !preventClose) onClose(); }}
    >
      <div className="w-full max-w-[440px] mx-4 bg-[rgba(10,10,15,0.95)] border border-[rgba(255,255,255,0.08)] rounded-xl shadow-2xl backdrop-blur-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5">
          <p className="text-base font-bold text-white">{title}</p>
          {!preventClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-[rgba(255,255,255,0.06)] transition-all cursor-pointer"
            >
              <XIcon size={15} color="rgba(255,255,255,0.4)" />
            </button>
          )}
        </div>
        <div className="px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WalletPage() {
  const {
    stealthKeys,
    address,
    isConnected,
    claimAddresses,
    refreshClaimBalances,
    claimAddressesInitialized,
    activeChainId,
  } = useAuth();

  const chainConfig = getChainConfig(activeChainId);
  const explorerBase = getExplorerBase(activeChainId);
  const nativeSymbol = chainConfig.nativeCurrency.symbol;

  // ─── Swap Notes (DustSwap deposit notes) ───────────────────────────────────
  const {
    notes,
    unspentNotes,
    loading: notesLoading,
    count,
    deleteNote,
    exportNotes,
    importNotes,
    clearNotes,
    refresh: refreshNotes,
  } = useSwapNotes();

  // ─── DustSwap Pool (deposit to privacy pool) ─────────────────────────────
  const {
    deposit: swapDeposit,
    state: depositState,
    error: depositError,
    reset: resetDeposit,
  } = useDustSwapPool(activeChainId);

  // ─── Stealth Scanner ──────────────────────────────────────────────────────
  const { payments, scan, isScanning } = useStealthScanner(stealthKeys, { chainId: activeChainId });

  // ─── Unified Balance ──────────────────────────────────────────────────────
  const unified = useUnifiedBalance({
    payments,
    claimAddresses,
    refreshClaimBalances,
    claimAddressesInitialized,
  });

  // ─── Privacy Pool (DustPool) ──────────────────────────────────────────────
  const dustPool = useDustPool(activeChainId);

  // ─── UI State ─────────────────────────────────────────────────────────────
  const [showSecrets, setShowSecrets] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const [showConsolidateModal, setShowConsolidateModal] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositToken, setDepositToken] = useState<"ETH" | "USDC">("ETH");

  // ─── Computed values ──────────────────────────────────────────────────────
  const ethNoteValue = unspentNotes
    .filter((n) => n.tokenSymbol === "ETH" || !n.tokenSymbol)
    .reduce((sum, n) => {
      const raw = BigInt(n.amount.toString());
      return sum + Number(raw) / 1e18;
    }, 0);

  const usdcNoteValue = unspentNotes
    .filter((n) => n.tokenSymbol === "USDC")
    .reduce((sum, n) => {
      const raw = BigInt(n.amount.toString());
      return sum + Number(raw) / 1e6;
    }, 0);

  const hasPoolBalance = parseFloat(dustPool.poolBalance) > 0;

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleRefresh = useCallback(() => {
    refreshNotes();
    scan();
    refreshClaimBalances();
    dustPool.loadPoolDeposits();
  }, [refreshNotes, scan, refreshClaimBalances, dustPool.loadPoolDeposits]);

  const handleDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0) return;
    const token = SUPPORTED_TOKENS[depositToken];
    if (!token) return;

    const decimals = token.decimals;
    const parts = depositAmount.split(".");
    const whole = BigInt(parts[0] || "0");
    const fracStr = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
    const amount = whole * BigInt(10 ** decimals) + BigInt(fracStr);

    await swapDeposit(token.address as `0x${string}`, token.symbol, amount);
    if (depositState === "success") {
      setIsDepositModalOpen(false);
      setDepositAmount("");
      setDepositToken("ETH");
      refreshNotes();
    }
  };

  const handleExport = async () => {
    try {
      const json = await exportNotes();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dust-notes-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Export failed:", error);
    }
  };

  const handleImport = async () => {
    if (!importJson.trim()) return;
    try {
      const imported = await importNotes(importJson);
      setIsImportModalOpen(false);
      setImportJson("");
      // TODO: Replace with toast notification
      console.log(`Successfully imported ${imported} notes`);
    } catch {
      console.error("Failed to import notes. Check the JSON format.");
    }
  };

  const handleClear = async () => {
    await clearNotes();
    setIsClearModalOpen(false);
  };

  const copyNoteSecret = async (note: StoredSwapNote) => {
    const secretData = JSON.stringify({
      secret: note.secret.toString(),
      nullifier: note.nullifier.toString(),
      commitment: note.commitment.toString(),
      amount: note.amount.toString(),
    });
    await navigator.clipboard.writeText(secretData);
    setCopiedId(note.id!);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // ─── Not connected state ──────────────────────────────────────────────────

  if (!isConnected) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="opacity-40">
            <WalletIcon size={48} color="rgba(255,255,255,0.4)" />
          </div>
          <h1 className="text-2xl font-bold text-white">Connect Your Wallet</h1>
          <p className="text-sm text-[rgba(255,255,255,0.5)]">Connect your wallet to manage deposits and stealth payments</p>
        </div>
      </div>
    );
  }

  // ─── Main layout ──────────────────────────────────────────────────────────

  const isDepositing = ["generating", "approving", "depositing", "confirming"].includes(depositState);

  return (
    <div className="px-3.5 md:px-6 py-4 md:py-7 max-w-[720px] mx-auto flex flex-col gap-5">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[28px] font-bold text-white tracking-tight mb-1">Wallet</h1>
          <p className="text-[13px] text-[rgba(255,255,255,0.5)]">Manage your private deposits and stealth payments</p>
        </div>
        <button
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-sm bg-[rgba(0,255,65,0.1)] border border-[rgba(0,255,65,0.2)] hover:bg-[rgba(0,255,65,0.15)] hover:border-[#00FF41] transition-all text-sm font-bold text-[#00FF41] font-mono cursor-pointer"
          onClick={() => setIsDepositModalOpen(true)}
        >
          <PlusIcon size={14} color="#00FF41" />
          New Deposit
        </button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<KeyIcon size={18} color="#22c55e" />}
          label="Active Notes"
          value={count.unspent}
          accentColor="#22c55e"
        />
        <StatCard
          icon={<LockIcon size={18} color="#818cf8" />}
          label="ETH in Pool"
          value={`${ethNoteValue.toFixed(4)}`}
          accentColor="#818cf8"
        />
        <StatCard
          icon={<ShieldIcon size={18} color="#a78bfa" />}
          label="USDC in Pool"
          value={`${usdcNoteValue.toFixed(2)}`}
          accentColor="#a78bfa"
        />
        <StatCard
          icon={<SendIcon size={18} color="#22d3ee" />}
          label="Unclaimed"
          value={unified.unclaimedCount}
          accentColor="#22d3ee"
        />
      </div>

      {/* Privacy Pool balance card */}
      {hasPoolBalance && (
        <div className="p-4 rounded-sm border border-[rgba(129,140,248,0.3)] bg-[rgba(255,255,255,0.02)] backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="opacity-70 text-[#00FF41]">
                <ShieldIcon size={18} />
              </div>
              <div>
                <p className="text-[13px] font-bold text-white">Privacy Pool</p>
                <p className="text-[11px] text-[rgba(255,255,255,0.4)]">
                  {dustPool.deposits.filter((d) => !d.withdrawn).length} deposits ready to withdraw
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <p className="text-lg font-extrabold text-white font-mono">
                {parseFloat(dustPool.poolBalance).toFixed(4)} {nativeSymbol}
              </p>
              <button
                className="px-3 py-1.5 rounded-sm bg-[rgba(0,255,65,0.1)] border border-[rgba(0,255,65,0.2)] hover:bg-[rgba(0,255,65,0.15)] hover:border-[#00FF41] transition-all text-xs font-bold text-[#00FF41] font-mono cursor-pointer"
                onClick={() => setShowConsolidateModal(true)}
              >
                Withdraw
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Deposit Notes Section ───────────────────────────────────────── */}
      <div className="w-full p-5 rounded-sm border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] backdrop-blur-sm flex flex-col gap-4">
        {/* Section header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LockIcon size={16} color="#818cf8" />
            <p className="text-[15px] font-bold text-white">Deposit Notes</p>
            <span className="px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.05)] text-[11px] text-[rgba(255,255,255,0.4)] font-medium">
              {count.total} total
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="p-1.5 rounded-full hover:bg-[rgba(255,255,255,0.06)] transition-all cursor-pointer"
              onClick={() => setShowSecrets(!showSecrets)}
            >
              {showSecrets
                ? <EyeIcon size={15} color="#22c55e" />
                : <EyeOffIcon size={15} color="rgba(255,255,255,0.4)" />}
            </button>
            <button
              className="p-1.5 rounded-full hover:bg-[rgba(255,255,255,0.06)] transition-all cursor-pointer"
              onClick={refreshNotes}
            >
              {notesLoading
                ? <span className="inline-block w-3.5 h-3.5 border-2 border-[#00FF41] border-t-transparent rounded-full animate-spin" />
                : <RefreshIcon size={15} color="rgba(255,255,255,0.4)" />}
            </button>
          </div>
        </div>

        {/* Notes list */}
        {notesLoading ? (
          <div className="text-center py-10">
            <span className="inline-block w-6 h-6 border-2 border-[#00FF41] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : notes.length === 0 ? (
          <div className="text-center py-10 flex flex-col items-center gap-3">
            <div className="opacity-30">
              <KeyIcon size={36} color="rgba(255,255,255,0.4)" />
            </div>
            <p className="text-[13px] text-[rgba(255,255,255,0.4)]">No deposit notes yet</p>
            <button
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-sm border border-[rgba(255,255,255,0.1)] hover:border-[rgba(255,255,255,0.3)] hover:bg-[rgba(255,255,255,0.03)] transition-all text-sm font-bold text-white font-mono cursor-pointer"
              onClick={() => setIsDepositModalOpen(true)}
            >
              <PlusIcon size={13} color="white" />
              Make Your First Deposit
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {notes.map((note) => (
              <div
                key={note.id}
                className={`p-3.5 rounded-sm border transition-all
                  ${note.spent
                    ? "border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.01)] opacity-55"
                    : "border-[rgba(129,140,248,0.25)] bg-[rgba(255,255,255,0.02)] hover:border-[rgba(129,140,248,0.4)]"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  {/* Left: token + amount */}
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0
                      ${note.spent ? "bg-[rgba(255,255,255,0.06)]" : "bg-[rgba(0,255,65,0.1)]"}`}>
                      <span className={`text-xs font-bold ${note.spent ? "text-[rgba(255,255,255,0.4)]" : "text-[#00FF41]"}`}>
                        {note.tokenSymbol?.slice(0, 3) || "??"}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white font-mono">
                          {formatNoteAmount(note)} {note.tokenSymbol}
                        </span>
                        <span className={`px-1.5 py-px rounded-full text-[10px] font-semibold
                          ${note.spent ? "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.4)]" : "bg-[rgba(34,197,94,0.1)] text-green-400"}`}>
                          {note.spent ? "Spent" : "Active"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-[11px] text-[rgba(255,255,255,0.4)]">{formatDate(note.createdAt)}</span>
                        {note.leafIndex !== undefined && (
                          <>
                            <span className="text-[11px] text-[rgba(255,255,255,0.4)]">&middot;</span>
                            <span className="text-[11px] text-[rgba(255,255,255,0.4)] font-mono">Leaf #{note.leafIndex}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    {note.depositTxHash && (
                      <a
                        href={`${explorerBase}/tx/${note.depositTxHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-full inline-flex cursor-pointer hover:bg-[rgba(255,255,255,0.06)] transition-all"
                      >
                        <ExternalLinkIcon size={14} color="rgba(255,255,255,0.4)" />
                      </a>
                    )}
                    <button
                      className="p-1.5 rounded-full cursor-pointer hover:bg-[rgba(255,255,255,0.06)] transition-all"
                      onClick={() => copyNoteSecret(note)}
                    >
                      {copiedId === note.id
                        ? <CheckIcon size={14} color="#22c55e" />
                        : <CopyIcon size={14} color="rgba(255,255,255,0.4)" />}
                    </button>
                    <button
                      className="p-1.5 rounded-full cursor-pointer hover:bg-[rgba(239,68,68,0.08)] transition-all"
                      onClick={() => deleteNote(note.id!)}
                    >
                      <TrashIcon size={14} color="rgba(255,255,255,0.4)" />
                    </button>
                  </div>
                </div>

                {/* Secrets reveal */}
                {showSecrets && !note.spent && (
                  <div className="mt-3 pt-3 border-t border-[rgba(255,255,255,0.05)]">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[10px] text-[rgba(255,255,255,0.4)] mb-0.5">Commitment</p>
                        <p className="text-[11px] text-white font-mono truncate">
                          {note.commitment.toString().slice(0, 20)}...
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[rgba(255,255,255,0.4)] mb-0.5">Nullifier Hash</p>
                        <p className="text-[11px] text-white font-mono truncate">
                          {note.nullifierHash.toString().slice(0, 20)}...
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Actions bar */}
        {notes.length > 0 && (
          <div className="flex items-center justify-between pt-3 border-t border-[rgba(255,255,255,0.05)]">
            <div className="flex items-center gap-1">
              <button
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm cursor-pointer hover:bg-[rgba(255,255,255,0.06)] transition-all"
                onClick={handleExport}
              >
                <DownloadIcon size={13} color="rgba(255,255,255,0.5)" />
                <span className="text-xs font-semibold text-[rgba(255,255,255,0.5)]">Export</span>
              </button>
              <button
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm cursor-pointer hover:bg-[rgba(255,255,255,0.06)] transition-all"
                onClick={() => setIsImportModalOpen(true)}
              >
                <UploadIcon size={13} color="rgba(255,255,255,0.5)" />
                <span className="text-xs font-semibold text-[rgba(255,255,255,0.5)]">Import</span>
              </button>
            </div>
            <button
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm cursor-pointer hover:bg-[rgba(239,68,68,0.08)] transition-all"
              onClick={() => setIsClearModalOpen(true)}
            >
              <TrashIcon size={13} color="#ef4444" />
              <span className="text-xs font-semibold text-red-400">Clear All</span>
            </button>
          </div>
        )}
      </div>

      {/* ─── Stealth Payments Section ────────────────────────────────────── */}
      <div className="w-full p-5 rounded-sm border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] backdrop-blur-sm flex flex-col gap-4">
        {/* Section header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldIcon size={16} color="#22c55e" />
            <p className="text-[15px] font-bold text-white">Stealth Payments</p>
            <span className="px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.05)] text-[11px] text-[rgba(255,255,255,0.4)] font-medium">
              {unified.unclaimedCount} unclaimed
            </span>
          </div>
          <button
            className="p-1.5 rounded-full cursor-pointer hover:bg-[rgba(255,255,255,0.06)] transition-all"
            onClick={() => scan()}
          >
            {isScanning
              ? <span className="inline-block w-3.5 h-3.5 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
              : <RefreshIcon size={15} color="rgba(255,255,255,0.4)" />}
          </button>
        </div>

        {/* Payment list */}
        {payments.length === 0 ? (
          <div className="text-center py-10 flex flex-col items-center gap-3">
            <div className="opacity-30">
              <ShieldIcon size={36} color="rgba(255,255,255,0.4)" />
            </div>
            <p className="text-[13px] text-[rgba(255,255,255,0.4)]">No stealth payments yet</p>
            <p className="text-[11px] text-[rgba(255,255,255,0.3)]">Payments received via stealth addresses will appear here</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {unified.unclaimedPayments.map((payment) => {
              const bal = parseFloat(payment.balance || "0");
              const addr = payment.announcement.stealthAddress;
              const txHash = payment.announcement.txHash;

              return (
                <div
                  key={addr}
                  className={`p-3.5 rounded-sm border transition-all
                    ${bal > 0
                      ? "border-[rgba(34,197,94,0.2)] bg-[rgba(34,197,94,0.03)]"
                      : "border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0
                        ${bal > 0 ? "bg-[rgba(34,197,94,0.12)]" : "bg-[rgba(255,255,255,0.06)]"}`}>
                        <ShieldIcon size={16} color={bal > 0 ? "#22c55e" : "rgba(255,255,255,0.4)"} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] text-white font-mono">
                            {addr.slice(0, 8)}...{addr.slice(-6)}
                          </span>
                          {bal > 0 && (
                            <span className="px-1.5 py-px rounded-full bg-[rgba(34,197,94,0.1)] text-[10px] font-semibold text-green-400">
                              Claimable
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-bold text-white font-mono mt-0.5">
                          {bal.toFixed(4)} {nativeSymbol}
                        </p>
                      </div>
                    </div>
                    {txHash && (
                      <a
                        href={`${explorerBase}/tx/${txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-full inline-flex cursor-pointer hover:bg-[rgba(255,255,255,0.06)] transition-all shrink-0"
                      >
                        <ExternalLinkIcon size={14} color="rgba(255,255,255,0.4)" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Info notice */}
        {payments.length > 0 && (
          <div className="p-2.5 px-3 rounded-sm bg-[rgba(34,197,94,0.04)] border border-[rgba(34,197,94,0.12)]">
            <div className="flex items-start gap-2">
              <div className="mt-px shrink-0"><KeyIcon size={13} color="#22c55e" /></div>
              <p className="text-[11px] text-[rgba(255,255,255,0.4)] leading-relaxed">
                Stealth addresses hold tokens from private payments. Private keys are stored
                securely in your browser. Claim via the Dashboard to send funds to your wallet.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ─── Transaction History ─────────────────────────────────────────── */}
      <div className="w-full p-5 rounded-sm border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] backdrop-blur-sm flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <ActivityIcon size={16} color="#818cf8" />
          <p className="text-[15px] font-bold text-white">Transaction History</p>
        </div>

        {notes.length === 0 ? (
          <div className="text-center py-8 flex flex-col items-center gap-2">
            <div className="opacity-30">
              <ActivityIcon size={28} color="rgba(255,255,255,0.4)" />
            </div>
            <p className="text-[13px] text-[rgba(255,255,255,0.4)]">No transactions yet</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {notes
              .slice()
              .sort((a, b) => b.createdAt - a.createdAt)
              .slice(0, 10)
              .map((note) => (
                <div
                  key={note.id}
                  className="flex items-center justify-between p-2.5 px-3 rounded-sm bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] transition-all"
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center
                      ${note.spent ? "bg-[rgba(239,68,68,0.1)]" : "bg-[rgba(34,197,94,0.1)]"}`}>
                      {note.spent
                        ? <XIcon size={12} color="#ef4444" />
                        : <CheckCircleIcon size={12} color="#22c55e" />}
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-white">
                        {note.spent ? "Withdrawn" : "Deposited"}{" "}
                        {formatNoteAmount(note)} {note.tokenSymbol}
                      </p>
                      <p className="text-[11px] text-[rgba(255,255,255,0.4)]">
                        {formatDate(note.spent ? note.spentAt! : note.createdAt)}
                      </p>
                    </div>
                  </div>
                  {note.depositTxHash && (
                    <a
                      href={`${explorerBase}/tx/${note.depositTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[11px] text-[#00FF41] no-underline shrink-0"
                    >
                      View
                      <ExternalLinkIcon size={10} color="#818cf8" />
                    </a>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>

      {/* ─── Backup Warning ──────────────────────────────────────────────── */}
      <div className="p-3.5 px-4 rounded-lg bg-[rgba(239,68,68,0.04)] border border-[rgba(239,68,68,0.15)]">
        <div className="flex items-start gap-2.5">
          <div className="mt-px shrink-0"><AlertCircleIcon size={16} color="#ef4444" /></div>
          <div>
            <p className="text-[13px] font-bold text-red-400 mb-1">Backup Your Notes</p>
            <p className="text-xs text-[rgba(255,255,255,0.5)] leading-relaxed">
              Your deposit notes are stored locally in your browser. If you clear your
              browser data or use a different device, you will lose access to your
              deposits. Always export and securely backup your notes.
            </p>
          </div>
        </div>
      </div>

      {/* ─── Deposit Modal ───────────────────────────────────────────────── */}
      <ModalShell
        isOpen={isDepositModalOpen}
        onClose={() => {
          setIsDepositModalOpen(false);
          resetDeposit();
          setDepositAmount("");
          setDepositToken("ETH");
        }}
        title="Deposit to Privacy Pool"
        preventClose={isDepositing}
      >
        <div className="flex flex-col gap-4">
          {/* Token selection */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono">Select Token</p>
            <div className="flex gap-2">
              {(["ETH", "USDC"] as const).map((sym) => (
                <button
                  key={sym}
                  className={`flex-1 p-3 rounded-lg border cursor-pointer transition-all text-left
                    ${depositToken === sym
                      ? "bg-[rgba(0,255,65,0.1)] border-[rgba(129,140,248,0.4)]"
                      : "bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.06)]"}`}
                  onClick={() => {
                    setDepositToken(sym);
                    setDepositAmount("");
                  }}
                >
                  <p className={`text-sm font-bold ${depositToken === sym ? "text-[#00FF41]" : "text-white"}`}>{sym}</p>
                  <p className="text-[11px] text-[rgba(255,255,255,0.4)] mt-0.5">{SUPPORTED_TOKENS[sym]?.name}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Amount input */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[9px] text-[rgba(255,255,255,0.5)] uppercase tracking-wider font-mono">Amount</p>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              value={depositAmount}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9.]/g, "");
                setDepositAmount(val);
              }}
              className="w-full p-3 rounded-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.1)] text-white font-mono text-sm focus:outline-none focus:border-[#00FF41] focus:bg-[rgba(0,255,65,0.02)] transition-all placeholder-[rgba(255,255,255,0.2)]"
            />
          </div>

          {/* Info */}
          <div className="p-3 rounded-sm bg-[rgba(0,255,65,0.06)] border border-[rgba(0,255,65,0.15)]">
            <div className="flex items-start gap-2">
              <div className="mt-0.5 shrink-0"><ShieldIcon size={14} color="#818cf8" /></div>
              <p className="text-xs text-[rgba(255,255,255,0.4)] leading-relaxed">
                Your deposit creates a cryptographic commitment stored on-chain. A secret
                note is saved locally that proves your ownership. Keep this note safe!
              </p>
            </div>
          </div>

          {/* Error */}
          {depositError && (
            <div className="p-2.5 px-3 rounded-sm bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.2)]">
              <p className="text-xs text-red-400">{depositError}</p>
            </div>
          )}

          {/* Submit */}
          <button
            className={`w-full py-3.5 rounded-full text-[15px] font-bold text-white text-center transition-all
              ${depositAmount && parseFloat(depositAmount) > 0 && !isDepositing
                ? "bg-gradient-to-r from-indigo-600 to-violet-600 cursor-pointer hover:-translate-y-0.5"
                : "bg-[rgba(255,255,255,0.04)] cursor-not-allowed opacity-50"}`}
            onClick={handleDeposit}
          >
            {isDepositing ? (
              <span className="flex items-center gap-2 justify-center">
                <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>
                  {depositState === "generating" && "Generating Note..."}
                  {depositState === "approving" && "Approving..."}
                  {depositState === "depositing" && "Depositing..."}
                  {depositState === "confirming" && "Confirming..."}
                </span>
              </span>
            ) : depositState === "success" ? (
              <span className="flex items-center gap-1.5 justify-center">
                <CheckCircleIcon size={15} color="#fff" />
                Deposit Successful!
              </span>
            ) : (
              <span className="flex items-center gap-1.5 justify-center">
                <LockIcon size={14} color="#fff" />
                Deposit to Privacy Pool
              </span>
            )}
          </button>
        </div>
      </ModalShell>

      {/* ─── Import Modal ────────────────────────────────────────────────── */}
      <ModalShell
        isOpen={isImportModalOpen}
        onClose={() => {
          setIsImportModalOpen(false);
          setImportJson("");
        }}
        title="Import Deposit Notes"
      >
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-[rgba(255,255,255,0.5)]">Paste the JSON backup of your deposit notes below.</p>
          <textarea
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
            placeholder='[{"secret": "...", "nullifier": "...", ...}]'
            className="w-full h-40 p-3 rounded-sm bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.1)] text-white font-mono text-xs focus:outline-none focus:border-[#00FF41] focus:bg-[rgba(0,255,65,0.02)] transition-all placeholder-[rgba(255,255,255,0.2)] resize-none"
          />
          <div className="flex gap-2.5">
            <button
              className="flex-1 py-3 rounded-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.07)] text-sm font-semibold text-white text-center cursor-pointer transition-all"
              onClick={() => setIsImportModalOpen(false)}
            >
              Cancel
            </button>
            <button
              className={`flex-1 py-3 rounded-full text-sm font-bold text-white text-center transition-all
                ${importJson.trim()
                  ? "bg-gradient-to-r from-indigo-600 to-violet-600 cursor-pointer hover:-translate-y-0.5"
                  : "bg-[rgba(255,255,255,0.04)] cursor-not-allowed opacity-50"}`}
              onClick={handleImport}
            >
              <span className="flex items-center gap-1.5 justify-center">
                <UploadIcon size={14} color="#fff" />
                Import
              </span>
            </button>
          </div>
        </div>
      </ModalShell>

      {/* ─── Clear Confirmation Modal ────────────────────────────────────── */}
      <ModalShell
        isOpen={isClearModalOpen}
        onClose={() => setIsClearModalOpen(false)}
        title="Clear All Notes?"
      >
        <div className="flex flex-col gap-4">
          <div className="p-3.5 rounded-sm bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.2)]">
            <div className="flex items-start gap-2.5">
              <div className="mt-px shrink-0"><AlertCircleIcon size={16} color="#ef4444" /></div>
              <div>
                <p className="text-[13px] font-bold text-red-400 mb-1">This action is irreversible</p>
                <p className="text-xs text-[rgba(255,255,255,0.5)] leading-relaxed">
                  Clearing all notes will permanently delete your deposit records. You will lose
                  access to any unspent deposits. Make sure you have exported a backup first.
                </p>
              </div>
            </div>
          </div>
          <div className="flex gap-2.5">
            <button
              className="flex-1 py-3 rounded-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.07)] text-sm font-semibold text-white text-center cursor-pointer transition-all"
              onClick={() => setIsClearModalOpen(false)}
            >
              Cancel
            </button>
            <button
              className="flex-1 py-3 rounded-full bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.3)] hover:bg-[rgba(239,68,68,0.15)] text-sm font-bold text-red-400 cursor-pointer transition-all"
              onClick={handleClear}
            >
              <span className="flex items-center gap-1.5 justify-center">
                <TrashIcon size={14} color="#ef4444" />
                Clear All
              </span>
            </button>
          </div>
        </div>
      </ModalShell>

      {/* ─── Consolidate (Withdraw) Modal ────────────────────────────────── */}
      <ConsolidateModal
        isOpen={showConsolidateModal}
        onClose={() => setShowConsolidateModal(false)}
        deposits={dustPool.deposits}
        poolBalance={dustPool.poolBalance}
        progress={dustPool.progress}
        onConsolidate={dustPool.consolidate}
        onReset={dustPool.resetProgress}
        isConsolidating={dustPool.isConsolidating}
      />
    </div>
  );
}
