import type { Metadata } from "next";
import { Providers } from "./providers";
import { AuthLayoutWrapper } from "./auth-layout-wrapper";
import "./globals.css";

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
    <html lang="en">
      <body>
        <Providers>
          <AuthLayoutWrapper>{children}</AuthLayoutWrapper>
        </Providers>
      </body>
    </html>
  );
}
