"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff, AlertCircle, Mail, LockKeyhole, MailCheck } from "lucide-react";
import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { useToastHelpers } from "@/components/ui/Toast";
import { resendVerification } from "@/lib/api";
import { authErrorMessage } from "@/lib/auth-errors";
import type { AuthFormResult } from "@/types";

const loginSchema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(1, "Senha é obrigatória"),
  rememberMe: z.boolean().optional(),
});

type LoginFormData = z.infer<typeof loginSchema>;

interface LoginFormProps {
  onSubmit: (data: LoginFormData) => Promise<AuthFormResult>;
  onSwitchToRegister: () => void;
  isLoading?: boolean;
}

export function LoginForm({ onSubmit, onSwitchToRegister, isLoading = false }: LoginFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [apiError, setApiError] = useState<{ code?: string; message: string } | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const { success, error: showError } = useToastHelpers();

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      rememberMe: true,
    },
  });

  const handleFormSubmit = async (data: LoginFormData) => {
    setApiError(null);
    setResendState("idle");
    const result = await onSubmit(data);
    if (!result.ok && !result.mfaRequired) {
      // Mensagem ORIGINAL do backend quando legível; senão o mapa por código
      // (ex. EMAIL_NOT_VERIFIED e ACCOUNT_LOCKED chegam sem texto útil).
      setApiError({
        code: result.code,
        message: authErrorMessage(
          result.code,
          result.message,
          "Não foi possível entrar. Verifique e-mail e senha e tente novamente."
        ),
      });
    }
    return result;
  };

  const handleResend = async () => {
    const email = getValues("email");
    setResendState("sending");
    try {
      await resendVerification(email);
      setResendState("sent");
      success("Link reenviado", `Se existir cadastro pendente para ${email}, o link chega em instantes.`);
    } catch (err: unknown) {
      setResendState("idle");
      showError("Não foi possível reenviar", err instanceof Error ? err.message : "Tente novamente em instantes.");
    }
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4" noValidate>
      <AnimatePresence mode="wait">
        {apiError && (
          <motion.div
            initial={{ opacity: 0, y: -10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -10, height: 0 }}
            className="flex items-center gap-2 p-3 rounded-base bg-danger-soft border border-danger/30 text-danger text-body"
            role="alert"
          >
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{apiError.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Conta existe mas o e-mail ainda não foi confirmado: sem esta ação o
          usuário fica preso em "não consigo entrar" sem saber o que fazer. */}
      {apiError?.code === "EMAIL_NOT_VERIFIED" && (
        <div className="flex flex-col gap-2 rounded-base border border-line2 bg-bg2 p-3">
          <p className="text-caption text-text2">
            Enviamos o link de confirmação para este e-mail. Confirme para liberar o acesso.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            isLoading={resendState === "sending"}
            disabled={resendState === "sending" || resendState === "sent"}
            onClick={handleResend}
            leftIcon={<MailCheck className="h-4 w-4" aria-hidden="true" />}
          >
            {resendState === "sent" ? "Link reenviado" : "Reenviar link de confirmação"}
          </Button>
        </div>
      )}

      <Input
        {...register("email")}
        type="email"
        label="E-mail"
        placeholder="seu@email.com"
        autoComplete="email"
        error={errors.email?.message}
        disabled={isLoading}
        leftIcon={<Mail className="h-4 w-4" />}
      />

      <div className="relative">
        <Input
          {...register("password")}
          type={showPassword ? "text" : "password"}
          label="Senha"
          placeholder="••••••••"
          autoComplete="current-password"
          error={errors.password?.message}
          disabled={isLoading}
          leftIcon={<LockKeyhole className="h-4 w-4" />}
          rightInteractive
          rightElement={
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="min-h-[44px] min-w-[44px] p-2.5 text-text3 hover:text-text1 transition-colors"
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          }
        />
      </div>

      <div className="flex items-center justify-between">
        <label className="flex min-h-[44px] items-center gap-2 cursor-pointer">
          <input
            {...register("rememberMe")}
            type="checkbox"
            className="w-4 h-4 rounded-base border-line2 text-accent focus:ring-accent focus:ring-2"
          />
          <span className="text-body text-text2">Lembrar-me</span>
        </label>
        <a href="/recuperar-senha" className="text-body text-accent hover:underline">
          Esqueci a senha
        </a>
      </div>

      <Button
        type="submit"
        variant="primary"
        fullWidth
        size="lg"
        isLoading={isLoading}
        disabled={isLoading}
      >
        Entrar
      </Button>

      <p className="text-center text-body text-text2">
        Não tem conta?{" "}
        <button
          type="button"
          onClick={onSwitchToRegister}
          className="text-accent font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
        >
          Criar conta
        </button>
      </p>
    </form>
  );
}
