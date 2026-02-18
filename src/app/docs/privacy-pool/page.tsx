import { DocsPage } from "@/components/docs/DocsPage";
import { DocsCallout } from "@/components/docs/DocsCallout";
import { DocsStepList } from "@/components/docs/DocsStepList";
import { DocsBadge } from "@/components/docs/DocsBadge";
import { MerkleTreeMixer } from "@/components/docs/visuals/MerkleTreeMixer";

export default function PrivacyPoolPage() {
  return (
    <DocsPage
      currentHref="/docs/privacy-pool"
      title="Privacy Pool"
      subtitle="Consolidate multiple stealth payments into a single address without creating a traceable on-chain link between deposits and withdrawals."
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
          The Privacy Pool (<code className="text-xs bg-[rgba(255,255,255,0.06)] px-1.5 rounded-sm">DustPool</code>)
          solves this.  You deposit from multiple stealth wallets, mix them with other users' deposits in a shared
          Merkle tree, then withdraw to any address using a zero-knowledge proof. The proof only reveals that
          <em> someone</em> in the pool has a valid commitment — not <em>which</em> one is yours.
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
            title: "Generate a commitment",
            children: <>Before depositing, your browser generates two random secrets: a <code>nullifier</code> and
              a <code>secret</code>. It computes a Poseidon commitment:
              <code> C = Poseidon(Poseidon(nullifier, secret), amount)</code>.
              Only you know the nullifier and secret. The commitment <code>C</code> is what goes on-chain.</>,
          },
          {
            title: "Deposit ETH + commitment",
            children: <>Your stealth wallet calls <code>DustPool.deposit(commitment)</code> with the exact ETH amount.
              The commitment is inserted as a leaf in an on-chain <strong>Poseidon Merkle tree</strong> (depth 20,
              ~1 million capacity). The Merkle root updates atomically with the deposit.</>,
          },
          {
            title: "Wait for more deposits (anonymity set grows)",
            children: <>The longer you wait, the more other users deposit into the same tree — increasing the
              anonymity set. The pool only reveals <em>which root</em> was used, not which of the ~1M possible
              leaves is the one being withdrawn.</>,
          },
          {
            title: "Generate a Groth16 ZK proof (in-browser)",
            children: <>When you're ready to withdraw, the browser runs{" "}
              <strong>snarkjs</strong> with the WASM circuit and <code>.zkey</code> proving key to generate a
              Groth16 proof. This takes ~1–2 seconds on modern hardware. The proof has four public inputs:
              <code> root</code>, <code>nullifierHash</code>, <code>recipient</code>, <code>amount</code>.
              The nullifier and secret remain private inputs and are never sent anywhere.</>,
          },
          {
            title: "Submit proof — contract verifies and pays out",
            children: <>The proof is sent to <code>DustPool.withdraw(proof, root, nullifierHash, recipient, amount)</code>.
              The contract: (1) verifies the Groth16 proof on-chain, (2) checks the <code>root</code> exists
              in its root history, (3) checks <code>nullifierHash</code> has not been spent before, (4) marks
              the nullifier spent, (5) transfers <code>amount</code> ETH to <code>recipient</code>. No logs
              connect any deposit leaf to this withdrawal.</>,
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
                ["Proof system", "Groth16 (BN254 curve)"],
                ["Hash function", "Poseidon (ZK-friendly, ~5 constraints per hash)"],
                ["Circuit size", "~5,900 constraints"],
                ["Merkle tree depth", "20 (2²⁰ ≈ 1,048,576 leaves)"],
                ["Proving environment", "In-browser via snarkjs + WASM"],
                ["Proof generation time", "~1–2 seconds"],
                ["Gas for verification", "~250,000 gas"],
                ["Double-spend prevention", "nullifierHash stored on-chain after first withdrawal"],
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
            <strong className="text-white">Keep your deposit note safe.</strong> The nullifier and secret are
            stored in your browser's localStorage. If you clear browser data, you lose the note and cannot
            generate a withdrawal proof. Export and back up your notes from the Wallet page.
          </p>
          <p>
            <strong className="text-white">Fixed denominations are recommended</strong> to prevent
            amount-based correlation. If all withdrawals look identical in size, amount cannot be used to
            link deposit to withdrawal.
          </p>
          <p>
            <strong className="text-white">The proving key is public.</strong> Anyone can verify the proofs
            on-chain. The security comes from the hardness of the discrete log problem — the nullifier and
            secret cannot be extracted from the commitment.
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <DocsBadge variant="green">Groth16</DocsBadge>
          <DocsBadge variant="green">Poseidon Hash</DocsBadge>
          <DocsBadge variant="muted">BN254</DocsBadge>
          <DocsBadge variant="muted">snarkjs</DocsBadge>
          <DocsBadge variant="muted">Merkle Depth 20</DocsBadge>
        </div>
      </section>
    </DocsPage>
  );
}
