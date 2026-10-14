import { ProfileEditor } from "@/components/perfil/ProfileEditor";

export const metadata = {
  title: "Meu perfil — Aurum Admin",
  description: "Foto, dados pessoais, endereço e documentos do operador.",
};

export default function PerfilPage() {
  return <ProfileEditor />;
}
