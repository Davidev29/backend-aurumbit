"use client";

import { useCallback, useEffect, useState } from "react";
import { Monitor, Copy, Check, Eye, Download, AlertTriangle, KeyRound, Globe } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, Button, Modal, Input } from "@/components/ui";
import { GoldIcon } from "@/components/ui/GoldIcon";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { useToastHelpers } from "@/components/ui/Toast";
import { EmptyState, LicenseStatusPill } from "@/components/dashboard";
import { getMyLicenses, revealLicense } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import type { CustomerLicenseView } from "@/types";

export default function SistemasClient() {
  const [licenses, setLicenses] = useState<CustomerLicenseView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [revealing, setRevealing] = useState<CustomerLicenseView | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [revealedKey, setRevealedKey] = useState<{ key: string; auditId: string } | null>(null);
  const [revealLoading, setRevealLoading] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const { success, error: showError } = useToastHelpers();

  const load = useCallback(() => {
    setError(null);
    setLicenses(null);
    getMyLicenses()
      .then(setLicenses)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load, retryKey]);

  const copyText = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      success("Copiado", "Chave copiada para a área de transferência.");
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
    } catch {
      showError("Falha ao copiar", "Copie manualmente a chave.");
    }
  };

  const openReveal = (l: CustomerLicenseView) => {
    setRevealing(l);
    setReason("");
    setConfirmed(false);
    setRevealedKey(null);
  };

  const closeReveal = () => {
    setRevealing(null);
    setRevealedKey(null);
    setReason("");
    setConfirmed(false);
  };

  const doReveal = async () => {
    if (!revealing) return;
    setRevealLoading(true);
    try {
      const res = await revealLicense(revealing.id, { reason: reason.trim(), confirm: confirmed });
      setRevealedKey(res);
      const isStub = (res as unknown as { stub?: boolean }).stub === true;
      success(
        isStub ? "Chave de demonstração (ambiente local)" : "Chave revelada",
        isStub
          ? `Sem backend conectado — chave sintética. Auditoria ${res.auditId}.`
          : `Auditoria ${res.auditId}. Não compartilhe a chave.`
      );
    } catch (e) {
      showError("Falha ao revelar", e instanceof Error ? e.message : "Tente novamente.");
    } finally {
      setRevealLoading(false);
    }
  };

  const openUrl = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (error) {
    return (
      <div className="glass-card p-8 text-center" role="alert">
        <GoldIcon icon={AlertTriangle} size="lg" variant="soft" className="mx-auto" />
        <h1 className="font-display font-bold text-title-page text-text1 mt-4 mb-2">Erro ao carregar sistemas</h1>
        <p className="text-text2 mb-5">{error}</p>
        <Button variant="primary" onClick={() => setRetryKey((k) => k + 1)}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (!licenses) return <DashboardSkeleton />;

  const reasonValid = reason.trim().length >= 10;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-extrabold text-title-page text-text1">Meus sistemas</h1>
        <p className="text-body text-text2 mt-1">
          Sistemas com acesso liberado — copie licenças, baixe instaladores e gerencie dispositivos.
        </p>
      </div>

      <div className="glass-card p-5" role="note" aria-label="Como ativar seus programas">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <GoldIcon icon={KeyRound} size="md" variant="soft" />
          <div className="min-w-0 flex-1">
            <p className="font-display font-semibold text-text1">Como ativar no instalador</p>
            <p className="mt-0.5 text-body text-text2">
              Recomendado: <strong className="text-text1">entre na sua conta</strong> — a licença
              é encontrada pelo seu e-mail, sem digitar nada. Alternativa: revele a chave abaixo
              e digite no instalador.
            </p>
          </div>
        </div>
      </div>

      {licenses.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Monitor}
              title="Nenhum sistema liberado ainda"
              description="Explore o catálogo e ative sua primeira licença após o pagamento."
              action={
                <Link href="/dashboard/comprar" className="btn btn-primary">
                  Comprar produtos
                </Link>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {licenses.map((l) => {
            const pct =
              l.machinesAllowed > 0
                ? Math.min(100, Math.round((l.machinesUsed / l.machinesAllowed) * 100))
                : 0;
            return (
              <Card key={l.id} hover={false}>
                <CardContent>
                  <div className="flex items-start gap-4">
                    <GoldIcon icon={Monitor} size="md" variant="soft" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="font-display font-semibold text-text1">{l.productName}</h2>
                        <LicenseStatusPill status={l.status} />
                      </div>
                      <p className="text-caption text-text2 mt-0.5">
                        {l.planName} · expira {formatDate(l.expiresAt)}
                      </p>
                      {l.degraded && (
                        <p className="text-caption text-warn mt-1 font-medium">
                          Acesso degradado — quite faturas em aberto.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 p-3 rounded-base bg-bg1 border border-line2">
                    <p className="text-caption text-text3 mb-1">Chave de licença (mascarada)</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 mono font-semibold text-text1 truncate">{l.keyMasked}</code>
                      <button
                        onClick={() => copyText(l.keyMasked, l.id)}
                        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-base text-text3 transition-colors hover:text-accent hover:bg-bg2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        aria-label={`Copiar chave mascarada de ${l.productName}`}
                        aria-live="polite"
                      >
                        {copied === l.id ? (
                          <Check className="w-4 h-4 text-ok" aria-hidden="true" />
                        ) : (
                          <Copy className="w-4 h-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    <div className="mt-2.5">
                      <div className="flex items-center justify-between text-caption text-text3 mb-1">
                        <span>
                          {l.machinesUsed}/{l.machinesAllowed} máquinas em uso · origem {l.origin}
                        </span>
                        <span className="mono">{pct}%</span>
                      </div>
                      <div
                        role="progressbar"
                        aria-valuenow={l.machinesUsed}
                        aria-valuemin={0}
                        aria-valuemax={l.machinesAllowed}
                        aria-label={`Uso de máquinas de ${l.productName}`}
                        className="h-1.5 rounded-full bg-bg2 overflow-hidden"
                      >
                        <div
                          className="h-full rounded-full bg-gradient-gold transition-[width] duration-300 ease-out"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      leftIcon={<KeyRound className="w-4 h-4" aria-hidden="true" />}
                      onClick={() => openReveal(l)}
                      aria-label={`Revelar chave de ${l.productName} (auditado)`}
                    >
                      Revelar chave
                    </Button>
                    {l.downloadUrls?.windows && (
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Download className="w-4 h-4" aria-hidden="true" />}
                        onClick={() => l.downloadUrls?.windows && openUrl(l.downloadUrls.windows)}
                      >
                        Windows
                      </Button>
                    )}
                    {l.downloadUrls?.macos && (
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Download className="w-4 h-4" aria-hidden="true" />}
                        onClick={() => l.downloadUrls?.macos && openUrl(l.downloadUrls.macos)}
                      >
                        macOS
                      </Button>
                    )}
                    {l.downloadUrls?.linux && (
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Download className="w-4 h-4" aria-hidden="true" />}
                        onClick={() => l.downloadUrls?.linux && openUrl(l.downloadUrls.linux)}
                      >
                        Linux
                      </Button>
                    )}
                    {l.downloadUrls?.web && (
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Eye className="w-4 h-4" aria-hidden="true" />}
                        onClick={() => l.downloadUrls?.web && openUrl(l.downloadUrls.web)}
                      >
                        Abrir Web
                      </Button>
                    )}
                    {!l.downloadUrls?.windows && !l.downloadUrls?.macos && !l.downloadUrls?.web && !l.downloadUrls?.linux && (
                      <span className="inline-flex items-center gap-1.5 text-caption text-text3 px-1 py-1.5">
                        <Globe className="w-4 h-4" aria-hidden="true" />
                        Downloads em breve
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={!!revealing}
        onClose={closeReveal}
        title="Revelar chave (auditado)"
        description="A revelação gera trilha de auditoria com motivo. A chave em texto puro aparece uma única vez."
        size="md"
      >
        {!revealedKey ? (
          <div className="space-y-4 pt-4">
            <Input
              label="Motivo (mín. 10 caracteres)"
              placeholder="Ex.: reinstalação após troca de máquina"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              hint={`${reason.trim().length}/10 caracteres mínimos`}
            />
            <label className="flex items-start gap-2.5 text-body text-text2 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="w-4 h-4 mt-1 accent-[#C0A060]"
              />
              <span>
                Confirmo que preciso da chave em texto puro e entendo que a ação será auditada.
              </span>
            </label>
            <Button
              variant="primary"
              fullWidth
              isLoading={revealLoading}
              disabled={!reasonValid || !confirmed || revealLoading}
              onClick={doReveal}
            >
              Revelar agora
            </Button>
          </div>
        ) : (
          <div className="space-y-4 pt-4">
            <div className="p-4 rounded-base bg-ok-soft border border-ok/30 text-center" role="status">
              <p className="text-caption text-text2 mb-1">Chave revelada (copie agora — não será exibida de novo)</p>
              <code className="mono font-bold text-text1 text-headline break-all">{revealedKey.key}</code>
              <p className="text-caption text-text3 mt-2 mono">auditoria {revealedKey.auditId}</p>
            </div>
            <Button
              variant="primary"
              fullWidth
              leftIcon={<Copy className="w-4 h-4" aria-hidden="true" />}
              onClick={() => copyText(revealedKey.key, `revealed-${revealing?.id}`)}
            >
              {copied === `revealed-${revealing?.id}` ? "Copiado!" : "Copiar chave"}
            </Button>
            <Button variant="ghost" fullWidth onClick={closeReveal}>
              Fechar
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
