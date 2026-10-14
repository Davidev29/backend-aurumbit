"use client";

import { createContext, useContext, useState, useEffect, type ReactNode, useCallback } from "react";
import type { MeResponse } from "@/types";
import { getMe, login as apiLogin, register as apiRegister, logout as apiLogout } from "@/lib/api";

interface AuthContextType {
  user: MeResponse | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<{ ok: boolean; mfaRequired?: boolean }>;
  register: (data: { name: string; email: string; password: string; confirmPassword: string; acceptTerms: boolean }) => Promise<{ ok: boolean; mfaRequired?: boolean }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const me = await getMe();
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = async (email: string, password: string, rememberMe?: boolean) => {
    setIsLoading(true);
    try {
      const result = await apiLogin({ email, password, rememberMe });
      if (result.ok && result.me) {
        setUser(result.me);
      }
      return { ok: result.ok, mfaRequired: result.mfaRequired };
    } catch (error) {
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (data: { name: string; email: string; password: string; confirmPassword: string; acceptTerms: boolean }) => {
    setIsLoading(true);
    try {
      const result = await apiRegister(data);
      if (result.ok && result.me) {
        setUser(result.me);
      }
      return { ok: result.ok, mfaRequired: result.mfaRequired };
    } catch (error) {
      throw error;
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