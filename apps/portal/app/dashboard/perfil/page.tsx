import type { Metadata } from "next";
import PerfilClient from "./perfil-client";

export const metadata: Metadata = {
  title: "Perfil",
  description: "Dados pessoais do cliente.",
  robots: "noindex, nofollow",
};

export default function PerfilPage() {
  return <PerfilClient />;
}
