"use client";

import { AuthProvider } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { PrivateReadsAlert } from "@/components/anon-rpc/PrivateReadsAlert";

export function AuthLayoutWrapper({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AppLayout>{children}</AppLayout>
      <PrivateReadsAlert />
    </AuthProvider>
  );
}
