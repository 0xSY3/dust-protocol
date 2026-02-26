import { DocsPage } from "@/components/docs/DocsPage";
import { DocsCallout } from "@/components/docs/DocsCallout";
import { DocsStepList } from "@/components/docs/DocsStepList";
import { DocsBadge } from "@/components/docs/DocsBadge";
import {
  DepositAmountSnippet,
  DepositCommitmentSnippet,
  DepositProcessingSnippet,
  DepositSuccessSnippet,
} from "@/components/docs/visuals/DepositFlowPreview";
import { docsMetadata } from "@/lib/seo/metadata";
import { techArticleJsonLd } from "@/lib/seo/jsonLd";

const articleLd = techArticleJsonLd("Deposits — Dust Protocol App Guide", "How to deposit ETH or ERC-20 tokens into the DustPoolV2 privacy pool, creating UTXO-style notes with Poseidon commitments.", "/docs/app-guide/deposits");

export const metadata = docsMetadata("Deposits — Dust Protocol App Guide", "How to deposit ETH or ERC-20 tokens into the DustPoolV2 privacy pool, creating UTXO-style notes with Poseidon commitments.", "/docs/app-guide/deposits");

export default function DepositsPage() {
  return (
    <>
    {/* Safe: hardcoded string literals only — see articleLd declaration above */}
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: articleLd }} />
    <DocsPage
      currentHref="/docs/app-guide/deposits"
      title="Deposits"
      badge="APP GUIDE"
    >

      {/* What is a Deposit? */}
      <section className="mb-10">
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-3 uppercase">What is a Deposit?</h2>
        <DepositAmountSnippet />
        <p className="text-sm text-[rgba(255,255,255,0.6)] leading-relaxed mb-4">
          A deposit moves funds from your connected wallet into the shared <strong className="text-white">DustPoolV2</strong> contract.
          Instead of a simple balance transfer, the contract stores a cryptographic commitment — a Poseidon hash of your
          ownership key, the amount, asset type, chain ID, and a random blinding factor. This creates a UTXO-style note
          that only you can spend, using a ZK proof.
        </p>
        <p className="text-sm text-[rgba(255,255,255,0.6)] leading-relaxed">
          Deposits support <strong className="text-white">arbitrary amounts</strong> of ETH or supported ERC-20 tokens (like USDC).
          There are no fixed denominations — you deposit exactly the amount you want. Two deposit modes are available:
          deposit from your connected (Privy) wallet, or deposit from an external wallet like MetaMask via a generated
          deposit link or QR code.
        </p>
      </section>

      {/* Step by Step */}
      <section className="mb-10">
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-4 uppercase">Step by Step</h2>

        <DocsStepList steps={[
          {
            title: "Enter the deposit amount",
            children: <>Choose ETH or USDC and enter an amount. The modal shows your wallet balance and reserves
              0.005 ETH for gas when using the MAX button. For USDC deposits, the contract will request an
              ERC-20 approval before the deposit transaction.</>,
          },
          {
            title: "Browser generates the commitment",
            children: <>Your browser generates a random blinding factor and computes a Poseidon commitment:
              <code> C = Poseidon(ownerPubKey, amount, asset, chainId, blinding)</code>.
              This commitment reveals nothing about the deposit details — only the depositor and the contract
              can reconstruct it.</>,
          },
          {
            title: "On-chain transaction",
            children: <>The deposit calls <code>DustPoolV2.deposit(commitment)</code> with the ETH value attached
              (or <code>depositERC20(token, amount, commitment)</code> for tokens). The contract stores the
              commitment and emits a <code>DepositV2</code> event. Your wallet will prompt you to confirm
              the transaction.</>,
          },
          {
            title: "Note encrypted and saved to IndexedDB",
            children: <>Your deposit note — containing the amount, blinding factor, asset, and commitment — is
              encrypted with <strong>AES-256-GCM</strong> (key derived from your spending key) and stored in the
              browser&apos;s IndexedDB. Notes are never stored in plaintext or sent to any server.</>,
          },
          {
            title: "Relayer adds commitment to Merkle tree",
            children: <>The relayer monitors the contract for new deposit events and inserts each commitment
              into the off-chain Poseidon Merkle tree (depth 20). Once included, the commitment can be referenced
              in ZK proofs for withdrawals or transfers.</>,
          },
        ]} />

        <DepositCommitmentSnippet />
        <DepositProcessingSnippet />
      </section>

      {/* PIN Required */}
      <section className="mb-10">
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-3 uppercase">PIN Required</h2>
        <p className="text-sm text-[rgba(255,255,255,0.6)] leading-relaxed">
          Before depositing, you must unlock your V2 keys by entering your 6-digit PIN. The PIN is combined with a wallet
          signature via <strong className="text-white">PBKDF2</strong> (100,000 iterations) to derive your spending key and
          nullifier key. These keys are held in a React ref for the duration of your session — they are never persisted
          to storage. If you haven&apos;t set a PIN yet, the deposit modal will guide you through creating one.
        </p>
      </section>

      {/* Compliance */}
      <section className="mb-10">
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-3 uppercase">Compliance Screening</h2>
        <p className="text-sm text-[rgba(255,255,255,0.6)] leading-relaxed mb-4">
          When the deposit modal opens, your wallet address is automatically screened against the
          <strong className="text-white"> Chainalysis sanctions oracle</strong>. If the address is flagged, deposits are
          blocked. If the oracle is unavailable, a warning is shown but you may still attempt to deposit — the on-chain
          contract will enforce the check regardless.
        </p>
        <p className="text-sm text-[rgba(255,255,255,0.6)] leading-relaxed">
          After a successful deposit, a <strong className="text-white">1-hour compliance cooldown</strong> begins. During
          this window, private transfers are restricted — you can only withdraw back to your original deposit address.
          This gives compliance systems time to flag suspicious activity before funds become fully transferable.
        </p>
      </section>

      {/* Success state */}
      <DepositSuccessSnippet />

      {/* Warning callout */}
      <DocsCallout type="warning" title="Irreversible">
        Deposits are irreversible. Once a commitment is stored on-chain, funds can only be retrieved by generating
        a valid ZK proof (withdrawal or transfer). If you lose access to your browser&apos;s IndexedDB data without
        a backup, your notes — and the funds they represent — cannot be recovered.
      </DocsCallout>

      {/* Badges */}
      <div className="mt-6 flex flex-wrap gap-2">
        <DocsBadge variant="green">FFLONK</DocsBadge>
        <DocsBadge variant="green">Poseidon</DocsBadge>
        <DocsBadge variant="amber">AES-256-GCM</DocsBadge>
        <DocsBadge variant="muted">UTXO</DocsBadge>
      </div>
    </DocsPage>
    </>
  );
}
