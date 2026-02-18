import { DocsPage } from "@/components/docs/DocsPage";
import { DocsCallout } from "@/components/docs/DocsCallout";
import { DocsStepList } from "@/components/docs/DocsStepList";
import { DocsBadge } from "@/components/docs/DocsBadge";
import { EndToEndTimeline } from "@/components/docs/visuals/EndToEndTimeline";

export default function HowItWorksPage() {
  return (
    <DocsPage
      currentHref="/docs/how-it-works"
      title="How It Works"
      subtitle="A complete walkthrough of the Dust Protocol lifecycle — from wallet connection to private withdrawal."
      badge="GETTING STARTED"
    >

      <DocsCallout type="info" title="One-pager summary">
        This page covers the full system end-to-end. Individual feature pages go deeper on each step.
      </DocsCallout>

      <div className="mb-12">
        <EndToEndTimeline />
      </div>

      {/* Phase 1 */}
      <section className="mb-10">
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-1 uppercase">Phase 1 — Identity Setup</h2>
        <p className="text-xs text-[rgba(255,255,255,0.35)] font-mono mb-5">One-time, done during onboarding</p>
        <DocsStepList steps={[
          {
            title: "Connect your wallet",
            children: <>Connect with any EVM wallet (MetaMask, WalletConnect, Coinbase Wallet, Privy social login, etc.).
              The wallet is used only to <strong>sign a message</strong> — not to hold privacy funds directly.</>,
          },
          {
            title: "Set a PIN",
            children: <>You choose a numeric PIN. Dust derives your private stealth keys using{" "}
              <code>PBKDF2(wallet_signature + PIN, salt, 100 000 iterations)</code>. The PIN never leaves your browser.
              Neither the wallet signature nor the PIN alone are sufficient — both are required.</>,
          },
          {
            title: "Register a .tok name",
            children: <>Your <strong>stealth meta-address</strong> (a pair of secp256k1 public keys: <code>spendKey</code> and <code>viewKey</code>)
              is registered on the <code>StealthNameRegistry</code> contract under a name like <code>alice.tok</code>.
              This is what senders look up. It contains no balance information and maps to no single address.</>,
          },
        ]} />
      </section>

      {/* Phase 2 */}
      <section className="mb-10">
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-1 uppercase">Phase 2 — Receiving a Payment</h2>
        <p className="text-xs text-[rgba(255,255,255,0.35)] font-mono mb-5">Sender-side, no interaction from recipient needed</p>
        <DocsStepList steps={[
          {
            title: "Sender looks up alice.tok",
            children: <>The sender visits <code>/pay/alice</code> (or uses any UI that queries <code>StealthNameRegistry</code>).
              The contract returns Alice's meta-address: her two public keys.</>,
          },
          {
            title: "Stealth address is derived (ECDH)",
            children: <>The sender picks a random scalar <code>r</code>, computes a <strong>shared secret</strong> via
              Elliptic Curve Diffie–Hellman: <code>sharedSecret = r × viewKey</code>. A fresh one-time
              <strong> stealth address</strong> is derived: <code>stealthAddress = spendKey + hash(sharedSecret) × G</code>.
              This address is unique every time — the same sender paying Alice twice produces two completely different addresses.</>,
          },
          {
            title: "ETH is sent to the stealth address",
            children: <>The sender broadcasts a normal ETH transfer to <code>stealthAddress</code>.
              Simultaneously, an announcement <code>(ephemeralPubKey R, stealthAddress)</code> is emitted on the
              <code> ERC5564Announcer</code> contract — it's the encrypted hint Alice's scanner uses.</>,
          },
        ]} />
      </section>

      {/* Phase 3 */}
      <section className="mb-10">
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-1 uppercase">Phase 3 — Detecting & Claiming</h2>
        <p className="text-xs text-[rgba(255,255,255,0.35)] font-mono mb-5">Recipient-side, runs automatically in the browser</p>
        <DocsStepList steps={[
          {
            title: "Scanner polls announcements",
            children: <>Every 30 seconds, the in-browser scanner fetches new announcements from <code>ERC5564Announcer</code>.
              For each announcement it recomputes <code>sharedSecret = viewKey × R</code> and checks whether the
              derived address matches the announced <code>stealthAddress</code>.</>,
          },
          {
            title: "Stealth private key is derived",
            children: <>When a match is found, Alice derives the stealth private key:
              <code> stealthPrivKey = spendKey + hash(sharedSecret)</code>. This key controls the funds.
              It never leaves the browser — it is computed in memory and used only to sign.</>,
          },
          {
            title: "Gasless claim via ERC-4337",
            children: <>Alice clicks Claim. The stealth key signs a <strong>UserOperation</strong> locally.
              A sponsored relayer submits it to the <code>EntryPoint</code> contract. The <code>DustPaymaster</code>
              covers gas. A <code>StealthAccount</code> is deployed at a CREATE2 address and immediately drains
              its balance to Alice's designated claim address — all in one atomic transaction.</>,
          },
        ]} />
      </section>

      {/* Phase 4 */}
      <section className="mb-10">
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-1 uppercase">Phase 4 — Consolidation (Privacy Pool)</h2>
        <p className="text-xs text-[rgba(255,255,255,0.35)] font-mono mb-5">Optional — breaks the fan-in correlation</p>
        <p className="text-sm text-[rgba(255,255,255,0.6)] leading-relaxed mb-5">
          If you receive 10 stealth payments and claim all of them to the same address, an on-chain observer can
          see 10 claim transactions landing at one wallet. The <strong>Privacy Pool</strong> breaks this link.
        </p>
        <DocsStepList steps={[
          {
            title: "Deposit to DustPool",
            children: <>Each stealth wallet generates a Poseidon commitment
              <code> C = Poseidon(Poseidon(nullifier, secret), amount)</code> and deposits ETH + commitment
              to the <code>DustPool</code> contract. The commitment is inserted into an on-chain Poseidon Merkle tree.</>,
          },
          {
            title: "Generate a ZK proof (in-browser)",
            children: <>When ready to withdraw, the browser runs <strong>snarkjs</strong> to generate a Groth16
              proof of Merkle tree membership. Public inputs are: <code>root, nullifierHash, recipient, amount</code>.
              The proof takes ~1–2 seconds and proves you own a valid commitment without revealing which one.</>,
          },
          {
            title: "Contract verifies and releases",
            children: <>The <code>DustPool</code> contract verifies the Groth16 proof, marks the <code>nullifierHash</code>
              as spent (preventing double-withdrawal), and sends the funds to your chosen <code>recipient</code> address.
              No on-chain data links the deposit to the withdrawal.</>,
          },
        ]} />
      </section>

      {/* Phase 5 */}
      <section className="mb-10">
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-1 uppercase">Phase 5 — Private Swaps</h2>
        <p className="text-xs text-[rgba(255,255,255,0.35)] font-mono mb-5">Optional — swap tokens without a traceable on-chain signature</p>
        <DocsStepList steps={[
          {
            title: "Deposit to DustSwapPool",
            children: <>Deposit a fixed-denomination amount of ETH or USDC to the <code>DustSwapPoolETH</code> or
              <code> DustSwapPoolUSDC</code> contract and receive a locally-stored deposit note containing your
              nullifier and secret.</>,
          },
          {
            title: "Generate a PrivateSwap ZK proof",
            children: <>The browser generates a Groth16 proof (<code>PrivateSwap.circom</code>) that proves Merkle
              membership in the swap pool. The proof encodes <code>recipient</code> — a stealth address where output
              tokens should land. A 50-block minimum wait enforces temporal privacy.</>,
          },
          {
            title: "Atomic proof-verified swap via Uniswap V4",
            children: <>The relayer submits the swap through <code>DustSwapRouter</code>. The Uniswap V4
              <code> DustSwapHook</code>'s <code>beforeSwap</code> verifies the proof and marks the nullifier spent.
              The <code>afterSwap</code> callback routes the output tokens directly to the stealth recipient address.
              Proof verification and the token swap are a single atomic transaction.</>,
          },
        ]} />
      </section>

      {/* Summary table */}
      <section>
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-4 uppercase">Standards Used</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono border-collapse">
            <thead>
              <tr className="border-b border-[rgba(255,255,255,0.06)]">
                <th className="text-left py-2 pr-6 text-[rgba(255,255,255,0.3)] font-normal tracking-wider uppercase text-[10px]">Standard</th>
                <th className="text-left py-2 text-[rgba(255,255,255,0.3)] font-normal tracking-wider uppercase text-[10px]">Role in Dust</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(255,255,255,0.04)]">
              {[
                ["ERC-5564", "Stealth address announcement standard"],
                ["ERC-6538", "Stealth meta-address registry"],
                ["ERC-4337", "Account abstraction — gasless stealth claims"],
                ["EIP-7702", "EOA-as-smart-account support"],
                ["Groth16 / snarkjs", "In-browser ZK proof generation (pool & swaps)"],
                ["Poseidon hash", "ZK-friendly hash in commitments and Merkle trees"],
                ["Uniswap V4 hooks", "Atomic ZK-verified private swaps"],
              ].map(([std, role]) => (
                <tr key={std} className="hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                  <td className="py-2.5 pr-6 text-[#00FF41]">{std}</td>
                  <td className="py-2.5 text-[rgba(255,255,255,0.55)]">{role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </DocsPage>
  );
}
