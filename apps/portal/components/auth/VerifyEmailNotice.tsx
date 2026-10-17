"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui";
import { useToastHelpers } from "@/components/ui/Toast";
import { resendVerification } from "@/lib/api";

interface VerifyEmailNoticeProps {
  /** E-mail que recebeu o link de confirmação. */
  email: string;
  /** Volta para a aba de login (o cadastro já foi criado). */
  onSwitchToLogin: () => void;
}

/**
 * Aviso pós-cadastro: a conta existe, mas o login só libera depois de
 * confirmar o e-mail (o backend responde 403 `EMAIL_NOT_VERIFIED` antes disso).
 * O reenvio é genérico no backend — nunca revela se o e-mail existe.
 */
export function VerifyEmailNotice({ email, onSwitchToLogin }: VerifyEmailNoticeProps) {
  const [isSending, setIsSending] = useState(false);
  const [sentOnce, setSentOnce] = useState(false);
  const { success, error: showError } = useToastHelpers();

  const resend = async () => {
    setIsSending(true);
    try {
      await resendVerification(email);
      setSentOnce(true);
      success(
        "Link reenviado",
        `Se existir cadastro pendente para ${email}, o link chega em instantes.`
      );
    } catch (err: unknown) {
      showError(
        "Não foi possível reenviar",
        err instanceof Error ? err.message : "Tente novamente em instantes."
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="text-center"
      role="status"
      aria-live="polite"
    >
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
        <MailCheck className="h-6 w-6" aria-hidden="true" />
      </span>
      <h3 className="mt-4 font-display text-headline font-bold text-text1">
        Confirme seu e-mail
      </h3>
      <p className="mt-2 text-body text-text2">
        Sua conta foi criada. Enviamos um link de confirmação para{" "}
        <strong className="font-semibold text-text1">{email}</strong>.
      </p>
      <p className="mt-2 text-caption text-text3">
        O link vale por 24 horas e só libera o acesso depois de confirmado. Não
        achou? Confira o spam ou reenvie abaixo.
      </p>

      <div className="mt-5 space-y-3">
        <Button
          type="button"
          variant="primary"
          fullWidth
          size="lg"
          isLoading={isSending}
          disabled={isSending}
          onClick={resend}
        >
          {sentOnce ? "Reenviar de novo" : "Reenviar link"}
        </Button>
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="w-full rounded-sm text-body font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Já confirmei — entrar
        </button>
      </div>
    </motion.div>
  );
}
