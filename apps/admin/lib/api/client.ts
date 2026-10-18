import type { ApiError } from "../types";

export class ApiClientError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Cliente HTTP do Admin → BFF (`/api/*`) ou Nest direto.
 * - `credentials: "include"` (cookies httpOnly, nunca localStorage p/ token).
 * - Em 401 tenta `POST /api/auth/refresh` UMA vez e repete a requisição.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let orgHeader: Record<string, string> = {};
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem("aurum-org");
      if (raw) {
        const parsed = JSON.parse(raw);
        const orgId = parsed?.state?.orgId ?? parsed?.orgId;
        if (orgId) orgHeader = { "x-org-id": String(orgId) };
      }
    } catch {
      // ignore
    }
  }
  const doFetch = async (): Promise<Response> =>
    fetch(path, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...orgHeader, ...(init.headers ?? {}) },
    });

  let res = await doFetch();

  if (res.status === 401 && !path.endsWith("/auth/refresh")) {
    const refreshed = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
    if (refreshed.ok) {
      res = await doFetch();
    }
  }

  if (!res.ok) {
    let code = "INTERNAL";
    let message = `Falha na requisição (${res.status}).`;
    try {
      const body = (await res.json()) as Partial<ApiError> & { message?: unknown };
      if (typeof body.code === "string") code = body.code;
      // O Nest valida com `message` em array (`BadRequestException`) — sem
      // este achatamento a UI exibia só o genérico "Falha na requisição (400)".
      if (typeof body.message === "string" && body.message) message = body.message;
      else if (Array.isArray(body.message)) {
        const flat = body.message.filter((m): m is string => typeof m === "string" && m.length > 0);
        if (flat.length > 0) message = flat.join("; ");
      }
    } catch {
      // Mantém mensagem padrão.
    }
    throw new ApiClientError(res.status, code, message);
  }

  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

export const apiGet = <T>(path: string, init?: RequestInit): Promise<T> =>
  apiFetch<T>(path, { ...init, method: "GET" });

export const apiPost = <T>(path: string, body?: unknown, init?: RequestInit): Promise<T> =>
  apiFetch<T>(path, { ...init, method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

/**
 * `PATCH` parcial e `PUT` de substituição total.
 *
 * O corpo é serializado sempre (inclusive `{}`) para o BFF/Nest aplicarem a
 * regra "nada a alterar"/"faltam campos" — enviar sem corpo transformaria o
 * erro em 400 genérico de parser.
 */
export const apiPatch = <T>(path: string, body?: unknown, init?: RequestInit): Promise<T> =>
  apiFetch<T>(path, { ...init, method: "PATCH", body: JSON.stringify(body ?? {}) });

export const apiPut = <T>(path: string, body?: unknown, init?: RequestInit): Promise<T> =>
  apiFetch<T>(path, { ...init, method: "PUT", body: JSON.stringify(body ?? {}) });
