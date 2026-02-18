import { DocsPage } from "@/components/docs/DocsPage";
import { DocsCallout } from "@/components/docs/DocsCallout";
import { DocsStepList } from "@/components/docs/DocsStepList";
import { DocsBadge } from "@/components/docs/DocsBadge";
import { AtomicSwapHook } from "@/components/docs/visuals/AtomicSwapHook";

export default function PrivacySwapsPage() {
  return (
    <DocsPage
      currentHref="/docs/privacy-swaps"
      title="Privacy Swaps"
      subtitle="Swap tokens without leaving a traceable on-chain fingerprint. ZK proof verification and the swap are atomic — a single transaction."
      badge="CORE FEATURE"
    >

      {/* The problem */}
      <section className="mb-10">
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-3 uppercase">DEX Fingerprinting</h2>
        <p className="text-sm text-[rgba(255,255,255,0.6)] leading-relaxed mb-4">
          Even after privately receiving ETH through stealth transfers, swapping reveals a pattern. The amount
          you deposit to a DEX and the timing form a unique fingerprint. An on-chain analyst can cluster
          multiple stealth wallets as belonging to the same user just by watching who swaps similar amounts
          at similar times.
        </p>
        <p className="text-sm text-[rgba(255,255,255,0.6)] leading-relaxed">
          Privacy Swaps (<code className="text-xs bg-[rgba(255,255,255,0.06)] px-1.5 rounded-sm">DustSwap</code>)
          solve this with <strong>fixed denominations</strong> and a Uniswap V4 hook that validates a
          ZK proof atomically inside the swap transaction — so the on-chain record never links a specific
          deposit to a specific swap output.
        </p>
      </section>

      {/* How it works */}
      <section className="mb-10">
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-4 uppercase">How Privacy Swaps Work</h2>

        <div className="mb-8">
          <AtomicSwapHook />
        </div>

        <DocsStepList steps={[
          {
            title: "Choose a fixed-denomination pool",
            children: <>DustSwap offers two pools with fixed deposit amounts:
              <strong> DustSwapPoolETH</strong> (fixed ETH denomination) and{" "}
              <strong>DustSwapPoolUSDC</strong> (fixed USDC denomination). Fixed denominations prevent
              amount-based correlation — every deposit and withdrawal looks identical in size.</>,
          },
          {
            title: "Deposit and receive a swap note",
            children: <>Your browser generates a Poseidon commitment <code>C = Poseidon(nullifier, secret)</code>
              and calls <code>DustSwapPoolETH.deposit(commitment)</code>. The commitment is inserted into
              an on-chain Merkle tree. Your <strong>swap note</strong> (nullifier + secret + commitment)
              is stored locally in your browser — treat it like a bearer instrument.</>,
          },
          {
            title: "Wait at least 50 blocks",
            children: <>The <code>DustSwapHook</code> enforces a <code>minWaitBlocks = 50</code> delay between
              deposit and swap. This prevents timing correlation — an observer cannot match a swap to a
              deposit that happened in the same block or immediately before.</>,
          },
          {
            title: "Specify a stealth recipient address",
            children: <>Before proving, choose a <strong>fresh stealth address</strong> where you want the
              swap output to land. This address is encoded as a public input in the ZK proof — the contract
              will route output tokens directly there. It can be any address you control privately.</>,
          },
          {
            title: "Generate a PrivateSwap Groth16 proof (in-browser)",
            children: <>The browser runs <strong>snarkjs</strong> with the <code>PrivateSwap.circom</code>
              circuit. Public inputs: <code>root, nullifierHash, recipient, minBlockNumber</code>.
              Private inputs: <code>nullifier, secret, merkleProof[]</code>. The proof asserts that
              you know a valid commitment in the tree without revealing which leaf it is.</>,
          },
          {
            title: "Atomic swap via Uniswap V4 hook",
            children: <>A relayer submits the swap through <code>DustSwapRouter</code>, passing the ZK proof
              as <code>hookData</code> to Uniswap V4.
              <strong> beforeSwap hook</strong>: proof verified on-chain, nullifier marked spent, block
              timing enforced.
              <strong> afterSwap hook</strong>: output tokens taken from the V4 PoolManager and transferred
              directly to the <code>recipient</code> stealth address.
              Everything is atomic — there is no intermediate transaction that could reveal the link.</>,
          },
        ]} />
      </section>

      {/* Architecture diagram (text) */}
      <section className="mb-10">
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-4 uppercase">Architecture</h2>
        <div className="font-mono text-xs leading-relaxed text-[rgba(255,255,255,0.5)] bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-sm p-5 overflow-x-auto whitespace-pre">
          {`User browser
  └─ generates commitment ──► DustSwapPoolETH.deposit()
                                  └─ inserts leaf into Merkle tree

  ...(50+ blocks later)...

  └─ generates ZK proof ──► DustSwapRouter.swap(proof as hookData)
                                  └─ Uniswap V4 PoolManager
                                       ├─ beforeSwap ─► DustSwapHook.verify(proof)
                                       │                   DustSwapPoolETH.releaseForSwap()
                                       │                   mark nullifier spent
                                       ├─ swap executes (ETH → USDC or USDC → ETH)
                                       └─ afterSwap ──► DustSwapHook routes output
                                                         to stealth recipient address`}
        </div>
      </section>

      {/* Key properties */}
      <section className="mb-10">
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-4 uppercase">Key Properties</h2>
        <div className="space-y-3">
          {[
            {
              label: "Fixed denominations",
              desc: "All deposits in a pool are the same size. An observer cannot use amount to link deposit to output.",
            },
            {
              label: "Atomic proof + swap",
              desc: "ZK verification and the Uniswap V4 swap happen in one transaction. There is no two-step process that creates a timing link.",
            },
            {
              label: "Output to stealth address",
              desc: "Swap output tokens go directly to a recipient address encoded in the proof — not to your main wallet.",
            },
            {
              label: "50-block minimum wait",
              desc: "Enforced by the hook. Prevents temporal correlation between deposit and swap.",
            },
            {
              label: "Gas optimization: 51% reduction",
              desc: "O(1) root lookup, hardcoded Poseidon zero hashes, and optimized storage packing save ~247,000 gas per swap.",
            },
          ].map(({ label, desc }) => (
            <div key={label} className="flex gap-4 p-3 border border-[rgba(255,255,255,0.05)] rounded-sm">
              <div className="shrink-0 w-1 rounded-full bg-[rgba(0,255,65,0.3)]" />
              <div>
                <p className="text-xs font-mono font-semibold text-white mb-1">{label}</p>
                <p className="text-xs text-[rgba(255,255,255,0.5)] leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <DocsCallout type="warning" title="Swap notes are local">
        Your swap deposit note (nullifier + secret) is stored only in your browser. If you clear localStorage
        or switch devices, you lose the ability to generate a withdrawal proof. Use the <strong>Wallet</strong>{" "}
        page to export and back up your notes.
      </DocsCallout>

      <section className="mt-8">
        <div className="flex flex-wrap gap-2">
          <DocsBadge variant="green">Uniswap V4 Hooks</DocsBadge>
          <DocsBadge variant="green">Groth16</DocsBadge>
          <DocsBadge variant="green">PrivateSwap.circom</DocsBadge>
          <DocsBadge variant="muted">BN254</DocsBadge>
          <DocsBadge variant="muted">Fixed Denominations</DocsBadge>
          <DocsBadge variant="muted">50-block delay</DocsBadge>
        </div>
      </section>
    </DocsPage>
  );
}
