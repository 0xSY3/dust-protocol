import { DocsPage } from "@/components/docs/DocsPage";
import { DocsCallout } from "@/components/docs/DocsCallout";
import { DocsStepList } from "@/components/docs/DocsStepList";
import { DocsBadge } from "@/components/docs/DocsBadge";
import {
  LinksCreateSnippet,
  LinksGeneratedSnippet,
  LinksClaimSnippet,
  LinksListSnippet,
} from "@/components/docs/visuals/PaymentLinksGuidePreview";
import { docsMetadata } from "@/lib/seo/metadata";
import { techArticleJsonLd } from "@/lib/seo/jsonLd";

const articleLd = techArticleJsonLd("Payment Links — Dust Protocol App Guide", "Create shareable payment links that let anyone send you a private stealth payment. Share via URL or QR code.", "/docs/app-guide/payment-links");

export const metadata = docsMetadata("Payment Links — Dust Protocol App Guide", "Create shareable payment links that let anyone send you a private stealth payment. Share via URL or QR code.", "/docs/app-guide/payment-links");

export default function PaymentLinksPage() {
  return (
    <>
    {/* Safe: hardcoded string literals only — see articleLd declaration above */}
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: articleLd }} />
    <DocsPage
      currentHref="/docs/app-guide/payment-links"
      title="Payment Links"
      badge="APP GUIDE"
    >

      {/* What are Payment Links? */}
      <section className="mb-10">
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-3 uppercase">What are Payment Links?</h2>
        <p className="text-sm text-[rgba(255,255,255,0.6)] leading-relaxed mb-4">
          Payment links are shareable URLs that let anyone send you a private stealth payment. When you register a
          <strong className="text-white"> .dust</strong> name, you automatically get a personal payment link at
          <code>/pay/yourname</code>. You can also create custom links with specific names, descriptions, and emoji icons
          for different purposes — like invoicing, tips, or donations.
        </p>
        <p className="text-sm text-[rgba(255,255,255,0.6)] leading-relaxed">
          The receiver doesn&apos;t need to connect a wallet to create a link — only the sender needs a wallet to pay.
          Every payment goes to a fresh one-time stealth address derived via ECDH, so no on-chain link exists between
          the sender and the recipient&apos;s main address.
        </p>
      </section>

      {/* Creating a Link */}
      <section className="mb-10">
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-4 uppercase">Creating a Link</h2>

        <LinksCreateSnippet />

        <DocsStepList steps={[
          {
            title: "Go to /links/create",
            children: <>Navigate to the Links page and click <strong className="text-white">Create Link</strong>.
              Choose the <strong className="text-white">Simple Payment</strong> template (other types like Digital Product
              and Payment Request are coming soon).</>,
          },
          {
            title: "Set a name and optional description",
            children: <>Give your link a descriptive name (e.g., &quot;Coffee Tips&quot;). Pick an emoji and background
              color. Add an optional description to tell payers what the link is for. The amount is open by default —
              senders choose how much to pay.</>,
          },
          {
            title: "Link generated with unique slug",
            children: <>The app generates a unique slug from your link name, mapped to your stealth meta-address.
              Your link URL follows the pattern <code>pay/yourname/slug</code> and resolves to a
              <code> .dust</code> subdomain like <code>slug.yourname.dust</code>.</>,
          },
          {
            title: "Share via QR code or URL",
            children: <>Copy the link URL or open the QR modal to display a scannable code. The QR encodes the full
              payment URL. You can share it anywhere — social media, messaging apps, email, or print it out.</>,
          },
        ]} />

        <LinksGeneratedSnippet />
      </section>

      {/* Paying a Link */}
      <section className="mb-10">
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-4 uppercase">Paying a Link</h2>

        <LinksClaimSnippet />

        <DocsStepList steps={[
          {
            title: "Sender visits the payment link",
            children: <>The sender opens the URL in their browser. The page shows the recipient&apos;s .dust name,
              a shield icon, and two tabs: <strong className="text-white">Send with Wallet</strong> for direct
              payment, or <strong className="text-white">QR / Address</strong> for manual transfer from any wallet.</>,
          },
          {
            title: "Sender sees amount, memo, and recipient",
            children: <>For custom links with a slug, the displayed name is <code>slug.username.dust</code>. For personal
              links, it shows <code>username.dust</code>. The sender enters the amount and reviews the details before
              proceeding.</>,
          },
          {
            title: "Sender connects wallet",
            children: <>If not already connected, the sender clicks <strong className="text-white">Connect Wallet</strong> to
              link their browser wallet (MetaMask, WalletConnect, etc.). The page resolves the recipient&apos;s stealth
              meta-address from the on-chain ERC-6538 registry.</>,
          },
          {
            title: "Payment sent to a one-time stealth address",
            children: <>The sender&apos;s browser derives a fresh stealth address via ECDH using the recipient&apos;s
              meta-address. The ETH is sent directly to this new address. The sender never learns the recipient&apos;s
              actual wallet address.</>,
          },
          {
            title: "Announcement posted via ERC-5564",
            children: <>An announcement event is emitted on-chain so the recipient&apos;s stealth scanner can detect
              the incoming payment. The recipient claims the funds through their normal scanning flow — no extra steps
              needed.</>,
          },
        ]} />
      </section>

      {/* Link Management */}
      <section className="mb-10">
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-3 uppercase">Link Management</h2>

        <LinksListSnippet />

        <p className="text-sm text-[rgba(255,255,255,0.6)] leading-relaxed mb-4">
          View all your created links at <code>/links</code>. Each link card shows the name, emoji, .dust subdomain,
          view count, and payment count. Click a card to see full details, or use the quick actions to copy the link
          URL or open the QR modal.
        </p>
        <p className="text-sm text-[rgba(255,255,255,0.6)] leading-relaxed">
          Your personal link (based on your .dust name) always appears at the top of the list. Custom links are displayed
          below with their individual stats. You can click any custom link to view its detail page at <code>/links/[id]</code>.
        </p>
      </section>

      {/* How It Stays Private */}
      <section className="mb-10">
        <h2 className="text-sm font-mono font-semibold text-white tracking-wider mb-3 uppercase">How It Stays Private</h2>
        <p className="text-sm text-[rgba(255,255,255,0.6)] leading-relaxed mb-4">
          The payment link URL contains no sensitive data — just the recipient&apos;s .dust name and an optional link slug.
          The stealth address is computed entirely client-side by the sender&apos;s browser using ECDH key agreement.
          The recipient claims incoming payments via their normal stealth scanner, which monitors ERC-5564 announcement events.
        </p>
        <p className="text-sm text-[rgba(255,255,255,0.6)] leading-relaxed">
          Because each payment generates a unique stealth address, an observer cannot link multiple payments to the same
          recipient — even if they all came through the same payment link. The link itself is just a convenient entry point;
          the privacy guarantees come from the underlying stealth address protocol.
        </p>
      </section>

      {/* Callouts */}
      <DocsCallout type="tip" title="Invoicing">
        Payment links are perfect for invoicing — create a custom link with a descriptive name and share it with
        the payer. You can track views and payment count from the links dashboard.
      </DocsCallout>

      <DocsCallout type="info" title="No Expiry">
        Links don&apos;t expire by default. You can create multiple links with different names for different
        purposes — tips, freelance invoices, donations, or recurring payments from the same payer.
      </DocsCallout>

      {/* Badges */}
      <div className="mt-6 flex flex-wrap gap-2">
        <DocsBadge variant="green">ECDH</DocsBadge>
        <DocsBadge variant="green">ERC-5564</DocsBadge>
        <DocsBadge variant="amber">QR Code</DocsBadge>
        <DocsBadge variant="muted">Stealth Address</DocsBadge>
      </div>
    </DocsPage>
    </>
  );
}
