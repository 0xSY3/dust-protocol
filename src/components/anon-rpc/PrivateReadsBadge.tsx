"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircleIcon, ShieldAlertIcon, ShieldCheckIcon, ShieldIcon, ShieldOffIcon } from "lucide-react";
import { useAnonRpcStatus } from "@/hooks/anon-rpc/useAnonRpcStatus";
import { retryAnonRpc, setAnonRpcMode } from "@/lib/anon-rpc/controller";
import { describePrivateReads, formatSeconds, type PrivateReadsTone } from "@/lib/anon-rpc/describe";

const TONE_STYLES: Record<PrivateReadsTone, { text: string; border: string; dot: string }> = {
  ok: { text: "text-[#00FF41]", border: "border-[#00FF41]/30", dot: "bg-[#00FF41]" },
  pending: { text: "text-[#FFB000]", border: "border-[#FFB000]/30", dot: "bg-[#FFB000] animate-pulse" },
  idle: { text: "text-[#00FF41]/70", border: "border-white/10", dot: "bg-[#00FF41]/50" },
  error: { text: "text-[#ff4b4b]", border: "border-[#ff4b4b]/40", dot: "bg-[#ff4b4b]" },
  off: { text: "text-white/50", border: "border-white/10", dot: "bg-white/30" },
};

function ToneIcon({ tone, className }: { tone: PrivateReadsTone; className: string }) {
  if (tone === "ok") return <ShieldCheckIcon className={className} />;
  if (tone === "pending") return <LoaderCircleIcon className={`${className} animate-spin`} />;
  if (tone === "error") return <ShieldAlertIcon className={className} />;
  if (tone === "off") return <ShieldOffIcon className={className} />;
  return <ShieldIcon className={className} />;
}

/** Navbar indicator for Anon-RPC: network, state and share of reads anonymized, with Retry / direct-mode actions. */
export function PrivateReadsBadge() {
  const status = useAnonRpcStatus();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const summary = describePrivateReads(status);
  const tone = TONE_STYLES[summary.tone];
  const { counters } = status;

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  function refetchReads() {
    void queryClient.invalidateQueries();
  }

  function handleRetry() {
    retryAnonRpc();
    refetchReads();
  }

  function handleMode(mode: "anon" | "direct") {
    setAnonRpcMode(mode);
    refetchReads();
    setOpen(false);
  }

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Private reads: ${summary.stateLabel}, ${summary.networkLabel}, ${summary.shareLabel} of reads anonymized`}
        title={summary.detail}
        className={`flex items-center gap-2 px-2.5 py-2 rounded-sm border bg-[#0a0d14] hover:bg-[#0a0d14]/80 transition-all duration-300 ${tone.border}`}
      >
        <ToneIcon tone={summary.tone} className={`w-3.5 h-3.5 ${tone.text}`} />
        <span className={`hidden sm:inline text-[10px] font-mono tracking-widest ${tone.text}`}>
          {summary.tone === "off" ? "DIRECT" : summary.networkShortLabel}
        </span>
        <span className="text-[10px] font-mono text-white/60 tabular-nums">{summary.shareLabel}</span>
      </button>

      {open && (
        <div className="absolute top-[calc(100%+8px)] right-0 bg-[#0a0d14] border border-[#00FF41]/20 rounded-sm w-[300px] max-w-[calc(100vw-2rem)] z-50 overflow-hidden shadow-[0_8px_32px_-4px_rgba(0,0,0,0.8)] animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="px-4 pt-3 pb-2 border-b border-white/[0.04] flex items-center justify-between">
            <span className="text-[10px] font-mono text-[#00FF41]/50 tracking-[0.2em] uppercase">Private reads</span>
            <span className={`flex items-center gap-1.5 text-[10px] font-mono tracking-widest uppercase ${tone.text}`}>
              <span className={`w-1.5 h-1.5 rounded-sm ${tone.dot}`} />
              {summary.stateLabel}
            </span>
          </div>

          <div className="px-4 py-3 flex flex-col gap-1.5 border-b border-white/[0.04]">
            <span className="text-xs font-mono text-white/90">{summary.networkLabel}</span>
            <span className="text-[11px] font-mono text-white/50 leading-relaxed break-words">{summary.detail}</span>
          </div>

          {summary.chainNotes.length > 0 && (
            <ul className="px-4 py-3 flex flex-col gap-1 border-b border-white/[0.04]" aria-label="Chains not read through the selected network">
              {summary.chainNotes.map((note) => (
                <li key={note.chainId} title={note.text} className="flex items-center justify-between gap-3 text-[11px] font-mono">
                  <span className="text-white/70 truncate">{note.chainName}</span>
                  <span className={`shrink-0 uppercase tracking-wider ${TONE_STYLES[note.tone].text}`}>{note.stateLabel}</span>
                </li>
              ))}
            </ul>
          )}

          <dl className="px-4 py-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono border-b border-white/[0.04]">
            <dt className="text-white/40">Anonymized</dt>
            <dd className="text-right text-[#00FF41] tabular-nums">{counters.anonymized}</dd>
            <dt className="text-white/40">Direct</dt>
            <dd className="text-right text-white/70 tabular-nums">{counters.direct}</dd>
            <dt className="text-white/40" title="Reads of the network's specifier contract before it starts">Bootstrap</dt>
            <dd className="text-right text-white/70 tabular-nums">{counters.bootstrap}</dd>
            <dt className="text-white/40" title="Reads refused while private reads were unavailable; nothing was sent">Refused</dt>
            <dd className="text-right text-white/70 tabular-nums">{counters.refused}</dd>
            <dt className="text-white/40">Anonymized share</dt>
            <dd className="text-right text-white/90 tabular-nums">{summary.shareLabel}</dd>
            {status.lastLatencyMs !== null && (
              <>
                <dt className="text-white/40">Last read</dt>
                <dd className="text-right text-white/70 tabular-nums">{formatSeconds(status.lastLatencyMs)}</dd>
              </>
            )}
          </dl>

          <div className="py-1">
            {summary.tone === "error" && (
              <button
                type="button"
                onClick={handleRetry}
                className="w-full text-left px-4 py-2.5 text-xs font-mono text-[#00FF41] hover:bg-[#00FF41]/[0.06] transition-all tracking-wide"
              >
                RETRY
              </button>
            )}
            {summary.tone === "off" ? (
              <button
                type="button"
                onClick={() => handleMode("anon")}
                className="w-full text-left px-4 py-2.5 text-xs font-mono text-[#00FF41] hover:bg-[#00FF41]/[0.06] transition-all tracking-wide"
              >
                TURN PRIVATE READS ON
              </button>
            ) : summary.tone === "error" ? (
              <button
                type="button"
                onClick={() => handleMode("direct")}
                className="w-full text-left px-4 py-2.5 text-xs font-mono text-[#FFB000]/80 hover:bg-[#FFB000]/[0.05] hover:text-[#FFB000] transition-all tracking-wide"
              >
                USE DIRECT RPC (LESS PRIVATE)
              </button>
            ) : null}
            <Link
              href="/settings#private-reads"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-xs font-mono text-white/50 hover:bg-white/[0.04] hover:text-white transition-all tracking-wide"
            >
              PRIVATE READS SETTINGS
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
