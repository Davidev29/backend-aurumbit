"use client";

import { AuthProvider } from "@/lib/auth/permissions";
import { Header } from "./Header";
import { MobileDrawer } from "./MobileDrawer";
import { Sidebar } from "./Sidebar";

/** Shell autenticada: sidebar + header + conteúdo (skip-link já no root layout). */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <div className="flex min-h-screen bg-bg0 text-text1">
        <Sidebar />
        <MobileDrawer />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header />
          <main id="conteudo" role="main" tabIndex={-1} className="mx-auto w-full max-w-6xl p-6 max-lg:p-4">
            {children}
          </main>
        </div>
      </div>
    </AuthProvider>
  );
}
