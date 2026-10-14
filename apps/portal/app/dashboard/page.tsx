import type { Metadata } from "next";
import DashboardHome from "./dashboard-client";

export const metadata: Metadata = {
  title: "Painel do cliente",
  description: "Gerencie seus produtos, licenças, faturas e perfil.",
  robots: "noindex, nofollow",
};

export default function DashboardPage() {
  return <DashboardHome />;
}
