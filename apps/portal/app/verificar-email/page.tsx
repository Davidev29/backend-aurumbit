import type { Metadata } from "next";
import { VerifyEmailClient } from "./verify-email-client";

export const metadata: Metadata = {
  title: "Confirmar e-mail",
  description: "Confirme o e-mail da sua conta AurumBit.",
  robots: "noindex, nofollow",
};

/** Página pública que consome o link de confirmação enviado no cadastro. */
export default function VerifyEmailPage() {
  return <VerifyEmailClient />;
}
