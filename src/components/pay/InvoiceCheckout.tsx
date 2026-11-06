"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, useConnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { colors, radius, shadows, glass, typography, getExplorerBase } from "@/lib/design/tokens";
import { useStealthSend, useStealthName } from "@/hooks/stealth";
import { NAME_SUFFIX } from "@/lib/stealth";
import { getChainConfig } from "@/config/chains";
import { localDateString, type InvoiceParseResult } from "@/lib/invoices/invoice";
import { ShieldIcon, AlertCircleIcon, ArrowUpRightIcon, LockIcon } from "@/components/stealth/icons";
import { DustLogo } from "@/components/DustLogo";

export const INVOICE_PAID_MESSAGE = "dust:invoice-paid";

interface InvoiceCheckoutProps {
  merchantName: string;
  parse: InvoiceParseResult;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: colors.bg.page, color: colors.text.primary, display: "flex", flexDirection: "column" }}>
      <header style={{
        borderBottom: `1px solid ${colors.border.default}`, background: glass.modal.bg, backdropFilter: glass.modal.backdropFilter,
        boxShadow: shadows.card, padding: "16px 24px", position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", maxWidth: "600px", margin: "0 auto" }}>
          <Link href="/" style={{ textDecoration: "none", display: "flex", gap: "8px", alignItems: "center" }}>
            <DustLogo size={24} color={colors.accent.indigo} />
            <span style={{ fontSize: "20px", fontWeight: 800, color: colors.text.primary, fontFamily: typography.fontFamily.heading, letterSpacing: "-0.03em" }}>Dust</span>
          </Link>
          <span style={{ padding: "5px 12px", backgroundColor: "rgba(0,255,65,0.12)", border: "1px solid rgba(0,255,65,0.2)", borderRadius: radius.full, fontSize: "11px", color: colors.accent.indigoBright, fontWeight: 600 }}>
            Invoice
          </span>
        </div>
      </header>
      <main style={{ flex: 1, display: "flex", justifyContent: "center", padding: "48px 16px" }}>
        <div style={{ width: "100%", maxWidth: "460px", background: colors.bg.cardSolid, borderRadius: radius.xl, border: `1px solid ${colors.border.default}`, boxShadow: shadows.card, overflow: "hidden" }}>
          {children}
        </div>
      </main>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", padding: "10px 0", borderBottom: `1px solid ${colors.border.light}` }}>
      <span style={{ fontSize: "13px", color: colors.text.muted }}>{label}</span>
      <span style={{ fontSize: "13px", color: colors.text.primary, textAlign: "right", wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

export function InvoiceCheckout({ merchantName, parse }: InvoiceCheckoutProps) {
  if (!parse.ok) {
    return (
      <Shell>
        <div style={{ padding: "32px 24px", display: "flex", flexDirection: "column", gap: "12px", alignItems: "center", textAlign: "center" }}>
          <AlertCircleIcon size={28} color={colors.accent.red} />
          <p style={{ fontSize: "16px", fontWeight: 600 }}>This invoice link can&apos;t be paid</p>
          <p style={{ fontSize: "13px", color: colors.text.muted }}>{parse.error}. Ask {merchantName}{NAME_SUFFIX} for a new link.</p>
        </div>
      </Shell>
    );
  }
  return <PayableInvoice merchantName={merchantName} parse={parse} />;
}

function PayableInvoice({ merchantName, parse }: { merchantName: string; parse: Extract<InvoiceParseResult, { ok: true }> }) {
  const { terms, token, returnOrigin } = parse.invoice;
  const chain = getChainConfig(terms.chainId);
  const merchant = `${merchantName}${NAME_SUFFIX}`;
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const { resolveName, isConfigured } = useStealthName();
  const { sendTokenToStealth, sendTokenWithAuthorization, isLoading, error } = useStealthSend(terms.chainId);
  const isGasless = Boolean(token.authorization && chain.contracts.stealthPaymentRouter);

  const [metaAddress, setMetaAddress] = useState<string | null>(null);
  const [resolveFailed, setResolveFailed] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigured) return;
    let ignore = false;
    (async () => {
      const resolved = await resolveName(merchant);
      if (ignore) return;
      if (resolved) setMetaAddress(`st:eth:${resolved}`);
      else setResolveFailed(true);
    })();
    return () => { ignore = true; };
  }, [isConfigured, merchant, resolveName]);

  const isOverdue = terms.dueDate !== null && localDateString(new Date()) > terms.dueDate;
  const explorer = getExplorerBase(terms.chainId);

  const pay = async () => {
    if (!metaAddress) return;
    const options = { invoiceId: terms.id };
    const hash = isGasless
      ? await sendTokenWithAuthorization(metaAddress, token, terms.amount, options)
      : await sendTokenToStealth(metaAddress, token.address, terms.amount, options);
    if (!hash) return;
    setTxHash(hash);
    if (returnOrigin && window.opener) {
      window.opener.postMessage({ type: INVOICE_PAID_MESSAGE, invoiceId: terms.id, txHash: hash, chainId: terms.chainId }, returnOrigin);
    }
  };

  return (
    <Shell>
      <div style={{ padding: "28px 24px 20px", textAlign: "center", borderBottom: `1px solid ${colors.border.default}` }}>
        <div style={{ display: "inline-flex", padding: "12px", borderRadius: "50%", backgroundColor: txHash ? "rgba(34,197,94,0.1)" : "rgba(43,90,226,0.08)", marginBottom: "10px" }}>
          <ShieldIcon size={24} color={txHash ? colors.accent.green : colors.accent.indigo} />
        </div>
        <p style={{ fontSize: "13px", color: colors.text.muted }}>{txHash ? `Paid to ${merchant}` : `${merchant} requests`}</p>
        <p style={{ fontSize: "34px", fontWeight: 700, fontFamily: typography.fontFamily.heading, letterSpacing: "-0.02em", marginTop: "4px" }}>
          {terms.amount} {token.symbol}
        </p>
        <p style={{ fontSize: "12px", color: colors.text.muted, marginTop: "4px" }}>on {chain.name}</p>
      </div>

      <div style={{ padding: "8px 24px 0" }}>
        {terms.memo && <DetailRow label="For" value={terms.memo} />}
        {terms.dueDate && <DetailRow label="Due" value={isOverdue ? `${terms.dueDate} (overdue)` : terms.dueDate} />}
        {isGasless && <DetailRow label="Network fee" value="Paid by Dust" />}
        <DetailRow label="Reference" value={`${terms.id.slice(0, 10)}…${terms.id.slice(-6)}`} />
      </div>

      <div style={{ padding: "20px 24px 24px", display: "flex", flexDirection: "column", gap: "14px" }}>
        {txHash ? (
          <a href={`${explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
            style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "6px", padding: "12px", borderRadius: radius.sm, border: `1px solid ${colors.border.default}`, color: colors.text.primary, fontSize: "14px", textDecoration: "none" }}>
            View payment on explorer <ArrowUpRightIcon size={14} color={colors.text.muted} />
          </a>
        ) : !isConnected ? (
          <button onClick={() => connect({ connector: injected() })}
            style={{ padding: "14px", borderRadius: radius.sm, border: "none", background: colors.accent.indigo, color: "#000", fontWeight: 700, fontSize: "15px", cursor: "pointer" }}>
            Connect wallet to pay
          </button>
        ) : (
          <button onClick={pay} disabled={!metaAddress || isLoading}
            style={{ padding: "14px", borderRadius: radius.sm, border: "none", background: colors.accent.indigo, color: "#000", fontWeight: 700, fontSize: "15px", cursor: metaAddress && !isLoading ? "pointer" : "not-allowed", opacity: metaAddress && !isLoading ? 1 : 0.5 }}>
            {isLoading ? (isGasless ? "Sign the payment in your wallet…" : "Confirm in your wallet…") : metaAddress ? `Pay ${terms.amount} ${token.symbol}` : "Finding merchant…"}
          </button>
        )}

        {resolveFailed && !txHash && (
          <p style={{ fontSize: "13px", color: colors.accent.red, textAlign: "center" }}>{merchant} isn&apos;t registered on Dust, so this invoice can&apos;t be paid privately.</p>
        )}
        {error && !txHash && (
          <p style={{ fontSize: "13px", color: colors.accent.red, textAlign: "center", wordBreak: "break-word" }}>{error}</p>
        )}

        <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
          <LockIcon size={14} color={colors.text.muted} />
          <p style={{ fontSize: "12px", color: colors.text.muted, lineHeight: 1.5 }}>
            Your payment goes to a one-time address only {merchant} can find. Nobody watching the chain can tie it to their other payments or their wallet.
          </p>
        </div>
      </div>
    </Shell>
  );
}
