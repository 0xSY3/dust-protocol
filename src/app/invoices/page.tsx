"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ethers } from "ethers";
import { useAuth } from "@/contexts/AuthContext";
import { useStealthScanner } from "@/hooks/stealth";
import { useInvoices, useVerifiedInvoicePayments } from "@/hooks/stealth/useInvoices";
import { getChainConfig, getSupportedChains } from "@/config/chains";
import { getTokensForChain } from "@/config/tokens";
import {
  buildInvoicePath, localDateString, parseTokenAmount, MAX_MEMO_LENGTH, type Invoice,
} from "@/lib/invoices/invoice";
import {
  invoicePaymentsFromScan, paymentKey, summarizeInvoice, type InvoiceStatus, type InvoiceSummary,
} from "@/lib/invoices/reconcile";
import { invoicesToCsv, type InvoiceExportRow } from "@/lib/invoices/export";

const MAX_CLIENT_LENGTH = 80;

const STATUS_STYLES: Record<InvoiceStatus, { label: string; className: string }> = {
  paid: { label: "Paid", className: "text-[#22C55E] bg-[rgba(34,197,94,0.1)]" },
  partially_paid: { label: "Partially paid", className: "text-[#F59E0B] bg-[rgba(245,158,11,0.1)]" },
  overdue: { label: "Overdue", className: "text-[#EF4444] bg-[rgba(239,68,68,0.1)]" },
  open: { label: "Open", className: "text-[rgba(255,255,255,0.6)] bg-[rgba(255,255,255,0.06)]" },
};

const inputClass = "h-11 px-3 rounded-sm bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] text-sm text-white placeholder:text-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[rgba(0,255,65,0.4)]";
const cardClass = "p-5 rounded-sm border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)]";

