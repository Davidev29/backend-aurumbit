"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff, AlertCircle, Check, CheckCircle, User, Mail, LockKeyhole, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import { authErrorMessage } from "@/lib/auth-errors";
import type { AuthFormResult } from "@/types";

const registerSchema = z
  .object({
    name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
    email: z.string().email("E-mail inválido"),
    password: z
      .string()
      .min(8, "Senha deve ter pelo menos 8 caracteres")
      .regex(/[A-Z]/, "Deve conter pelo menos uma letra maiúscula")
      .regex(/[a-z]/, "Deve conter pelo menos uma letra minúscula")
      .regex(/[0-9]/, "Deve conter pelo menos um número"),
    confirmPassword: z.string().min(1, "Confirme a senha"),
    acceptTerms: z.boolean().refine((v) => v === true, {
      message: "Você deve aceitar os termos de uso",
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem",
    path: ["confirmPassword"],
  });

type RegisterFormData = z.infer<typeof registerSchema>;

interface RegisterFormProps {
  onSubmit: (data: RegisterFormData) => Promise<AuthFormResult>;
  onSwitchToLogin: () => void;
  isLoading?: boolean;
}

function calculatePasswordStrength(password: string): { score: number; label: string; color: string } {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 2) return { score, label: "Muito fraca", color: "danger" };
  if (score <= 3) return { score, label: "Fraca", color: "warn" };
  if (score <= 4) return { score, label: "Boa", color: "info" };
  if (score <= 5) return { score, label: "Forte", color: "ok" };
  return { score, label: "Muito forte", color: "ok" };
}

export function RegisterForm({ onSubmit, onSwitchToLogin, isLoading = false }: RegisterFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    trigger,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      acceptTerms: false,
    },
  });

  const password = watch("password") || "";
  const strength = calculatePasswordStrength(password);
  const [step, setStep] = useState<1 | 2>(1);

  const nextStep = async () => {
    const valid = await trigger(["name", "email"]);
    if (valid) {
      setApiError(null);
      setStep(2);
    }
  };

  const handleFormSubmit = async (data: RegisterFormData) => {
    setApiError(null);
    try {
      const result = await onSubmit(data);
      // Cadastro criado aguardando confirmação de e-mail NÃO é erro: o modal
      // troca para o aviso "confirme seu e-mail".
      if (!result.ok && !result.mfaRequired) {
        setApiError(
          authErrorMessage(
            result.code,
            result.message,
            "Não foi possível criar a conta. Confira os dados e tente novamente."
          )
        );
      }
      return result;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Erro inesperado. Tente novamente.";
      setApiError(message);
      return { ok: false, message };
    }
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4" noValidate>
      {/* Indicador de etapas */}
      <ol className="flex items-center gap-2" aria-label="Etapas do cadastro">
        {(
          [
            { n: 1, label: "Você" },
            { n: 2, label: "Senha e termos" },
          ] as const
        ).map((s) => {
          const current = step === s.n;
          const done = step > s.n;
          return (
            <li key={s.n} className="flex flex-1 items-center gap-2" aria-current={current ? "step" : undefined}>
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-micro font-bold",
                  done || current ? "bg-gradient-gold text-on-gold" : "bg-bg2 text-text3"
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : s.n}
              </span>
              <span className={cn("text-caption font-medium", current || done ? "text-text1" : "text-text3")}>
                {s.label}
              </span>
              {s.n === 1 && <span aria-hidden="true" className="h-px flex-1 bg-line2" />}
            </li>
          );
        })}
      </ol>

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
            <span>{apiError}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {step === 1 && (
        <div className="space-y-4">
          <Input
            {...register("name")}
            type="text"
            label="Nome completo"
            placeholder="João da Silva"
            autoComplete="name"
            error={errors.name?.message}
            disabled={isLoading}
            leftIcon={<User className="h-4 w-4" />}
          />

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
          <p className="text-caption text-text2">
            É neste e-mail que chegam a chave do programa e o passo a passo.
          </p>

          <Button
            type="button"
            variant="primary"
            fullWidth
            size="lg"
            disabled={isLoading}
            onClick={nextStep}
          >
            Continuar
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="relative">
            <Input
              {...register("password")}
              type={showPassword ? "text" : "password"}
              label="Crie uma senha"
              placeholder="••••••••"
              autoComplete="new-password"
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

            {password && (
              <div className="mt-2 space-y-1.5">
                <div className="h-1.5 bg-bg2 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{
                      width: `${(strength.score / 6) * 100}%`,
                      backgroundColor: `var(--${strength.color})`,
                    }}
                    initial={{ width: 0 }}
                    animate={{ width: `${(strength.score / 6) * 100}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-caption">
                  <span className={cn("font-medium")}>
                    Força da senha: {strength.label}
                  </span>
                  <div className="flex items-center gap-1 text-text3">
                    {password.length >= 8 && <CheckCircle className="w-3 h-3 text-ok" />}
                    {/[A-Z]/.test(password) && <CheckCircle className="w-3 h-3 text-ok" />}
                    {/[a-z]/.test(password) && <CheckCircle className="w-3 h-3 text-ok" />}
                    {/[0-9]/.test(password) && <CheckCircle className="w-3 h-3 text-ok" />}
                  </div>
                </div>
              </div>
            )}
          </div>

          <Input
            {...register("confirmPassword")}
            type={showPassword ? "text" : "password"}
            label="Confirmar senha"
            placeholder="••••••••"
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            disabled={isLoading}
            leftIcon={<ShieldCheck className="h-4 w-4" />}
          />

          <div className="flex items-start gap-2">
            <input
              {...register("acceptTerms")}
              id="register-terms"
              type="checkbox"
              className="mt-1 h-5 w-5 flex-shrink-0 rounded-base border-line2 text-accent focus:ring-accent focus:ring-2"
            />
            <label htmlFor="register-terms" className="text-body text-text2 min-h-[44px] cursor-pointer pt-0.5">
              Li e aceito os <a href="/termos" className="text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm">Termos de Uso</a> e a{" "}
              <a href="/privacidade" className="text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm">Política de Privacidade</a>
            </label>
          </div>
          {errors.acceptTerms && (
            <p className="error-text" role="alert">{errors.acceptTerms.message}</p>
          )}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="ghost"
              size="lg"
              disabled={isLoading}
              onClick={() => setStep(1)}
              className="flex-shrink-0"
            >
              Voltar
            </Button>
            <Button
              type="submit"
              variant="primary"
              fullWidth
              size="lg"
              isLoading={isLoading}
              disabled={isLoading}
            >
              Criar conta
            </Button>
          </div>
        </div>
      )}

      <p className="text-center text-body text-text2">
        Já tem conta?{" "}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="text-accent font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
        >
          Entrar
        </button>
      </p>
    </form>
  );
}
