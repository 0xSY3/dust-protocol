import type { Metadata } from "next";
import { Instrument_Serif } from "next/font/google";
import Script from "next/script";
import { Providers } from "./providers";
import { AuthLayoutWrapper } from "./auth-layout-wrapper";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Dust Protocol - Private Payments",
  description: "Stealth payment infrastructure for Tokamak Network - payments that dissolve into the blockchain",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" style={{ colorScheme: "dark" }} suppressHydrationWarning>
      <head>
      </head>
      <body className={instrumentSerif.variable}> {/* [NEW] Apply font variable */}
        <Providers>
          <AuthLayoutWrapper>{children}</AuthLayoutWrapper>
        </Providers>
      </body>
    </html>
  );
}
