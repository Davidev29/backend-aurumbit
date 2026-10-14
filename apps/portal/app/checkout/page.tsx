import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { PortalProvider } from "@/lib/portal-context";
import { Navbar, Footer } from "@/components/layout";
import { AuthModalWrapper } from "@/components/auth/AuthModalWrapper";
import { SectionSkeleton } from "@/components/ui";
import { CheckoutClient } from "./checkout-client";

export const metadata: Metadata = {
  title: "Finalizar compra",
  description: "Revise seu plano, informe seus dados e confirme o pagamento com Pix, boleto ou cartão.",
  robots: "noindex, nofollow",
};

export default function CheckoutPage({
  searchParams,
}: {
  searchParams: { code?: string; plan?: string };
}) {
  return (
    <PortalProvider>
      <div className="min-h-screen bg-bg0">
        <Navbar />
        <main id="main-content" className="container-portal pb-24 pt-28 lg:pt-32">
          <nav aria-label="Voltar" className="mb-6">
            <Link
              href="/#produtos"
              className="text-body font-medium text-text2 transition-colors hover:text-accent"
            >
              ← Voltar aos programas
            </Link>
          </nav>
          <Suspense fallback={<SectionSkeleton count={3} />}>
            <CheckoutClient code={searchParams.code ?? null} planId={searchParams.plan ?? null} />
          </Suspense>
        </main>
        <Footer />
        <AuthModalWrapper />
      </div>
    </PortalProvider>
  );
}
