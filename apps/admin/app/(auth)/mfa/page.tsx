"use client";

import { useEffect, useRef, useState } from "react";import { useRouter } from "next/navigation";
import { Check, CircleX, Copy, FlaskConical, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/skeleton";

/** Segunda etapa: escaneie o QR (ou digite a chave) e confirme o código de 6 dígitos. */
export default function MfaPage() {
  const router = useRouter();
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [isMock, setIsMock] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const verifying = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/mfa/enroll", { method: "POST" });
        const data = (await res.json().catch(() => ({}))) as {
          secret?: string;
          qrDataUrl?: string;
          mock?: boolean;
          message?: string;
        };
        if (!alive) return;
        if (!res.ok || !data.secret) {
          setLoadError(data.message ?? "Não foi possível preparar o autenticador. Tente de novo.");
          return;
        }
        setSecret(data.secret);
        setQr(data.qrDataUrl ?? null);
        setIsMock(Boolean(data.mock));
      } catch {
        if (alive) setLoadError("Falha de rede ao preparar o autenticador.");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Erro de MFA: shake opt-in + foco volta para a caixa (sem toast).
  useEffect(() => {
    if (error) document.getElementById("mfa-code")?.focus();
  }, [error, shakeKey]);

  const verify = async (value: string) => {
    if (verifying.current) return;
    verifying.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: value }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || data.ok === false) {
        setError(data.message ?? "Código inválido. Confira o app autenticador.");
        setShakeKey((k) => k + 1);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Falha de rede. Tente de novo.");
      setShakeKey((k) => k + 1);
    } finally {
      setBusy(false);
      verifying.current = false;
    }
  };

  const onCodeChange = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    setError(null);
    if (digits.length === 6) void verify(digits);
  };

  const copyKey = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="w-full max-w-[25rem] rounded-card bg-bg1 border border-line1 shadow-1 p-6">
      <div className="flex items-center gap-3 mb-4">
        <div
          aria-hidden="true"
          className="w-11 h-11 rounded-base bg-accent text-accentink flex items-center justify-center text-headline font-extrabold"
        >
          A
        </div>
        <div>
          <p className="m-0 text-headline text-text1 font-semibold">Aurum Bit</p>
          <p className="m-0 text-callout text-text2">Protegendo sua conta</p>
        </div>
      </div>
      <h1 className="text-title-auth text-text1 m-0 mb-3">Ative o autenticador</h1>

      {loadError ? (
        <p className="flex items-center gap-2 text-callout text-danger mt-0 mb-4" role="alert">
          <CircleX size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          {loadError}
        </p>
      ) : (
        <>
          <ol className="text-callout text-text2 mt-0 mb-4 pl-5">
            <li>Escaneie o código com seu app autenticador</li>
            <li>Digite abaixo o código de 6 dígitos</li>
          </ol>
          <div className="flex justify-center mb-4">
            <div className="qr-frame">
              {qr ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={qr}
                  alt="QR code para cadastrar o autenticador"
                  width={200}
                  height={200}
                  className="block rounded-sm"
                />
              ) : (
                <div aria-busy="true" aria-label="Gerando QR code">
                  <Skeleton width={200} height={200} label="Gerando QR code…" />
                </div>
              )}
            </div>
          </div>
          <details className="manual-key mb-4">
            <summary className="text-callout text-text1 font-semibold cursor-pointer min-h-[44px] flex items-center focus-ring rounded-sm">
              Não consegue escanear? Ver a chave manual
            </summary>
            <div className="key-row items-center mt-2 mb-1">
              <Input mono readOnly value={secret ?? "gerando…"} aria-label="Chave manual" />
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={copyKey}
                className="shrink-0"
                title={copied ? "Chave copiada" : "Copiar chave manual"}
              >
                {copied ? (
                  <Check size={16} strokeWidth={1.75} aria-hidden="true" />
                ) : (
                  <Copy size={16} strokeWidth={1.75} aria-hidden="true" />
                )}
                {copied ? "Copiado!" : "Copiar"}
              </Button>
            </div>
          </details>
          {isMock && (
            <div className="mb-4">
              <Badge tone="warn">
                <FlaskConical size={16} strokeWidth={1.75} aria-hidden="true" />
                Modo teste: qualquer código de 6 dígitos é aceito.
              </Badge>
            </div>
          )}
        </>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === 6) void verify(code);
        }}
      >
        <div key={shakeKey} className={error ? "animate-shake" : undefined}>
          <Field
            label="Código de 6 dígitos"
            htmlFor="mfa-code"
            hint="Enviado pelo app autenticador. Pode colar o código."
          >
            <Input
              id="mfa-code"
              mono
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••••"
              required
              value={code}
              onChange={(e) => onCodeChange(e.target.value)}
              className="text-mfa-code text-center tracking-[0.3em]"
            />
          </Field>
        </div>
        {error && (
          <p className="flex items-center gap-2 text-callout text-danger mt-0 mb-4" role="alert">
            <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
            {error}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          disabled={busy || code.length < 6}
          title={busy ? "Verificando…" : code.length < 6 ? "Digite os 6 dígitos" : "Verificar e entrar"}
        >
          {busy ? "Verificando…" : "Verificar e entrar"}
        </Button>
      </form>
    </div>
  );
}
