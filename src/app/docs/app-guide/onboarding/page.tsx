import { DocsPage } from "@/components/docs/DocsPage";
import { DocsStepList } from "@/components/docs/DocsStepList";
import { DocsCallout } from "@/components/docs/DocsCallout";
import { DocsBadge } from "@/components/docs/DocsBadge";
import {
  OnboardingPinSnippet,
  OnboardingUsernameSnippet,
  OnboardingActivateSnippet,
} from "@/components/docs/visuals/OnboardingPreview";

export default function OnboardingPage() {
  return (
    <DocsPage
      currentHref="/docs/app-guide/onboarding"
      title="Onboarding & PIN"
      badge="APP GUIDE"
      subtitle="Three steps to set up your private identity: create a PIN, choose a username, and activate your stealth keys on-chain."
    >
      {/* Overview */}
      <h2 className="text-lg font-mono font-bold text-white mt-10 mb-3">Three Steps to Privacy</h2>
      <p className="text-sm text-[rgba(255,255,255,0.6)] leading-relaxed mb-2">
        When you first connect a wallet, Dust walks you through a three-step onboarding wizard.
        Each step builds on the last to create a fully functional stealth identity:
      </p>
      <ol className="list-decimal list-inside text-sm text-[rgba(255,255,255,0.6)] leading-relaxed space-y-1 mb-6">
        <li><strong className="text-white">Set your PIN</strong> &mdash; derives your cryptographic stealth keys from a wallet signature</li>
        <li><strong className="text-white">Choose a username</strong> &mdash; registers a human-readable name (e.g. <code>alice.dust</code>) mapped to your meta-address</li>
        <li><strong className="text-white">Activate</strong> &mdash; publishes your ERC-6538 meta-address on the stealth registry so others can compute stealth addresses for you</li>
      </ol>

      {/* Step 1 */}
      <h2 className="text-lg font-mono font-bold text-white mt-10 mb-3">Step 1: Set Your PIN</h2>
      <p className="text-sm text-[rgba(255,255,255,0.6)] leading-relaxed mb-4">
        Your 6-digit PIN is the cornerstone of your stealth identity. Together with a deterministic wallet
        signature, it derives all the private keys that control your shielded funds.
      </p>

      <OnboardingPinSnippet />

      <DocsStepList
        steps={[
          {
            title: "Wallet signs a deterministic message",
            children: (
              <p>
                The app requests a signature over a fixed message. This signature is the same every time
                for the same wallet, providing a stable entropy source without storing any secret.
              </p>
            ),
          },
          {
            title: "Signature + PIN enter PBKDF2",
            children: (
              <p>
                The signature and your 6-digit PIN are combined and fed into <code>PBKDF2</code> with
                100,000 iterations and a versioned salt (<code>v2</code>). This produces two independent 32-byte seeds:
                a <strong className="text-white">spending seed</strong> (salt: <code>Dust Spend Authority v2</code>) and
                a <strong className="text-white">viewing seed</strong> (salt: <code>Dust View Authority v2</code>).
              </p>
            ),
          },
          {
            title: "Seeds become BN254 scalar keys",
            children: (
              <p>
                Each seed is hashed with Poseidon and reduced modulo the BN254 scalar field order.
                The spending seed becomes <code>spendingKey = Poseidon(spendingSeed) mod p</code> and
                the viewing seed becomes <code>nullifierKey = Poseidon(viewingSeed) mod p</code>. These
                keys operate within the BN254 curve used by the ZK circuits.
              </p>
            ),
          },
          {
            title: "Keys held in memory only",
            children: (
              <p>
                Derived keys are stored in a React <code>ref</code> &mdash; never in component state
                or <code>localStorage</code>. They exist only for the duration of the browser session
                and are cleared when the tab closes or the wallet disconnects.
              </p>
            ),
          },
        ]}
      />

      {/* Step 2 */}
      <h2 className="text-lg font-mono font-bold text-white mt-10 mb-3">Step 2: Choose a Username</h2>
      <p className="text-sm text-[rgba(255,255,255,0.6)] leading-relaxed mb-2">
        Your username is a human-readable stealth name that maps to your meta-address on-chain.
        Instead of sharing a long hex address, you can tell someone to send funds to <code>alice.dust</code>.
      </p>

      <OnboardingUsernameSnippet />

      <ul className="list-disc list-inside text-sm text-[rgba(255,255,255,0.6)] leading-relaxed space-y-1 mb-2">
        <li>Names must be lowercase alphanumeric (plus <code>-</code> and <code>_</code>)</li>
        <li>The app checks availability in real time with a debounced lookup</li>
        <li>Once registered, the name is permanently associated with your meta-address via a relayer API</li>
      </ul>

      {/* Step 3 */}
      <h2 className="text-lg font-mono font-bold text-white mt-10 mb-3">Step 3: Activate Stealth Keys</h2>
      <p className="text-sm text-[rgba(255,255,255,0.6)] leading-relaxed mb-2">
        Activation publishes your ERC-6538 meta-address &mdash; a pair of public keys (spending + viewing) &mdash;
        on the stealth registry contract. This on-chain registration allows anyone to:
      </p>

      <OnboardingActivateSnippet />

      <ul className="list-disc list-inside text-sm text-[rgba(255,255,255,0.6)] leading-relaxed space-y-1 mb-4">
        <li>Look up your public keys by wallet address or stealth name</li>
        <li>Compute a fresh stealth address using ECDH to send you funds privately</li>
        <li>Announce the payment so only you can detect and claim it</li>
      </ul>
      <p className="text-sm text-[rgba(255,255,255,0.6)] leading-relaxed mb-2">
        The wizard retries ERC-6538 registration up to 3 times with exponential backoff to handle
        transient RPC failures, especially for Privy embedded wallets.
      </p>

      {/* Callouts */}
      <DocsCallout type="warning" title="PIN Is Irrecoverable">
        Your PIN is critical. It derives all your stealth keys. If you forget your PIN, you lose
        access to your shielded funds. There is no recovery mechanism &mdash; you would need to
        create an entirely new identity.
      </DocsCallout>

      <DocsCallout type="info" title="Privy Embedded Wallets">
        Privy embedded wallet users get a deterministic address tied to their social login.
        The same PIN always derives the same keys, even if browser storage is cleared or
        you log in from a different device. The wizard detects returning users automatically
        and shows a streamlined re-activation flow.
      </DocsCallout>

      {/* Badges */}
      <div className="flex flex-wrap gap-2 mt-8">
        <DocsBadge variant="green">PBKDF2</DocsBadge>
        <DocsBadge variant="green">Poseidon</DocsBadge>
        <DocsBadge variant="green">ERC-6538</DocsBadge>
        <DocsBadge variant="green">BN254</DocsBadge>
      </div>
    </DocsPage>
  );
}
