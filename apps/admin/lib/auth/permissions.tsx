"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { apiGet } from "../api/client";
import type { MeResponse } from "../types";
import { MOCK_ME_ADMIN } from "../mocks";
import { ForbiddenState } from "@/components/feedback/ForbiddenState";

interface AuthState {
  me: MeResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const AuthContext = createContext<AuthState>({ me: null, loading: true, error: null, reload: () => {} });

/**
 * Provedor de identidade do Admin.
 * - Caminho rápido: espelha o cookie legível `aurum_claims` no mount (menu
 *   instantâneo, sem flicker) e reconcilia com `/api/auth/me` em seguida.
 * - Sem sessão e sem backend: assume admin mock p/ desenvolvimento
 *   (frontend-first; TODO(backend pronto): remover fallback mock).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Caminho rápido (efeito: sem mismatch de hidratação — SSR monta null).
  useEffect(() => {
    try {
      const m = document.cookie.match(/(?:^|;\s*)aurum_claims=([^;]*)/);
      if (m) {
        const parsed: unknown = JSON.parse(decodeURIComponent(m[1]));
        if (Array.isArray(parsed)) {
          const permissions = parsed.filter((c): c is string => typeof c === "string");
          setMe({
            id: "claims",
            email: "",
            name: "Conta",
            mfaRequired: false,
            mfaVerified: false,
            organizationId: "",
            permissions,
          });
        }
      }
    } catch {
      /* mantém null até o fetch reconciliar */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<MeResponse>("/api/auth/me")
      .then((data) => {
        if (!cancelled) {
          setMe(data);
          setError(null);
        }
      })
      .catch(() => {
        // Stub Fase 2: sem backend, assume admin mock p/ desenvolvimento.
        if (!cancelled) {
          setMe(MOCK_ME_ADMIN);
          setError(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return <AuthContext.Provider value={{ me, loading, error, reload }}>{children}</AuthContext.Provider>;
}

export function useMe(): AuthState {
  return useContext(AuthContext);
}

/** Retorna true se o usuário possui a permissão (opcionalmente na org ativa). */
export function useCan(permission: string, organizationId?: string | null): boolean {
  const { me } = useMe();
  if (!me) return false;
  if (organizationId && me.organizationId !== organizationId) return false;
  return me.permissions.includes(permission);
}

interface RequirePermProps {
  perm: string;
  organizationId?: string | null;
  children: ReactNode;
}

/**
 * Guarda de UI por permissão. A autorização real é SEMPRE do backend (403);
 * este componente apenas oculta/condiciona a renderização.
 */
export function RequirePerm({ perm, organizationId, children }: RequirePermProps) {
  const { me, loading } = useMe();
  const allowed = useCan(perm, organizationId);
  if (loading) return null;
  if (!me || !allowed) return <ForbiddenState requiredPerm={perm} />;
  return <>{children}</>;
}
