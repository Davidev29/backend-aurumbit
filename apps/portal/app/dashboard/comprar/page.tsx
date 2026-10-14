import type { Metadata } from "next";
import ComprarClient from "./comprar-client";

export const metadata: Metadata = {
  title: "Comprar produtos",
  description: "Catálogo e aquisição de produtos.",
  robots: "noindex, nofollow",
};

export default function ComprarPage() {
  return <ComprarClient />;
}
