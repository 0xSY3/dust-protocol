import { DocsPage } from "@/components/docs/DocsPage";
import { DocsCallout } from "@/components/docs/DocsCallout";
import { DocsStepList } from "@/components/docs/DocsStepList";
import { DocsBadge } from "@/components/docs/DocsBadge";
import { MerkleTreeMixer } from "@/components/docs/visuals/MerkleTreeMixer";
import { docsMetadata } from "@/lib/seo/metadata";
import { techArticleJsonLd } from "@/lib/seo/jsonLd";

/**
 * XSS-safe: all values below are hardcoded string literals defined in this file.
 * safeJsonLd() in jsonLd.ts escapes any '<' characters as \u003c to prevent injection.
 * No user input flows into this JSON-LD — only compile-time constants.
 */
const articleLd = techArticleJsonLd("Privacy Pool — ZK Proof Withdrawals", "ZK-UTXO privacy pool with FFLONK proofs, arbitrary-amount deposits, split withdrawals for denomination privacy, and built-in compliance screening.", "/docs/privacy-pool");

export const metadata = docsMetadata("Privacy Pool — ZK Proof Withdrawals", "ZK-UTXO privacy pool with FFLONK proofs, arbitrary-amount deposits, split withdrawals for denomination privacy, and built-in compliance screening.", "/docs/privacy-pool");

