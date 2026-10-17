"use client";

import { createContext, useContext, useState, useEffect, type ReactNode, useCallback } from "react";
import type { AuthFormResult, MeResponse } from "@/types";
import { getMe, login as apiLogin, register as apiRegister, logout as apiLogout } from "@/lib/api";

/**
 * Cookie-dica gravado pelo BFF junto da sessão (não httpOnly, sem token).
 * Sem ele o visitante deslogado não chama `GET /api/auth/me` — era isso que
 * enchia o console da landpage de 401 a cada visita.
 */
const HINT_COOKIE = "aurum_portal_session_hint";

function hasSessionHint(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").some((part) => part.startsWith(`${HINT_COOKIE}=`));
}

interface AuthContextType {
  user: MeResponse | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<AuthFormResult>;
  register: (data: { name: string; email: string; password: string; confirmPassword: string; acceptTerms: boolean }) => Promise<AuthFormResult>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    // Sem dica de sessão não há o que buscar: responde deslogado sem request.
    if (!hasSessionHint()) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    try {
      setUser(await getMe());
    } catch {
      // 401 = sem sessão válida (esperado após expirar/sair). O BFF limpa os
      // cookies nesse caminho; aqui basta não ter usuário.
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = async (email: string, password: string, rememberMe?: boolean): Promise<AuthFormResult> => {
    setIsLoading(true);
    try {
      const result = await apiLogin({ email, password, rememberMe });
      if (result.ok) {
        if (result.me) setUser(result.me);
        else await refreshUser();
      }
      return {
        ok: result.ok,
        mfaRequired: result.mfaRequired,
        verificationRequired: result.verificationRequired,
        email: result.email,
      };
    } catch (error) {
      // Erro do backend sobe com código/mensagem originais (o formulário decide
      // o texto e a ação — ex. EMAIL_NOT_VERIFIED oferece reenviar o link).
      return {
        ok: false,
        code: error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : undefined,
        message: error instanceof Error ? error.message : undefined,
      };
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (data: { name: string; email: string; password: string; confirmPassword: string; acceptTerms: boolean }): Promise<AuthFormResult> => {
    setIsLoading(true);
    try {
      const result = await apiRegister(data);
      // Cadastro com upstream NÃO abre sessão: a identidade aguarda
      // `verify-email`, então `user` só é preenchido no modo stub (dev).
      if (result.ok && result.me && !result.verificationRequired) {
        setUser(result.me);
      }
      return {
        ok: result.ok,
        mfaRequired: result.mfaRequired,
        verificationRequired: result.verificationRequired,
        email: result.email ?? data.email,
      };
    } catch (error) {
      return {
        ok: false,
        code: error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : undefined,
        message: error instanceof Error ? error.message : undefined,
      };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await apiLogout();
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const value = {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    register,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
