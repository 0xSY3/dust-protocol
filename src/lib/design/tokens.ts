// Design tokens — Light theme with Tokamak Blue accent (PIVY-inspired)

export interface ColorTokens {
  bg: { page: string; card: string; input: string; elevated: string; hover: string };
  border: { default: string; light: string; accent: string; accentGreen: string };
  text: { primary: string; secondary: string; tertiary: string; muted: string };
  accent: { indigo: string; indigoBright: string; indigoDark: string; green: string; greenBright: string; greenDark: string; red: string; redDark: string; amber: string };
  glow: { indigo: string; green: string };
}

export interface RadiusTokens {
  xl: string; lg: string; md: string; sm: string; xs: string; full: string;
}

export const colors: ColorTokens = {
  bg: {
    page: "#F5F6FA",
    card: "#FFFFFF",
    input: "#F0F1F5",
    elevated: "#E8E9EE",
    hover: "#E2E3E9",
  },
  border: {
    default: "#D8DAE2",
    light: "#C8CADB",
    accent: "#2B5AE2",
    accentGreen: "#2B5AE2",
  },
  text: {
    primary: "#1A1D2B",
    secondary: "#3D4258",
    tertiary: "#6B7089",
    muted: "#9498AE",
  },
  accent: {
    indigo: "#2B5AE2",
    indigoBright: "#4A75F0",
    indigoDark: "#1E45BF",
    green: "#2B5AE2",
    greenBright: "#4A75F0",
    greenDark: "#1E45BF",
    red: "#E53E3E",
    redDark: "#C53030",
    amber: "#D97706",
  },
  glow: {
    indigo: "0 0 0 3px rgba(43, 90, 226, 0.15)",
    green: "0 0 0 3px rgba(43, 90, 226, 0.15)",
  },
};

export const radius: RadiusTokens = {
  xl: "24px",
  lg: "20px",
  md: "16px",
  sm: "12px",
  xs: "8px",
  full: "9999px",
};

export const shadows = {
  card: "0 2px 8px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.03)",
  cardHover: "0 6px 20px rgba(0, 0, 0, 0.08), 0 2px 6px rgba(0, 0, 0, 0.04)",
  modal: "0 20px 60px rgba(0, 0, 0, 0.15), 0 6px 20px rgba(0, 0, 0, 0.08)",
  button: "0 1px 2px rgba(0, 0, 0, 0.05)",
};

// Rotating card accent colors for link cards
export const cardAccents = [
  "#2B5AE2", // indigo
  "#7C3AED", // violet
  "#059669", // emerald
  "#E53E3E", // red
  "#D97706", // amber
  "#0891B2", // cyan
  "#DB2777", // pink
  "#4F46E5", // deep indigo
];

// Minimum balance needed to cover gas for a claim transaction
export const MIN_CLAIMABLE_BALANCE = 0.0001;

import { getChainConfig, DEFAULT_CHAIN_ID } from '@/config/chains';

/** Chain-aware explorer URL */
export function getExplorerBase(chainId?: number): string {
  return getChainConfig(chainId ?? DEFAULT_CHAIN_ID).blockExplorerUrl;
}
