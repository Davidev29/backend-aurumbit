import type { Metadata } from "next";
import AtendimentoClient from "./atendimento-client";

export const metadata: Metadata = {
  title: "Atendimento",
  description: "Fale com o atendimento AurumBit em tempo real.",
  robots: "noindex, nofollow",
};

export default function AtendimentoPage() {
  return <AtendimentoClient />;
}
