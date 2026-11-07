"use client";

import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldIcon, AlertCircleIcon, InfoIcon, RefreshIcon } from "@/components/stealth/icons";
import { ANON_RPC_NETWORK_IDS, ANON_RPC_NETWORKS, type AnonRpcNetworkId } from "@/config/anonRpc";
import { useAnonRpcStatus } from "@/hooks/anon-rpc/useAnonRpcStatus";
import { retryAnonRpc, setAnonRpcMode, setAnonRpcNetwork } from "@/lib/anon-rpc/controller";
import { describePrivateReads, formatSeconds } from "@/lib/anon-rpc/describe";

const TONE_TEXT = {
  ok: "text-[#00FF41]",
  pending: "text-[#FFB000]",
  idle: "text-[rgba(255,255,255,0.7)]",
  error: "text-red-500",
  off: "text-[rgba(255,255,255,0.5)]",
} as const;

export function PrivateReadsSection() {
  const status = useAnonRpcStatus();
  const queryClient = useQueryClient();
  const summary = describePrivateReads(status);
  const isDirect = status.mode === "direct";
  const { counters } = status;

  function refetchReads() {
    void queryClient.invalidateQueries();
  }

  function handleNetwork(networkId: AnonRpcNetworkId) {
    setAnonRpcNetwork(networkId);
    refetchReads();
  }

  function handleDirectToggle() {
    setAnonRpcMode(isDirect ? "anon" : "direct");
    refetchReads();
  }

  function handleRetry() {
    retryAnonRpc();
    refetchReads();
  }

  return (
    <div id="private-reads" className="p-6 bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-sm scroll-mt-20">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-[rgba(255,255,255,0.03)] flex items-center justify-center flex-shrink-0">
            <ShieldIcon size={16} color="rgba(255,255,255,0.5)" />
          </div>
          <span className="text-[15px] text-white font-semibold">Private Reads</span>
          <span className={`ml-auto text-[11px] font-mono tracking-widest uppercase ${TONE_TEXT[summary.tone]}`}>
            {summary.stateLabel}
          </span>
        </div>

        <p className="text-[12px] text-[rgba(255,255,255,0.5)] leading-relaxed">
          Balance checks, scans and other blockchain reads from this browser go through an Anon-RPC network, so RPC
          providers cannot tie your IP address to your stealth addresses. If the network is unavailable, reads pause
          instead of falling back to direct RPC.
        </p>

        <div className="flex flex-col gap-2 px-4 py-3.5 bg-[rgba(255,255,255,0.03)] rounded-sm">
          <span className="text-[12px] text-[rgba(255,255,255,0.7)] leading-relaxed break-words">{summary.detail}</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-[rgba(255,255,255,0.45)]">
            <span>anonymized <span className="text-[#00FF41]">{counters.anonymized}</span></span>
            <span>direct {counters.direct}</span>
            <span>bootstrap {counters.bootstrap}</span>
            <span>refused {counters.refused}</span>
            <span>share <span className="text-white">{summary.shareLabel}</span></span>
            {status.lastLatencyMs !== null && <span>last read {formatSeconds(status.lastLatencyMs)}</span>}
          </div>
          {status.lastCallError && status.phase !== "failed" && !isDirect && (
            <span className="text-[11px] font-mono text-[rgba(255,255,255,0.35)] break-words">
              last failed read: {status.lastCallError.message}
            </span>
          )}
          {summary.chainNotes.length > 0 && (
            <ul className="flex flex-col gap-1.5 mt-1" aria-label="Chains not read through the selected network">
              {summary.chainNotes.map((note) => (
                <li key={note.chainId} className="flex flex-col gap-0.5 text-[11px] font-mono">
                  <span className="flex items-center gap-2">
                    <span className="text-[rgba(255,255,255,0.7)]">{note.chainName}</span>
                    <span className={`uppercase tracking-wider ${TONE_TEXT[note.tone]}`}>{note.stateLabel}</span>
                  </span>
                  <span className="text-[rgba(255,255,255,0.4)] leading-relaxed break-words">{note.text}</span>
                </li>
              ))}
            </ul>
          )}
          {summary.tone === "error" && (
            <button
              type="button"
              onClick={handleRetry}
              className="self-start flex items-center gap-2 mt-1 px-4 py-2 bg-[rgba(0,255,65,0.06)] rounded-full hover:bg-[rgba(0,255,65,0.1)] transition-colors cursor-pointer"
            >
              <RefreshIcon size={13} color="#00FF41" />
              <span className="text-[13px] font-medium text-[#00FF41]">Retry</span>
            </button>
          )}
        </div>

        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Anon-RPC network">
          <span className="text-[13px] text-[rgba(255,255,255,0.5)] font-medium">Network</span>
          {ANON_RPC_NETWORK_IDS.map((id) => {
            const network = ANON_RPC_NETWORKS[id];
            const isSelected = status.networkId === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => handleNetwork(id)}
                className={`text-left px-4 py-3 rounded-sm border transition-colors cursor-pointer ${isSelected
                  ? "border-[#00FF41]/40 bg-[rgba(0,255,65,0.04)]"
                  : "border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)]"
                  }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full border ${isSelected ? "bg-[#00FF41] border-[#00FF41]" : "border-[rgba(255,255,255,0.3)]"}`} />
                  <span className={`text-[13px] font-medium ${isSelected ? "text-white" : "text-[rgba(255,255,255,0.7)]"}`}>{network.label}</span>
                  {network.honoursIsolationKey && (
                    <span className="ml-auto text-[10px] font-mono tracking-wider text-[rgba(255,255,255,0.4)]">PER-ADDRESS CIRCUITS</span>
                  )}
                </div>
                <p className="mt-1 pl-4 text-[11px] text-[rgba(255,255,255,0.4)] leading-relaxed">{network.description}</p>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={isDirect}
            onClick={handleDirectToggle}
            className="flex items-center justify-between gap-3 px-4 py-3 bg-[rgba(255,255,255,0.03)] rounded-sm hover:bg-[rgba(255,255,255,0.05)] transition-colors cursor-pointer"
          >
            <span className="text-[13px] text-[rgba(255,255,255,0.8)] font-medium text-left">Use direct RPC (less private)</span>
            <span className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${isDirect ? "bg-[#FFB000]/70" : "bg-[rgba(255,255,255,0.12)]"}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${isDirect ? "translate-x-[18px]" : "translate-x-0.5"}`} />
            </span>
          </button>
          {isDirect && (
            <div className="flex items-start gap-2.5 p-3.5 bg-[rgba(217,119,6,0.04)] rounded-sm">
              <div className="flex-shrink-0 mt-px">
                <AlertCircleIcon size={14} color="#FFB000" />
              </div>
              <span className="text-[12px] text-[#FFB000] leading-relaxed">
                Direct RPC shows the provider your IP address next to every stealth address you check, which lets it
                link them to each other and to you.
              </span>
            </div>
          )}
        </div>

        <div className="flex items-start gap-2.5 p-3.5 bg-[rgba(255,255,255,0.02)] rounded-sm">
          <div className="flex-shrink-0 mt-px">
            <InfoIcon size={14} color="rgba(255,255,255,0.4)" />
          </div>
          <span className="text-[12px] text-[rgba(255,255,255,0.45)] leading-relaxed">
            Not covered: transactions you sign in your wallet (they use the wallet&apos;s own RPC), Dust server
            requests such as the relayer, subgraph queries, and the one read of the network&apos;s specifier contract
            made before it starts (counted as bootstrap).
          </span>
        </div>
      </div>
    </div>
  );
}
