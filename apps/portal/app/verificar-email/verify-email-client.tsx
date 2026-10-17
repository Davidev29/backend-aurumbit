"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, MailCheck, Mail } from "lucide-react";
import { Button, Input, Logo } from "@/components/ui";
import { resendVerification, verifyEmail } from "@/lib/api";
import { authErrorMessage } from "@/lib/auth-errors";

type Status = "verifying" | "ok" | "error";

/**
 * Consome o link `/verificar-email?token=...` do e-mail de confirmação.
 * O token é opaco, de uso único e TTL 24h (emitido no cadastro). Erros vêm
 * com código do backend (`INVALID_TOKEN` quando expirado/já usado) e o
 * reenvio usa o e-mail informado aqui — genérico por design (anti-enumeração).
 */
function VerifyEmailContent() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [status, setStatus] = useState<Status>(token ? "verifying" : "error");
  const [errorCode, setErrorCode] = useState<string | undefined>(
    token ? undefined : "INVALID_TOKEN"
  );
  const [errorMessage, setErrorMessage] = useState<string | undefined>(
    token ? undefined : "O link está incompleto (sem o código de confirmação)."
  );
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const started = useRef(false);

  const confirm = useCallback(async (value: string) => {
    setStatus("verifying");
    setErrorCode(undefined);
    setErrorMessage(undefined);
    try {
      await verifyEmail(value);
      setStatus("ok");
    } catch (err: unknown) {
      const code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : undefined;
      setErrorCode(code);
      setErrorMessage(err instanceof Error ? err.message : undefined);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true; // StrictMode dev não confirma duas vezes
    confirm(token);
  }, [token, confirm]);

  const handleResend = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError("Informe o e-mail usado no cadastro.");
      return;
    }
    setEmailError(undefined);
    setResendState("sending");
    try {
      await resendVerification(email);
      setResendState("sent");
    } catch {
      setResendState("idle");
    }
  };

  return (
    <main id="main-content" className="flex min-h-screen flex-col items-center justify-center bg-bg0 px-4 py-12">
      <Link href="/" aria-label="AurumBit - Início" className="mb-8 rounded-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <Logo size="md" />
      </Link>

      <div className="glass-card w-full max-w-md rounded-card p-6 sm:p-8">
        {status === "verifying" && (
          <div className="flex flex-col items-center text-center" role="status" aria-live="polite">
            <Loader2 className="h-8 w-8 animate-spin text-accent" aria-hidden="true" />
            <h1 className="mt-4 font-display text-headline font-bold text-text1">Confirmando seu e-mail…</h1>
            <p className="mt-2 text-body text-text2">Só um instante.</p>
          </div>
        )}

        {status === "ok" && (
          <div className="flex flex-col items-center text-center" role="status" aria-live="polite">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ok-soft text-ok">
              <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
            </span>
            <h1 className="mt-4 font-display text-headline font-bold text-text1">E-mail confirmado</h1>
            <p className="mt-2 text-body text-text2">
              Sua conta está liberada. Agora é só entrar para acessar o painel.
            </p>
            <Button className="mt-6" fullWidth size="lg" variant="primary" onClick={() => { window.location.href = "/?login=1"; }}>
              Entrar na minha conta
            </Button>
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col">
            <div className="flex flex-col items-center text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-warn-soft text-warn">
                <AlertCircle className="h-6 w-6" aria-hidden="true" />
              </span>
              <h1 className="mt-4 font-display text-headline font-bold text-text1">
                Não foi possível confirmar
              </h1>
              <p className="mt-2 text-body text-text2" role="alert">
                {authErrorMessage(
                  errorCode,
                  errorMessage,
                  "Link inválido ou expirado. Peça um novo abaixo."
                )}
              </p>
            </div>

            <div className="mt-6 space-y-3 border-t border-line2 pt-6">
              <p className="text-caption text-text2">
                Informe o e-mail do cadastro para receber um link novo:
              </p>
              <Input
                type="email"
                label="E-mail"
                placeholder="seu@email.com"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={emailError}
                leftIcon={<Mail className="h-4 w-4" />}
                disabled={resendState === "sending" || resendState === "sent"}
              />
              {resendState === "sent" ? (
                <div className="flex items-center gap-2 rounded-base border border-ok/30 bg-ok-soft p-3 text-body text-ok" role="status">
                  <MailCheck className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
                  <span>
                    Se existir cadastro pendente para este e-mail, o link chega em instantes.
                  </span>
                </div>
              ) : (
                <Button
                  variant="primary"
                  fullWidth
                  size="lg"
                  isLoading={resendState === "sending"}
                  disabled={resendState === "sending"}
                  onClick={handleResend}
                >
                  Reenviar link de confirmação
                </Button>
              )}
              <Link
                href="/?login=1"
                className="block w-full rounded-sm text-center text-body font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Voltar para o login
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export function VerifyEmailClient() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-bg0">
          <Loader2 className="h-8 w-8 animate-spin text-accent" aria-hidden="true" />
        </main>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
