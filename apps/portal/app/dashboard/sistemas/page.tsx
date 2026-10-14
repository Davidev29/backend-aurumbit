import type { Metadata } from "next";
import SistemasClient from "./sistemas-client";

export const metadata: Metadata = {
  title: "Meus sistemas",
  description: "Sistemas com acesso liberado, licenças e downloads.",
  robots: "noindex, nofollow",
};

export default function SistemasPage() {
  return <SistemasClient />;
}
