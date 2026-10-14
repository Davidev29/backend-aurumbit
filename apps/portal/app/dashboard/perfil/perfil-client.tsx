"use client";

import { useEffect, useState } from "react";
import { User, Save, AlertTriangle, KeyRound, LogOut } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, Button, Input } from "@/components/ui";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { useToastHelpers } from "@/components/ui/Toast";
import { getMyProfile, updateMyProfile } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import type { CustomerProfileData } from "@/types";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function PerfilClient() {
  const [profile, setProfile] = useState<CustomerProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [form, setForm] = useState({ displayName: "", phone: "", cellphone: "", bio: "" });
  const { success, error: showError, info } = useToastHelpers();

  useEffect(() => {
    setError(null);
    setProfile(null);
    getMyProfile()
      .then((p) => {
        setProfile(p);
        setForm({
          displayName: p.displayName ?? "",
          phone: p.phone ?? "",
          cellphone: p.cellphone ?? "",
          bio: p.bio ?? "",
        });
      })
      .catch((e: Error) => setError(e.message));
  }, [retryKey]);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await updateMyProfile(form);
      setProfile(updated);
      success("Perfil atualizado", "Seus dados foram salvos.");
    } catch (e) {
      showError("Falha ao salvar", e instanceof Error ? e.message : "Tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return (
      <div className="glass-card p-8 text-center" role="alert">
        <div className="w-14 h-14 mx-auto rounded-card bg-danger-soft border border-danger/30 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-danger" aria-hidden="true" />
        </div>
        <h1 className="font-display font-bold text-title-page text-text1 mt-4 mb-2">Erro ao carregar perfil</h1>
        <p className="text-text2 mb-5">{error}</p>
        <Button variant="primary" onClick={() => setRetryKey((k) => k + 1)}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (!profile) return <DashboardSkeleton />;

  const displayName = profile.displayName || profile.name;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-extrabold text-title-page text-text1">Perfil</h1>
        <p className="text-body text-text2 mt-1">Visualize e atualize seus dados pessoais.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card hover={false}>
          <CardContent>
            <div className="text-center">
              <div
                className="w-20 h-20 mx-auto rounded-full bg-gradient-gold flex items-center justify-center shadow-glow-sm"
                role="img"
                aria-label={`Avatar de ${displayName}`}
              >
                {profile.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.avatarUrl}
                    alt={`Avatar de ${displayName}`}
                    className="w-20 h-20 rounded-full object-cover"
                  />
                ) : (
                  <span className="font-display font-extrabold text-title-page text-on-gold" aria-hidden="true">
                    {initialsOf(displayName)}
                  </span>
                )}
              </div>
              <h2 className="font-display font-semibold text-text1 mt-3">{displayName}</h2>
              <p className="text-body text-text2 mono truncate">{profile.email}</p>
              <p className="text-caption text-text3 mt-1">Cliente desde {formatDate(profile.createdAt)}</p>
            </div>
            <div className="mt-4 pt-4 border-t border-line2 space-y-2 text-body">
              <div className="flex justify-between gap-3">
                <span className="text-text2">Nome</span>
                <span className="text-text1 font-medium text-right truncate">{profile.name}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-text2">Documento</span>
                <span className="text-text1 mono">{profile.documents?.[0]?.numberMasked ?? "—"}</span>
              </div>
              {profile.address && (
                <div className="flex justify-between gap-3">
                  <span className="text-text2">Cidade</span>
                  <span className="text-text1 text-right">
                    {profile.address.city}/{profile.address.state}
                  </span>
                </div>
              )}
              {(profile.phone || profile.cellphone) && (
                <div className="flex justify-between gap-3">
                  <span className="text-text2">Contato</span>
                  <span className="text-text1 text-right">{profile.cellphone ?? profile.phone}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-6">
          <Card hover={false}>
            <CardHeader>
              <CardTitle subtitle="Dados exibidos no painel e comunicações">Dados pessoais</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Nome de exibição"
                  value={form.displayName}
                  onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                  placeholder="Como devemos te chamar?"
                  autoComplete="nickname"
                />
                <Input
                  label="Telefone"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="(11) 3000-0000"
                  autoComplete="tel"
                  inputMode="tel"
                />
                <Input
                  label="Celular"
                  value={form.cellphone}
                  onChange={(e) => setForm((f) => ({ ...f, cellphone: e.target.value }))}
                  placeholder="(11) 99999-0000"
                  autoComplete="tel"
                  inputMode="tel"
                />
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="bio">
                    Bio
                  </label>
                  <textarea
                    id="bio"
                    className="input min-h-[96px] resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    value={form.bio}
                    onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
                    placeholder="Conte um pouco sobre você"
                    maxLength={500}
                    aria-describedby="bio-count"
                  />
                  <p id="bio-count" className="text-caption text-text3 mt-1 text-right">
                    {form.bio.length}/500
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <Button
                  variant="primary"
                  leftIcon={<Save className="w-4 h-4" aria-hidden="true" />}
                  isLoading={saving}
                  disabled={saving}
                  onClick={save}
                >
                  Salvar alterações
                </Button>
                <p className="text-caption text-text3">Alterações refletem no painel e nas comunicações.</p>
              </div>
            </CardContent>
          </Card>

          <Card hover={false}>
            <CardHeader>
              <CardTitle subtitle="Troca de senha e sessões ativas">Segurança</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col sm:flex-row gap-3" aria-label="Ações de segurança">
                <li>
                  <Button
                    variant="outline"
                    leftIcon={<KeyRound className="w-4 h-4" aria-hidden="true" />}
                    onClick={() =>
                      info("Trocar senha", "Enviamos um link de redefinição para o seu e-mail.")
                    }
                  >
                    Trocar senha
                  </Button>
                </li>
                <li>
                  <Button
                    variant="ghost"
                    leftIcon={<LogOut className="w-4 h-4" aria-hidden="true" />}
                    onClick={() =>
                      success("Sessões encerradas", "Outros dispositivos foram desconectados.")
                    }
                  >
                    Encerrar outras sessões
                  </Button>
                </li>
              </ul>
              <p className="text-caption text-text3 mt-3 flex items-start gap-2">
                <User className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                Sessões usam JWT de 15 min + refresh rotativo em cookie httpOnly. Documentos aparecem
                apenas mascarados (LGPD).
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