export default function PrivacyPoolPage() {
  return (
    <>
    {/* Safe: hardcoded string literals only — see articleLd declaration above */}
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: articleLd }} />
    <DocsPage
      currentHref="/docs/privacy-pool"
      title="Privacy Pool"
      subtitle="A ZK-UTXO privacy pool — deposit any amount, withdraw with a FFLONK proof. Split withdrawals prevent amount fingerprinting. No fixed denominations required."
      badge="CORE FEATURE"
    >

      {/* The problem */}
      <section className="mb-10">
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-3 uppercase">The Fan-In Problem</h2>
        <p className="text-sm text-[rgba(255,255,255,0.6)] leading-relaxed mb-4">
          Stealth transfers give every payment a unique, unlinkable address. But once you <em>claim</em> those
          payments, all roads lead to your real wallet. An observer watching the claim address sees 10 inbound
          transactions from 10 different stealth addresses — and immediately knows those wallets belong to you.
        </p>
        <p className="text-sm text-[rgba(255,255,255,0.6)] leading-relaxed">
          <strong className="text-white">DustPool V2</strong> solves this with a ZK-UTXO model. You deposit any amount — ETH or
          ERC-20 tokens — into a shared pool. Each deposit creates a UTXO-style note with a Poseidon commitment.
          To withdraw, you generate a <strong>FFLONK proof</strong> (no trusted setup) that proves you own valid notes
          without revealing which ones. The 2-in-2-out circuit consumes input notes and creates change notes,
          just like Bitcoin&apos;s UTXO model but with full privacy.
        </p>
      </section>

      {/* How it works */}
      <section className="mb-10">
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-4 uppercase">How the Privacy Pool Works</h2>

        <div className="mb-8">
          <MerkleTreeMixer />
        </div>

        <DocsStepList steps={[
          {
            title: "Deposit and create a UTXO note",
            children: <>Your browser generates a random blinding factor and computes a Poseidon commitment:
              <code> C = Poseidon(ownerPubKey, amount, asset, chainId, blinding)</code>.
              Call <code>DustPoolV2.deposit(commitment)</code> or <code>depositERC20(token, amount, commitment)</code>.
              The commitment is added to the relayer&apos;s off-chain Merkle tree. Your <strong>note</strong> (amount, blinding,
              asset, commitment) is encrypted with AES-256-GCM and stored in IndexedDB — not plaintext localStorage.</>,
          },
          {
            title: "Notes accumulate (UTXO model)",
            children: <>Each deposit creates an independent note. Unlike V1&apos;s fixed-amount mixer, you can deposit
              any amount at any time. Notes are like Bitcoin UTXOs — they have a specific value and are consumed
              whole when spent. The &ldquo;change&rdquo; from a partial withdrawal becomes a new output note.</>,
          },
          {
            title: "Generate a FFLONK proof (in-browser)",
            children: <>The browser runs the <strong>2-in-2-out transaction circuit</strong> (~12,400 constraints) to produce
              a FFLONK proof. Two input notes are consumed, two output notes are created (one for the withdrawal amount,
              one for change). Public signals: <code>merkleRoot, null0, null1, outC0, outC1, pubAmount, pubAsset,
              recipient, chainId</code>. The FFLONK system requires <strong>no trusted setup</strong> ceremony.</>,
          },
          {
            title: "Submit to relayer for on-chain verification",
            children: <>The proof is sent to the relayer (same-origin Next.js API at <code>/api/v2/withdraw</code>).
              The relayer screens the recipient against the Chainalysis sanctions oracle, then submits to
              <code> DustPoolV2.withdraw()</code>. The contract verifies the FFLONK proof, checks nullifier freshness,
              validates chainId binding, confirms solvency, marks nullifiers spent, and transfers funds.</>,
          },
          {
            title: "Split withdrawals for denomination privacy (optional)",
            children: <>To prevent amount fingerprinting, use the <strong>2-in-8-out split circuit</strong> (~32,074
              constraints). The denomination engine automatically breaks your withdrawal into common ETH chunks
              (10, 5, 3, 2, 1, 0.5, 0.3, etc.). Each chunk is submitted as a separate transaction with randomized
              timing — an observer sees only standard-looking amounts with no pattern.</>,
          },
        ]} />
      </section>

      {/* Circuit details */}
      <section className="mb-10">
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-3 uppercase">Circuit Details</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono border-collapse">
            <thead>
              <tr className="border-b border-[rgba(255,255,255,0.06)]">
                <th className="text-left py-2 pr-6 text-[rgba(255,255,255,0.3)] font-normal tracking-wider uppercase text-[10px]">Property</th>
                <th className="text-left py-2 text-[rgba(255,255,255,0.3)] font-normal tracking-wider uppercase text-[10px]">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(255,255,255,0.04)]">
              {[
                ["Proof system", "FFLONK (no trusted setup, BN254 curve)"],
                ["Hash function", "Poseidon (ZK-friendly, ~5 constraints per hash)"],
                ["Transaction circuit", "2-in-2-out, ~12,400 constraints, 9 public signals"],
                ["Split circuit", "2-in-8-out, ~32,074 constraints, 15 public signals"],
                ["Merkle tree depth", "20 (2\u00B2\u2070 \u2248 1,048,576 leaves)"],
                ["Merkle tree location", "Off-chain, relayer-maintained (verified via root history)"],
                ["Proving environment", "In-browser via snarkjs + WASM"],
                ["Proof generation time", "~2\u20133 seconds (transaction), ~4\u20135 seconds (split)"],
                ["Gas for verification", "~220,000 gas (FFLONK, 22% cheaper than Groth16)"],
                ["Double-spend prevention", "Nullifier = Poseidon(nullifierKey, leafIndex), stored on-chain"],
                ["Commitment structure", "Poseidon(ownerPubKey, amount, asset, chainId, blinding)"],
                ["Note encryption", "AES-256-GCM via Web Crypto API, key = SHA-256(spendingKey)"],
              ].map(([k, v]) => (
                <tr key={k} className="hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                  <td className="py-2.5 pr-6 text-[rgba(255,255,255,0.5)]">{k}</td>
                  <td className="py-2.5 text-white">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Anonymity set */}
      <section className="mb-10">
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-3 uppercase">Anonymity Set</h2>
        <p className="text-sm text-[rgba(255,255,255,0.6)] leading-relaxed mb-4">
          The anonymity set is the number of deposits in the Merkle tree at the time of withdrawal. A larger set
          means a withdrawal could correspond to any of more possible deposits, reducing the probability of
          correct guessing.
        </p>
        <DocsCallout type="tip" title="Best Practice">
          Wait until the pool has accumulated a reasonable number of deposits before withdrawing. The dashboard
          shows the current tree size. Withdrawing immediately after depositing offers minimal privacy benefit.
        </DocsCallout>
        <DocsCallout type="info" title="Root History">
          The contract maintains a history of past Merkle roots. You can prove membership against any root
          that was valid when you deposited — you don't need to re-deposit if new deposits change the root.
        </DocsCallout>
      </section>

      {/* Security */}
      <section>
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-3 uppercase">Security Notes</h2>
        <div className="space-y-3 text-sm text-[rgba(255,255,255,0.6)] leading-relaxed">
          <p>
            <strong className="text-white">Notes are encrypted in IndexedDB.</strong> V2 encrypts deposit notes with
            AES-256-GCM (key derived from your spending key). Even if someone accesses your browser storage,
            they cannot read note data without your stealth keys. Export and back up notes from the Settings page.
          </p>
          <p>
            <strong className="text-white">Compliance screening is built-in.</strong> The Chainalysis oracle screens
            every depositor address. A 1-hour cooldown after deposit restricts withdrawals to the original
            depositor&apos;s address — giving compliance systems time to flag suspicious activity.
          </p>
          <p>
            <strong className="text-white">Denomination privacy via split withdrawals.</strong> Instead of fixed
            denominations, the split circuit breaks withdrawals into common amounts automatically. This prevents
            amount-based correlation while supporting arbitrary deposit sizes.
          </p>
          <p>
            <strong className="text-white">Chain ID binding prevents cross-chain replay.</strong> Every proof includes
            the chain ID as a public signal. A proof generated for Ethereum Sepolia cannot be replayed on Thanos
            Sepolia or any other chain.
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <DocsBadge variant="green">FFLONK</DocsBadge>
          <DocsBadge variant="green">Poseidon Hash</DocsBadge>
          <DocsBadge variant="green">ZK-UTXO</DocsBadge>
          <DocsBadge variant="muted">BN254</DocsBadge>
          <DocsBadge variant="muted">snarkjs</DocsBadge>
          <DocsBadge variant="muted">Merkle Depth 20</DocsBadge>
          <DocsBadge variant="amber">Chainalysis</DocsBadge>
          <DocsBadge variant="amber">AES-256-GCM</DocsBadge>
        </div>
      </section>
    </DocsPage>
    </>
  );
}