function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function InvoicesPage() {
  const { ownedNames, stealthKeys, activeChainId, setActiveChain } = useAuth();
  const { invoices, createInvoice, deleteInvoice } = useInvoices();
  const { payments, scanInBackground, stopBackgroundScan, isScanning } = useStealthScanner(stealthKeys);
  const merchantName = ownedNames[0]?.name ?? "";
  const chain = getChainConfig(activeChainId);
  const stablecoin = getTokensForChain(activeChainId).find(t => t.symbol === "USDT");
  const invoiceChain = getSupportedChains().find(c => getTokensForChain(c.id).some(t => t.symbol === "USDT") && c.id !== activeChainId);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => {
    if (!stealthKeys) return;
    scanInBackground();
    return () => stopBackgroundScan();
  }, [stealthKeys, scanInBackground, stopBackgroundScan]);

  const invoicePayments = useMemo(() => invoicePaymentsFromScan(payments), [payments]);
  const { verified, failures, retryFailed } = useVerifiedInvoicePayments(invoicePayments, activeChainId);
  const today = localDateString(new Date());

  const rows = useMemo(() => invoices.map(invoice => ({
    invoice,
    summary: summarizeInvoice(invoice, parseTokenAmount(invoice.amount, stablecoin?.decimals ?? 6) ?? 0n, invoicePayments, verified, today),
  })), [invoices, invoicePayments, verified, today, stablecoin]);

  const checkoutRows = useMemo(() => {
    const issued = new Set(invoices.map(i => i.id));
    return invoicePayments.filter(p => p.chainId === activeChainId && !issued.has(p.invoiceId));
  }, [invoices, invoicePayments, activeChainId]);

  const exportCsv = () => {
    if (!stablecoin) return;
    const explorerBaseUrl = chain.blockExplorerUrl;
    const issuedRows: InvoiceExportRow[] = rows.map(({ invoice, summary }) => ({
      invoice, summary, tokenSymbol: stablecoin.symbol, decimals: stablecoin.decimals, explorerBaseUrl,
    }));
    const checkoutExportRows: InvoiceExportRow[] = checkoutRows.flatMap(payment => {
      const transfer = verified.get(paymentKey(payment));
      if (!transfer) return [];
      const summary: InvoiceSummary = { status: "paid", expected: transfer.amount, received: transfer.amount, payments: [payment], isVerifying: false };
      return [{
        invoice: { id: payment.invoiceId, chainId: payment.chainId, tokenAddress: payment.tokenAddress, amount: ethers.utils.formatUnits(transfer.amount, stablecoin.decimals), memo: "", dueDate: null, client: "Embedded checkout", createdAt: null },
        summary, tokenSymbol: stablecoin.symbol, decimals: stablecoin.decimals, explorerBaseUrl,
      }];
    });
    downloadCsv(`dust-invoices-${activeChainId}-${today}.csv`, invoicesToCsv([...issuedRows, ...checkoutExportRows], verified));
  };

  return (
    <div className="px-4 md:px-10 py-5 md:py-10 max-w-[780px] mx-auto">
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-bold tracking-widest text-white font-mono text-center">Invoices</h1>

        {!stablecoin ? (
          <div className={`${cardClass} flex flex-col gap-3 items-start`}>
            <p className="text-sm text-[rgba(255,255,255,0.7)]">
              Invoices settle in USDT. {chain.name} has no supported USDT yet.
            </p>
            {invoiceChain && (
              <button onClick={() => setActiveChain(invoiceChain.id)} className="h-10 px-4 rounded-sm bg-[#00FF41] text-black text-sm font-semibold">
                Switch to {invoiceChain.name}
              </button>
            )}
          </div>
        ) : !merchantName ? (
          <div className={cardClass}>
            <p className="text-sm text-[rgba(255,255,255,0.7)]">Claim a .dust name first. Customers pay invoices to your name.</p>
          </div>
        ) : (
          <>
            <CreateInvoiceForm
              tokenSymbol={stablecoin.symbol}
              decimals={stablecoin.decimals}
              onCreate={input => createInvoice({ ...input, tokenAddress: stablecoin.address })}
            />

            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-white">Issued on {chain.name}</h2>
                <div className="flex items-center gap-3">
                  {isScanning && <span className="text-xs text-[rgba(255,255,255,0.4)]">Checking for payments…</span>}
                  <button onClick={exportCsv} disabled={rows.length === 0 && checkoutRows.length === 0}
                    className="h-9 px-3 rounded-sm border border-[rgba(255,255,255,0.12)] text-sm text-white disabled:opacity-40">
                    Export CSV
                  </button>
                </div>
              </div>
              {failures.size > 0 && (
                <div className="flex items-center justify-between gap-3 p-3 rounded-sm bg-[rgba(239,68,68,0.08)] text-sm text-[#EF4444]">
                  <span>Couldn&apos;t verify {failures.size} payment{failures.size === 1 ? "" : "s"} on-chain.</span>
                  <button onClick={retryFailed} className="underline">Retry</button>
                </div>
              )}
              {rows.length === 0 ? (
                <p className="text-sm text-[rgba(255,255,255,0.5)]">No invoices yet. Create one above and send the link to your client.</p>
              ) : rows.map(({ invoice, summary }) => (
                <InvoiceRow
                  key={invoice.id}
                  invoice={invoice}
                  summary={summary}
                  tokenSymbol={stablecoin.symbol}
                  decimals={stablecoin.decimals}
                  link={`${origin}${buildInvoicePath(merchantName, invoice)}`}
                  explorer={chain.blockExplorerUrl}
                  verified={verified}
                  onDelete={() => deleteInvoice(invoice.id)}
                />
              ))}
            </section>

            {checkoutRows.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="text-base font-semibold text-white">Checkout payments</h2>
                {checkoutRows.map(payment => {
                  const transfer = verified.get(paymentKey(payment));
                  return (
                    <div key={paymentKey(payment)} className={`${cardClass} flex items-center justify-between gap-3`}>
                      <div className="flex flex-col gap-1 min-w-0">
                        <span className="text-sm text-white font-mono truncate">{payment.invoiceId}</span>
                        <span className="text-xs text-[rgba(255,255,255,0.5)]">From an embedded pay button</span>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-sm text-white">
                          {transfer ? `${ethers.utils.formatUnits(transfer.amount, stablecoin.decimals)} ${stablecoin.symbol}` : "Verifying…"}
                        </span>
                        {transfer?.txHashes[0] && (
                          <a href={`${chain.blockExplorerUrl}/tx/${transfer.txHashes[0]}`} target="_blank" rel="noopener noreferrer" className="text-xs text-[#00FF41] underline">
                            View transfer
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </section>
            )}

            <EmbedSnippet origin={origin} merchantName={merchantName} />
          </>
        )}
      </div>
    </div>
  );
}

interface CreateInvoiceFormProps {
  tokenSymbol: string;
  decimals: number;
  onCreate: (input: { client: string; amount: string; memo: string; dueDate: string | null }) => void;
}

function CreateInvoiceForm({ tokenSymbol, decimals, onCreate }: CreateInvoiceFormProps) {
  const [client, setClient] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [dueDate, setDueDate] = useState("");
  const amountIsValid = parseTokenAmount(amount.trim(), decimals) !== null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!amountIsValid) return;
    onCreate({ client: client.trim(), amount: amount.trim(), memo: memo.trim(), dueDate: dueDate || null });
    setClient("");
    setAmount("");
    setMemo("");
    setDueDate("");
  };

  return (
    <form onSubmit={submit} className={`${cardClass} flex flex-col gap-3`}>
      <h2 className="text-base font-semibold text-white">New invoice</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-xs text-[rgba(255,255,255,0.5)]">
          Client (only you see this)
          <input className={inputClass} value={client} maxLength={MAX_CLIENT_LENGTH} onChange={e => setClient(e.target.value)} placeholder="Acme Studio" />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-[rgba(255,255,255,0.5)]">
          Amount ({tokenSymbol})
          <input className={inputClass} value={amount} inputMode="decimal" onChange={e => setAmount(e.target.value)} placeholder="250.00" />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-[rgba(255,255,255,0.5)] md:col-span-2">
          What it&apos;s for (shown to the payer)
          <input className={inputClass} value={memo} maxLength={MAX_MEMO_LENGTH} onChange={e => setMemo(e.target.value)} placeholder="Brand identity, milestone 2" />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-[rgba(255,255,255,0.5)]">
          Due date (optional)
          <input type="date" className={inputClass} value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </label>
        <div className="flex items-end">
          <button type="submit" disabled={!amountIsValid}
            className="w-full h-11 rounded-sm bg-[#00FF41] text-black text-sm font-semibold disabled:opacity-40">
            Create invoice
          </button>
        </div>
      </div>
      {amount.trim() !== "" && !amountIsValid && (
        <p className="text-xs text-[#EF4444]">Enter a positive amount with at most {decimals} decimals.</p>
      )}
    </form>
  );
}

interface InvoiceRowProps {
  invoice: Invoice;
  summary: InvoiceSummary;
  tokenSymbol: string;
  decimals: number;
  link: string;
  explorer: string;
  verified: ReadonlyMap<string, { txHashes: string[] }>;
  onDelete: () => void;
}

function InvoiceRow({ invoice, summary, tokenSymbol, decimals, link, explorer, verified, onDelete }: InvoiceRowProps) {
  const [copied, setCopied] = useState(false);
  const status = STATUS_STYLES[summary.status];
  const txHashes = summary.payments.flatMap(p => verified.get(paymentKey(p))?.txHashes ?? []);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.warn("[invoices] Clipboard write failed:", e);
    }
  };

  return (
    <div className={`${cardClass} flex flex-col gap-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-sm font-semibold text-white truncate">{invoice.client || "Unnamed client"}</span>
          {invoice.memo && <span className="text-xs text-[rgba(255,255,255,0.5)] truncate">{invoice.memo}</span>}
        </div>
        <span className={`shrink-0 text-xs font-medium px-2 py-1 rounded-sm ${status.className}`}>
          {summary.isVerifying && summary.status !== "paid" ? "Verifying…" : status.label}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[rgba(255,255,255,0.6)]">
        <span className="text-sm text-white">
          {ethers.utils.formatUnits(summary.received, decimals)} / {invoice.amount} {tokenSymbol}
        </span>
        {invoice.dueDate && <span>Due {invoice.dueDate}</span>}
        {txHashes.map(hash => (
          <a key={hash} href={`${explorer}/tx/${hash}`} target="_blank" rel="noopener noreferrer" className="text-[#00FF41] underline">
            Payment {hash.slice(0, 8)}…
          </a>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={copyLink} className="h-9 px-3 rounded-sm border border-[rgba(255,255,255,0.12)] text-xs text-white">
          {copied ? "Copied" : "Copy pay link"}
        </button>
        <a href={link} target="_blank" rel="noopener noreferrer" className="h-9 px-3 rounded-sm border border-[rgba(255,255,255,0.12)] text-xs text-white inline-flex items-center">
          Open
        </a>
        {summary.payments.length === 0 && (
          <button onClick={onDelete} className="h-9 px-3 rounded-sm text-xs text-[rgba(255,255,255,0.5)] hover:text-[#EF4444]">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function EmbedSnippet({ origin, merchantName }: { origin: string; merchantName: string }) {
  const [copied, setCopied] = useState(false);
  const snippet = `<script src="${origin}/dust-pay.js" defer></script>\n<button data-dust-pay data-merchant="${merchantName}" data-amount="12.50" data-memo="Order 1042">Pay with Dust</button>`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.warn("[invoices] Clipboard write failed:", e);
    }
  };

  return (
    <section className={`${cardClass} flex flex-col gap-3`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-white">Add a pay button to your site</h2>
        <button onClick={copy} className="h-9 px-3 rounded-sm border border-[rgba(255,255,255,0.12)] text-xs text-white">
          {copied ? "Copied" : "Copy code"}
        </button>
      </div>
      <p className="text-xs text-[rgba(255,255,255,0.5)]">
        Each click creates a fresh invoice reference. The button fires a <code>dust:paid</code> event with the transaction hash when the customer pays, and the payment shows up here.
      </p>
      <pre className="text-xs text-[rgba(255,255,255,0.8)] bg-[rgba(0,0,0,0.3)] p-3 rounded-sm overflow-x-auto whitespace-pre">{snippet}</pre>
    </section>
  );
}
