"use client";

import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, KeyRound, BadgeCheck, LifeBuoy, LogIn, UserPlus } from "lucide-react";
import { Modal, Button, Logo, useToastHelpers } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { LoginForm } from "./LoginForm";
import { RegisterForm } from "./RegisterForm";
import { VerifyEmailNotice } from "./VerifyEmailNotice";
import { cn } from "@/lib/utils";
import type { AuthFormResult } from "@/types";

const REGISTER_BENEFITS = [
  { icon: KeyRound, label: "Chave após a confirmação" },
  { icon: BadgeCheck, label: "Preço fechado, sem surpresa" },
  { icon: LifeBuoy, label: "Ajuda em português" },
];

type AuthMode = "login" | "register";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultMode?: AuthMode;
  onSuccess?: (mode: AuthMode) => void;
}

const TABS: Array<{ mode: AuthMode; label: string; icon: typeof LogIn }> = [
  { mode: "login", label: "Entrar", icon: LogIn },
  { mode: "register", label: "Cadastrar", icon: UserPlus },
];

export function AuthModal({ isOpen, onClose, defaultMode = "login", onSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<AuthMode>(defaultMode);
  const [isLoading, setIsLoading] = useState(false);
  /** E-mail do cadastro recém-criado aguardando confirmação (troca a view). */
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { success } = useToastHelpers();
  const { login, register } = useAuth();

  // Sincroniza a aba toda vez que o modal abre.
  useEffect(() => {
    if (isOpen) {
      setMode(defaultMode);
      setSentTo(null);
    }
  }, [isOpen, defaultMode]);

  /**
   * Erros NÃO são mais convertidos em toast genérico aqui: o resultado volta
   * com `code`/`message` do backend e o formulário mostra o motivo real
   * (e-mail não confirmado, conta bloqueada, limite de tentativas...).
   */
  const handleLogin = async (data: { email: string; password: string; rememberMe?: boolean }): Promise<AuthFormResult> => {
    setIsLoading(true);
    try {
      const result = await login(data.email, data.password, data.rememberMe);
      if (result.ok) {
        success("Bem-vindo!", "Login realizado com sucesso.");
        onClose();
        if (onSuccess) {
          onSuccess("login");
        } else {
          // Redirect will be handled by parent
          window.location.href = "/dashboard";
        }
      }
      return result;
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (data: {
    name: string;
    email: string;
    password: string;
    confirmPassword: string;
    acceptTerms: boolean;
  }): Promise<AuthFormResult> => {
    setIsLoading(true);
    try {
      const result = await register(data);
      if (result.ok && result.verificationRequired) {
        // Conta criada sem sessão: o acesso só libera após confirmar o e-mail.
        setSentTo(result.email ?? data.email);
        return result;
      }
      if (result.ok) {
        success("Conta criada!", "Bem-vindo à AurumBit. Redirecionando...");
        onClose();
        if (onSuccess) {
          onSuccess("register");
        } else {
          window.location.href = "/dashboard";
        }
      }
      return result;
    } finally {
      setIsLoading(false);
    }
  };

  const switchMode = useCallback((newMode: AuthMode) => {
    setSentTo(null);
    setMode(newMode);
  }, []);

  const handleClose = useCallback(() => {
    if (!isLoading) {
      setSentTo(null);
      onClose();
    }
  }, [isLoading, onClose]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      size="md"
      showCloseButton={false}
      closeOnOverlayClick={!isLoading}
      closeOnEscape={!isLoading}
      className="max-w-lg overflow-hidden max-h-[calc(100dvh-2rem)] overflow-y-auto"
    >
      {/* topo: marca + fechar */}
      <div className="flex items-center justify-between gap-4 pt-1">
        <Logo size="sm" />
        <button
          onClick={handleClose}
          disabled={isLoading}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-base p-3 text-text3 transition-colors hover:bg-bg2 hover:text-text1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-45"
          aria-label="Fechar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* seletor Entrar | Cadastrar — pílula deslizante */}
      <div className="pt-3">
        <div
          role="tablist"
          aria-label="Escolha entre entrar ou cadastrar"
          className="grid grid-cols-2 gap-1 rounded-full border border-line2 bg-bg0 p-1"
        >
          {TABS.map(({ mode: tab, label, icon: Icon }) => {
            const active = tab === mode && sentTo === null;
            return (
              <button
                key={tab}
                role="tab"
                aria-selected={active}
                disabled={isLoading}
                onClick={() => switchMode(tab)}
                className={cn(
                  "relative flex min-h-[44px] items-center justify-center gap-2 rounded-full text-body font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-45",
                  active ? "text-on-gold" : "text-text2 hover:text-text1"
                )}
              >
                {active && (
                  <motion.span
                    layoutId="auth-tab-pill"
                    className="absolute inset-0 rounded-full bg-gradient-gold shadow-glow-sm"
                    transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  />
                )}
                <Icon className="relative z-10 h-4 w-4" aria-hidden="true" />
                <span className="relative z-10">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* viewport de altura FIXA: o modal nunca cresce/diminui na troca.
          h compacto no mobile, confortável no desktop. */}
      <div className="h-[400px] pt-4 sm:h-[460px]">
        <motion.div
          key={sentTo ? "verify" : mode}
          initial={{ opacity: 0, x: sentTo ? 0 : mode === "register" ? 48 : -48 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          className="h-full overflow-y-auto overscroll-contain"
        >
          {/* respiro interno: o anel de foco (4px) nunca encosta na borda do scroll */}
          <div className="m-auto flex min-h-full w-full flex-col justify-center px-1.5 py-1.5">
            {sentTo ? (
              <VerifyEmailNotice email={sentTo} onSwitchToLogin={() => switchMode("login")} />
            ) : mode === "login" ? (
              <div>
                <div className="mb-4 text-center">
                  <h3 className="font-display text-headline font-bold text-text1">Entrar na sua conta</h3>
                  <p className="mt-1 text-caption text-text2">Acesse seu painel e gerencie seus produtos</p>
                </div>
                <LoginForm
                  onSubmit={handleLogin}
                  onSwitchToRegister={() => switchMode("register")}
                  isLoading={isLoading}
                />
              </div>
            ) : (
              <div>
                <div className="mb-4 text-center">
                  <h3 className="font-display text-headline font-bold text-text1">Criar sua conta</h3>
                  <p className="mt-1 text-caption text-text2">Junte-se à AurumBit em menos de 1 minuto</p>
                  <ul className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5" aria-label="O que você ganha">
                    {REGISTER_BENEFITS.map(({ icon: Icon, label }) => (
                      <li key={label} className="flex items-center gap-1.5 text-caption text-text2">
                        <Icon className="h-4 w-4 text-accent" aria-hidden="true" />
                        {label}
                      </li>
                    ))}
                  </ul>
                </div>
                <RegisterForm
                  onSubmit={handleRegister}
                  onSwitchToLogin={() => switchMode("login")}
                  isLoading={isLoading}
                />
              </div>
            )}
          </div>
        </motion.div>
      </div>

      <div className="mb-0 mt-4 border-t border-line2 pt-4">
        <p className="text-center text-caption text-text3">
          Ao continuar, você concorda com nossos{" "}
          <a href="/termos" className="rounded-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Termos de Uso</a>{" "}
          e{" "}
          <a href="/privacidade" className="rounded-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Política de Privacidade</a>
        </p>
      </div>
    </Modal>
  );
}
