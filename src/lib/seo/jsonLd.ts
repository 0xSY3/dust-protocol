import { SITE_URL, SITE_NAME, TWITTER_HANDLE } from "./metadata";

function safeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function organizationJsonLd() {
  return safeJsonLd({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/icon.svg`,
    description:
      "Privacy protocol for Ethereum using stealth addresses (ERC-5564), ZK privacy pools, and private swaps. Non-custodial, open-source.",
    foundingDate: "2024",
    sameAs: [
      `https://x.com/${TWITTER_HANDLE.replace("@", "")}`,
      "https://github.com/dust-protocol",
    ],
    knowsAbout: [
      "stealth addresses",
      "zero-knowledge proofs",
      "Ethereum privacy",
      "ERC-5564",
      "ERC-6538",
      "ZK-UTXO",
      "private DeFi",
      "account abstraction",
      "EIP-7702",
    ],
  });
}

export function webApplicationJsonLd() {
  return safeJsonLd({
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SITE_NAME,
    url: SITE_URL,
    applicationCategory: "FinanceApplication",
    applicationSubCategory: "Cryptocurrency Privacy Tool",
    operatingSystem: "Web Browser",
    browserRequirements: "Requires JavaScript, WebAssembly support",
    description:
      "Send and receive crypto privately using stealth addresses and zero-knowledge proofs on Ethereum and EVM-compatible chains.",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    featureList: [
      "Stealth address generation (ERC-5564/ERC-6538)",
      "ZK-UTXO privacy pool with FFLONK proofs",
      "Private token swaps via Uniswap V4 hooks",
      "Gasless claims via ERC-4337 paymaster",
      "PIN-based stealth key derivation (PBKDF2)",
      "Payment links with .dust usernames",
      "Multi-chain support (Ethereum Sepolia, Thanos Sepolia)",
      "In-browser ZK proof generation (1-2 seconds)",
      "EIP-7702 EOA-as-smart-account support",
    ],
    screenshot: `${SITE_URL}/opengraph-image`,
    softwareVersion: "2.0",
    releaseNotes: "Dust V2: ZK-UTXO model with FFLONK proofs and hidden amounts",
  });
}

export function webSiteJsonLd() {
  return safeJsonLd({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    description:
      "Dust Protocol — private transfers, privacy pools, and anonymous swaps on Ethereum.",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}/pay/{search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  });
}

export interface FaqItem {
  question: string;
  answer: string;
}

export function faqPageJsonLd(faqs: FaqItem[]) {
  return safeJsonLd({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  });
}

export interface BreadcrumbItem {
  name: string;
  href: string;
}

export function breadcrumbJsonLd(items: BreadcrumbItem[]) {
  return safeJsonLd({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${SITE_URL}${item.href}`,
    })),
  });
}

export interface HowToStep {
  name: string;
  text: string;
}

export function howToJsonLd(
  name: string,
  description: string,
  steps: HowToStep[],
) {
  return safeJsonLd({
    "@context": "https://schema.org",
    "@type": "HowTo",
    name,
    description,
    totalTime: "PT5M",
    tool: [
      { "@type": "HowToTool", name: "EVM wallet (MetaMask, WalletConnect, or Privy)" },
      { "@type": "HowToTool", name: "Web browser with WebAssembly support" },
    ],
    step: steps.map((step, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: step.name,
      text: step.text,
    })),
  });
}

export function techArticleJsonLd(
  title: string,
  description: string,
  path: string,
) {
  return safeJsonLd({
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: title,
    description,
    url: `${SITE_URL}${path}`,
    author: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
    publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL, logo: { "@type": "ImageObject", url: `${SITE_URL}/icon.svg` } },
    datePublished: "2025-01-15",
    dateModified: "2026-02-22",
    inLanguage: "en",
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: SITE_URL },
    about: { "@type": "Thing", name: "Ethereum Privacy", description: "Privacy tools for Ethereum blockchain" },
    proficiencyLevel: "Expert",
  });
}

export function softwareSourceCodeJsonLd() {
  return safeJsonLd({
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    name: "Dust Protocol Smart Contracts",
    description: "Solidity smart contracts for stealth addresses (ERC-5564/ERC-6538), ZK privacy pools, and private swaps via Uniswap V4 hooks.",
    codeRepository: "https://github.com/dust-protocol",
    programmingLanguage: [
      { "@type": "ComputerLanguage", name: "Solidity" },
      { "@type": "ComputerLanguage", name: "Circom" },
      { "@type": "ComputerLanguage", name: "TypeScript" },
    ],
    runtimePlatform: "Ethereum Virtual Machine (EVM)",
    license: "https://opensource.org/licenses/MIT",
    author: { "@type": "Organization", name: SITE_NAME },
  });
}

export function definedTermSetJsonLd() {
  return safeJsonLd({
    "@context": "https://schema.org",
    "@type": "DefinedTermSet",
    name: "Dust Protocol Glossary",
    description: "Key terms and concepts used in the Dust Protocol privacy ecosystem",
    hasDefinedTerm: [
      {
        "@type": "DefinedTerm",
        name: "Stealth Address",
        description:
          "A one-time address generated via ECDH key exchange (ERC-5564) that only the intended recipient can detect and spend from, ensuring transaction privacy on Ethereum.",
      },
      {
        "@type": "DefinedTerm",
        name: "DustPool",
        description:
          "A ZK privacy pool using Poseidon Merkle trees and zero-knowledge proofs that breaks the on-chain link between depositors and withdrawers.",
      },
      {
        "@type": "DefinedTerm",
        name: "Nullifier",
        description:
          "A unique cryptographic value derived from a secret key and commitment that prevents double-spending in the ZK-UTXO model without revealing which commitment was spent.",
      },
      {
        "@type": "DefinedTerm",
        name: "ZK-UTXO",
        description:
          "A privacy model combining zero-knowledge proofs with the Unspent Transaction Output paradigm, enabling hidden amounts and unlinkable transfers.",
      },
      {
        "@type": "DefinedTerm",
        name: "Stealth Meta-Address",
        description:
          "A public key pair (spending + viewing) registered on-chain via ERC-6538 that allows anyone to derive fresh stealth addresses for the owner without interaction.",
      },
      {
        "@type": "DefinedTerm",
        name: "FFLONK",
        description:
          "A zero-knowledge proof system used in Dust V2 that is 22% cheaper to verify on-chain than Groth16 with 8 public signals and needs no per-circuit trusted setup ceremony.",
      },
      {
        "@type": "DefinedTerm",
        name: "Privacy Swap",
        description:
          "A token swap executed through a Uniswap V4 hook that validates a ZK proof atomically, preventing on-chain fingerprinting of the swap origin.",
      },
      {
        "@type": "DefinedTerm",
        name: "Poseidon Hash",
        description:
          "A ZK-friendly cryptographic hash function optimized for use inside zero-knowledge circuits, requiring only ~5 constraints per hash compared to ~25,000 for SHA-256.",
      },
      {
        "@type": "DefinedTerm",
        name: "Account Abstraction (ERC-4337)",
        description:
          "An Ethereum standard that enables smart contract wallets with UserOperations, allowing gasless stealth claims via sponsored paymasters without exposing private keys.",
      },
    ],
  });
}
