import type { Metadata } from "next";
import FaturasClient from "./faturas-client";

export const metadata: Metadata = {
  title: "Faturas",
  description: "Histórico de cobranças e comprovantes.",
  robots: "noindex, nofollow",
};

export default function FaturasPage() {
  return <FaturasClient />;
}
