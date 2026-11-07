"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldAlertIcon, XIcon } from "lucide-react";
import { useAnonRpcStatus } from "@/hooks/anon-rpc/useAnonRpcStatus";
import { retryAnonRpc, setAnonRpcMode } from "@/lib/anon-rpc/controller";
import { describePrivateReads } from "@/lib/anon-rpc/describe";

/**
 * Shown on every page while private reads have failed, or cannot reach a chain the app
 * reads: those reads are paused (fail closed) until the user retries or explicitly
 * chooses direct RPC.
 */
export function PrivateReadsAlert() {
  const status = useAnonRpcStatus();
  const queryClient = useQueryClient();
  // Dismissal lasts until the next failure, which carries a new timestamp.
  const [dismissedFailureAt, setDismissedFailureAt] = useState<number | null>(null);

  const summary = describePrivateReads(status);
  const failureAt = summary.tone === "error" ? summary.failureAt : null;
  if (failureAt === null || failureAt === dismissedFailureAt) return null;
  const title = status.phase === "failed" ? "PRIVATE READS UNAVAILABLE" : "PRIVATE READS PAUSED";

  function handleRetry() {
    retryAnonRpc();
    void queryClient.invalidateQueries();
  }

  function handleUseDirect() {
    setAnonRpcMode("direct");
    void queryClient.invalidateQueries();
  }

  return (
    <div
      role="alert"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:w-[380px] z-[60] bg-[#0a0d14] border border-[#ff4b4b]/40 rounded-sm shadow-[0_8px_32px_-4px_rgba(0,0,0,0.8)] p-4 flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      <div className="flex items-start gap-3">
        <ShieldAlertIcon className="w-4 h-4 text-[#ff4b4b] shrink-0 mt-0.5" />
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <span className="text-xs font-mono font-bold tracking-widest text-[#ff4b4b]">{title}</span>
          <span className="text-[11px] font-mono text-white/60 leading-relaxed break-words">{summary.detail}</span>
        </div>
        <button
          type="button"
          onClick={() => setDismissedFailureAt(failureAt)}
          aria-label="Dismiss"
          className="text-white/40 hover:text-white transition-colors shrink-0"
        >
          <XIcon className="w-4 h-4" />
        </button>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleRetry}
          className="flex-1 py-2 text-[11px] font-mono font-bold tracking-widest text-[#00FF41] border border-[#00FF41]/30 bg-[#00FF41]/[0.05] rounded-sm hover:border-[#00FF41] hover:bg-[#00FF41]/[0.1] transition-all"
        >
          RETRY
        </button>
        <button
          type="button"
          onClick={handleUseDirect}
          className="flex-1 py-2 text-[11px] font-mono tracking-wide text-[#FFB000]/80 border border-[#FFB000]/20 rounded-sm hover:border-[#FFB000]/50 hover:text-[#FFB000] transition-all"
        >
          USE DIRECT RPC (LESS PRIVATE)
        </button>
      </div>
    </div>
  );
}
