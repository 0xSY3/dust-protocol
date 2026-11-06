"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import { useAuth } from "@/contexts/AuthContext";
import { storageKey } from "@/lib/storageKey";
import { getChainProvider } from "@/lib/providers";
import { generateInvoiceId, type Invoice, type InvoiceTerms } from "@/lib/invoices/invoice";
import { paymentKey, verifyInvoicePayment, type InvoicePayment, type VerifiedTransfer } from "@/lib/invoices/reconcile";

export type NewInvoice = Omit<InvoiceTerms, "id" | "chainId"> & { client: string };

function loadInvoices(key: string): Invoice[] {
  try {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as Invoice[]) : [];
  } catch (e) {
    console.warn("[invoices] Ignoring unreadable invoice storage:", e);
    return [];
  }
}

/** Merchant-local invoice book, scoped to the connected wallet and active chain. */
export function useInvoices() {
  const { address } = useAccount();
  const { activeChainId } = useAuth();
  const key = address ? storageKey("invoices", address, activeChainId) : null;
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  useEffect(() => {
    setInvoices(key ? loadInvoices(key) : []);
  }, [key]);

  const persist = useCallback((updated: Invoice[]) => {
    if (!key) return;
    setInvoices(updated);
    localStorage.setItem(key, JSON.stringify(updated));
  }, [key]);

  const createInvoice = useCallback((input: NewInvoice): Invoice => {
    const invoice: Invoice = { ...input, id: generateInvoiceId(), chainId: activeChainId, createdAt: Date.now() };
    persist([invoice, ...invoices]);
    return invoice;
  }, [activeChainId, invoices, persist]);

  const deleteInvoice = useCallback((id: string) => {
    persist(invoices.filter(i => i.id !== id));
  }, [invoices, persist]);

  return { invoices, createInvoice, deleteInvoice, chainId: activeChainId };
}

// Verification results are immutable once a payment is announced, so share them across
// renders and pages; failed lookups are evicted so a retry hits the network again.
const verificationCache = new Map<string, Promise<VerifiedTransfer>>();

function verifyOnce(chainId: number, payment: InvoicePayment): Promise<VerifiedTransfer> {
  const cacheKey = `${chainId}:${paymentKey(payment)}`;
  const cached = verificationCache.get(cacheKey);
  if (cached) return cached;
  const request = verifyInvoicePayment(getChainProvider(chainId), payment);
  verificationCache.set(cacheKey, request);
  request.catch(() => verificationCache.delete(cacheKey));
  return request;
}

/** Verifies invoice payments against on-chain Transfer logs. `payments` should be memoized. */
export function useVerifiedInvoicePayments(payments: InvoicePayment[], chainId: number) {
  const [verified, setVerified] = useState<ReadonlyMap<string, VerifiedTransfer>>(new Map());
  const [failures, setFailures] = useState<ReadonlyMap<string, string>>(new Map());
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const onChain = payments.filter(p => p.chainId === chainId);
    if (onChain.length === 0) return;
    let ignore = false;
    Promise.allSettled(onChain.map(p => verifyOnce(chainId, p))).then(results => {
      if (ignore) return;
      const nextVerified = new Map<string, VerifiedTransfer>();
      const nextFailures = new Map<string, string>();
      results.forEach((result, i) => {
        const key = paymentKey(onChain[i]);
        if (result.status === "fulfilled") nextVerified.set(key, result.value);
        else nextFailures.set(key, result.reason instanceof Error ? result.reason.message : String(result.reason));
      });
      setVerified(nextVerified);
      setFailures(nextFailures);
    });
    return () => { ignore = true; };
  }, [payments, chainId, attempt]);

  const retryFailed = useCallback(() => setAttempt(n => n + 1), []);

  return { verified, failures, retryFailed };
}
