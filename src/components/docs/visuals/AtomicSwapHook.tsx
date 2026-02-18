"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

/*
 * Uniswap V4 Hook flow diagram — matches the style of PrivacyFlow.tsx.
 * Uses a 720×320 coordinate system with HTML boxes + SVG connectors.
 * Everything lives inside a fixed-aspect container that scales with width.
 */

const P = {
  user:      { x: 24,  y: 120, w: 110, h: 64 },
  router:    { x: 174, y: 120, w: 110, h: 64 },
  pool:      { x: 324, y: 120, w: 110, h: 64 },
  hookTop:   { x: 474, y: 82,  w: 126, h: 58 },
  hookBot:   { x: 474, y: 140, w: 126, h: 58 },
  recipient: { x: 640, y: 120, w: 110, h: 64 },
};

const cx = (p: { x: number; w: number }) => p.x + p.w / 2;
const cy = (p: { y: number; h: number }) => p.y + p.h / 2;
const r = (p: { x: number; w: number }) => p.x + p.w;
const l = (p: { x: number }) => p.x;

export function AtomicSwapHook() {
  const [step, setStep] = useState(-1);
  const cancelled = useRef(false);

  const runLoop = useCallback(async () => {
    while (!cancelled.current) {
      setStep(-1); await delay(1000);
      if (cancelled.current) return;
      setStep(0); await delay(900);
      if (cancelled.current) return;
      setStep(1); await delay(900);
      if (cancelled.current) return;
      setStep(2); await delay(1000);
      if (cancelled.current) return;
      setStep(3); await delay(1100);
      if (cancelled.current) return;
      setStep(4); await delay(1100);
      if (cancelled.current) return;
      setStep(5); await delay(1500);
      if (cancelled.current) return;
    }
  }, []);

  useEffect(() => {
    cancelled.current = false;
    runLoop();
    return () => { cancelled.current = true; };
  }, [runLoop]);

  const on = (m: number) => step >= m && step !== -1;

  const strokeColor = (m: number) => on(m) ? "#00FF41" : "rgba(255,255,255,0.12)";
  const strokeW = (m: number) => on(m) ? 1.5 : 1;

  const surfaceClass = (m: number) => {
    if (step === m) return "border-[rgba(0,255,65,0.55)] bg-[rgba(0,255,65,0.14)]";
    if (step > m && step !== -1) return "border-[rgba(0,255,65,0.25)] bg-[rgba(0,255,65,0.05)]";
    return "border-dust-border bg-[rgba(20,24,32,0.7)]";
  };

  const hookPanelClass = (m: number) => {
    if (step === m) return "bg-[rgba(0,255,65,0.18)] border-[rgba(0,255,65,0.4)]";
    if (step > m && step !== -1) return "bg-[rgba(0,255,65,0.06)] border-[rgba(0,255,65,0.15)]";
    return "bg-[rgba(20,24,32,0.72)] border-[rgba(255,255,255,0.06)]";
  };

  const hookOutline = on(3)
    ? "border-[rgba(0,255,65,0.35)] bg-[rgba(0,255,65,0.04)]"
    : "border-dust-border bg-[rgba(20,24,32,0.7)]";

  const stages = [
    { pos: P.user,      m: 0, title: "Browser",  step: "01" },
    { pos: P.router,    m: 1, title: "Router",   step: "02" },
    { pos: P.pool,      m: 2, title: "V4 Pool",  step: "03" },
    { pos: P.recipient, m: 5, title: "Stealth",  step: "06" },
  ];

  return (
    <div className="w-full max-w-3xl border border-dust-border bg-[rgba(255,255,255,0.01)] p-6 flex flex-col font-mono">
      <div className="text-[10px] text-dust-muted uppercase tracking-[0.2em] mb-3">
        UNISWAP V4 HOOK FLOW
      </div>

      {/* Diagram area — fixed aspect ratio via padding trick */}
      <div className="relative w-full" style={{ paddingBottom: "42%" }}>
        <div className="absolute inset-0">
          {/* SVG connectors */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox="0 0 780 320"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <marker id="swapArr" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6" fill="rgba(255,255,255,0.15)" />
              </marker>
              <marker id="swapArrG" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6" fill="#00FF41" />
              </marker>
            </defs>

            {/* User → Router */}
            <line x1={r(P.user)} y1={cy(P.user)} x2={l(P.router)} y2={cy(P.router)}
              stroke={strokeColor(0)} strokeWidth={strokeW(0)}
              strokeDasharray="6 4" markerEnd={on(0) ? "url(#swapArrG)" : "url(#swapArr)"}
              style={{ transition: "stroke 0.4s, stroke-width 0.4s" }} />

            {/* Router → Pool */}
            <line x1={r(P.router)} y1={cy(P.router)} x2={l(P.pool)} y2={cy(P.pool)}
              stroke={strokeColor(1)} strokeWidth={strokeW(1)}
              strokeDasharray="6 4" markerEnd={on(1) ? "url(#swapArrG)" : "url(#swapArr)"}
              style={{ transition: "stroke 0.4s, stroke-width 0.4s" }} />

            {/* Pool → Hook (to beforeSwap center) */}
            <line x1={r(P.pool)} y1={cy(P.pool)} x2={l(P.hookTop)} y2={cy(P.hookTop)}
              stroke={strokeColor(2)} strokeWidth={strokeW(2)}
              strokeDasharray="6 4" markerEnd={on(2) ? "url(#swapArrG)" : "url(#swapArr)"}
              style={{ transition: "stroke 0.4s, stroke-width 0.4s" }} />

            {/* Hook (afterSwap center) → Recipient */}
            <line x1={r(P.hookBot)} y1={cy(P.hookBot)} x2={l(P.recipient)} y2={cy(P.recipient)}
              stroke={strokeColor(4)} strokeWidth={strokeW(4)}
              strokeDasharray="6 4" markerEnd={on(4) ? "url(#swapArrG)" : "url(#swapArr)"}
              style={{ transition: "stroke 0.4s, stroke-width 0.4s" }} />
          </svg>

          {/* 50-block wait badge */}
          <div
            className="absolute flex items-center justify-center"
            style={{
              left: `${(P.user.x / 780) * 100}%`,
              top: `${((P.user.y - 28) / 320) * 100}%`,
              width: `${(P.user.w / 780) * 100}%`,
              height: `${(20 / 320) * 100}%`,
            }}
          >
            <div className="px-2 py-0.5 border border-amber-500/25 bg-amber-500/10 rounded-sm">
              <span className="text-[8px] text-amber-400 font-mono tracking-widest">50-BLOCK WAIT</span>
            </div>
          </div>

          {/* Standard boxes */}
          {stages.map(({ pos, m, title, step: stepN }) => (
            <motion.div
              key={title}
              className="absolute"
              style={{
                left: `${(pos.x / 780) * 100}%`,
                top: `${(pos.y / 320) * 100}%`,
                width: `${(pos.w / 780) * 100}%`,
                height: `${(pos.h / 320) * 100}%`,
              }}
            >
              <div className={`w-full h-full rounded-sm border transition-all duration-300 ${surfaceClass(m)} flex flex-col items-center justify-center gap-0.5 p-2`}>
                <span className="text-[8px] text-white/40 tracking-widest">STEP {stepN}</span>
                <span className="text-[12px] font-semibold text-white">{title}</span>
              </div>
            </motion.div>
          ))}

          {/* Hook group — outer outline */}
          <div
            className="absolute"
            style={{
              left: `${((P.hookTop.x - 3) / 780) * 100}%`,
              top: `${((P.hookTop.y - 3) / 320) * 100}%`,
              width: `${((P.hookTop.w + 6) / 780) * 100}%`,
              height: `${((P.hookTop.h + P.hookBot.h + 6) / 320) * 100}%`,
            }}
          >
            <div className={`w-full h-full rounded-sm border transition-all duration-300 ${hookOutline}`} />
          </div>

          {/* beforeSwap */}
          <motion.div
            className="absolute"
            style={{
              left: `${(P.hookTop.x / 780) * 100}%`,
              top: `${(P.hookTop.y / 320) * 100}%`,
              width: `${(P.hookTop.w / 780) * 100}%`,
              height: `${(P.hookTop.h / 320) * 100}%`,
            }}
          >
            <div className={`w-full h-full rounded-sm border transition-all duration-300 ${hookPanelClass(3)} flex flex-col items-center justify-center gap-0.5 p-2`}>
              <span className="text-[8px] text-white/40 tracking-widest">STEP 04</span>
              <span className="text-[11px] font-semibold text-white">beforeSwap</span>
            </div>
          </motion.div>

          {/* afterSwap */}
          <motion.div
            className="absolute"
            style={{
              left: `${(P.hookBot.x / 780) * 100}%`,
              top: `${(P.hookBot.y / 320) * 100}%`,
              width: `${(P.hookBot.w / 780) * 100}%`,
              height: `${(P.hookBot.h / 320) * 100}%`,
            }}
          >
            <div className={`w-full h-full rounded-sm border transition-all duration-300 ${hookPanelClass(4)} flex flex-col items-center justify-center gap-0.5 p-2`}>
              <span className="text-[8px] text-white/40 tracking-widest">STEP 05</span>
              <span className="text-[11px] font-semibold text-white">afterSwap</span>
            </div>
          </motion.div>

          {/* Hook label */}
          <div
            className="absolute text-center"
            style={{
              left: `${(P.hookTop.x / 780) * 100}%`,
              top: `${((P.hookBot.y + P.hookBot.h + 6) / 320) * 100}%`,
              width: `${(P.hookTop.w / 780) * 100}%`,
            }}
          >
            <span className="text-[9px] text-[rgba(0,255,65,0.6)] font-mono tracking-wide">DustSwap Hook</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-dust-border pt-3 mt-2 text-center">
        <span className="text-[9px] text-dust-muted uppercase tracking-[0.15em]">
          ATOMIC — ZK PROOF + SWAP + DELIVERY IN ONE TX
        </span>
      </div>
    </div>
  );
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
