import type { ToastTone } from "./toast";

/**
 * Gestão de erros da plataforma (DS §9 — nunca só cor/ícone, sempre texto).
 *
 * Ponto único de tradução erro técnico → mensagem instrutiva em PT-BR:
 * `toUserError(err)` devolve `{ tone, title, body }` pronto p/ Toast
 * (`notifyError`), `ErrorState` e textos inline de diálogo.
 *
 * Tons (cor + ícone + texto, nunca só cor):
 * - `warn` (âmbar): o usuário pode agir — validação, conflito, sessão,
 *   permissão, não-encontrado, limite de tentativas.
 * - `error` (vermelho): falha fora do controle do usuário — rede, servidor.
 * - `success`/`info`: nunca produzidos aqui (só em fluxos de êxito).
 */

export interface UserFacingError {
  tone: ToastTone;
  title: string;
  body: string;
}

const FIELD_PT: Record<string, string> = {
  description: "A descrição",
  name: "O nome",
  code: "O código",
  slug: "O slug",
  machinesAllowed: "As máquinas",
  machines: "As máquinas",
  monthlyPriceCents: "O preço mensal",
  annualPriceCents: "O preço anual",
  priceCents: "O preço",
  price: "O preço",
  motivo: "O motivo",
  email: "O e-mail",
  password: "A senha",
  gallery: "A galeria",
};

function fieldPT(raw: string): string {
  const key = raw.trim().replace(/^property\s+/i, "");
  return FIELD_PT[key] ?? (key ? `O campo ${key}` : "O campo");
}

/** Traduz um fragmento de validação do Nest (EN) p/ PT instrutivo. */
function humanizeFragment(fragment: string): string {
  const f = fragment.trim().replace(/\.+$/, "");
  if (!f) return "";
  let m = f.match(/^property\s+(.+?)\s+should not exist$/i);
  if (m) return `${fieldPT(m[1])} não é permitido aqui.`;
  m = f.match(/^(.+?)\s+must be shorter than or equal to\s+(\d+)\s+characters$/i);
  if (m) return `${fieldPT(m[1])} deve ter no máximo ${m[2]} caracteres.`;
  m = f.match(/^(.+?)\s+must be longer than or equal to\s+(\d+)\s+characters$/i);
  if (m) return `${fieldPT(m[1])} deve ter no mínimo ${m[2]} caracteres.`;
  m = f.match(/^(.+?)\s+should not be empty$/i);
  if (m) return `${fieldPT(m[1])} é obrigatório.`;
  m = f.match(/^(.+?)\s+must be an email$/i);
  if (m) return `Informe um e-mail válido.`;
  m = f.match(/^(.+?)\s+must be a (number|string|boolean|integer|array)$/i);
  if (m) return `${fieldPT(m[1])} está em formato inválido.`;
  // Já em PT (BFF) ou desconhecido: devolve como está, com ponto final.
  return /[.!?…]$/.test(f) ? f : `${f}.`;
}

/** Achata `message` do Nest (string | string[] | objeto) em texto PT. */
function flattenMessage(message: unknown): string {
  const parts = Array.isArray(message) ? message : [message];
  const texts = parts
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map(humanizeFragment)
    .filter(Boolean)
    .slice(0, 3);
  return texts.join(" ");
}

function cap(text: string, max = 240): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

interface ShapedError {
  status?: unknown;
  code?: unknown;
  message?: unknown;
}

function shapeOf(err: unknown): ShapedError {
  if (typeof err === "object" && err !== null) return err as ShapedError;
  return {};
}

function statusOf(err: unknown): number | null {
  const s = shapeOf(err).status;
  return typeof s === "number" && Number.isFinite(s) ? s : null;
}

function codeOf(err: unknown): string {
  const c = shapeOf(err).code;
  return typeof c === "string" ? c : "";
}

function isNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /failed to fetch|networkerror|load failed|sem conex|network request failed|timeout/i.test(msg);
}

/**
 * Traduz qualquer erro lançado (`ApiClientError`, `Error`, string, array do
 * Nest) em `{ tone, title, body }` instrutivo. Nunca retorna texto técnico
 * cru em EN quando há tradução conhecida; nunca retorna corpo vazio.
 */
export function toUserError(err: unknown, fallback = "Não foi possível concluir. Tente novamente."): UserFacingError {
  if (isNetworkFailure(err)) {
    return {
      tone: "error",
      title: "Sem conexão",
      body: "Verifique sua internet e tente de novo.",
    };
  }

  const status = statusOf(err);
  const code = codeOf(err).toUpperCase();
  const rawMessage = shapeOf(err).message ?? (err instanceof Error ? err.message : typeof err === "string" ? err : "");
  const body = cap(flattenMessage(rawMessage) || fallback);

  if (status === 401 || /^(UNAUTHORIZED|SESSION_EXPIRED)$/.test(code) || /sessão expirada|não autenticado/i.test(body)) {
    return { tone: "warn", title: "Sessão expirada", body: "Entre novamente para continuar — nada foi perdido." };
  }
  if (status === 403 || /^FORBIDDEN$/.test(code) || /permissão|permission|forbidden/i.test(body)) {
    return {
      tone: "warn",
      title: "Sem permissão",
      body: "Você não tem permissão para esta ação. Fale com um administrador.",
    };
  }
  if (status === 404 || /^NOT_FOUND$/.test(code) || /não encontrado|not found/i.test(body)) {
    return {
      tone: "warn",
      title: "Não encontrado",
      body: "O item pode ter sido removido ou o código mudou. Recarregue a lista.",
    };
  }
  if (status === 409 || /CONFLICT|já existe|duplicad/i.test(code) || /já existe|duplicad|already exists/i.test(body)) {
    return { tone: "warn", title: "Já existe", body: cap(`${body} Ajuste os dados e tente de novo.`) };
  }
  if (status === 422 || /^UNPROCESSABLE$/.test(code)) {
    return { tone: "warn", title: "Verifique os campos", body };
  }
  if (status === 429 || /muitas tentativas|too many/i.test(body)) {
    return { tone: "warn", title: "Muitas tentativas", body: "Aguarde alguns segundos e tente de novo." };
  }
  if (
    status === 400 ||
    /^BAD_REQUEST$/.test(code) ||
    /shorter than or equal|longer than or equal|should not be|must be|inválido|obrigatório|no máximo/i.test(body)
  ) {
    return { tone: "warn", title: "Verifique os dados", body };
  }
  if (
    (status !== null && status >= 500) ||
    /UPSTREAM_UNAVAILABLE|indisponível|falha no servidor|internal/i.test(code) ||
    /indisponível/i.test(body)
  ) {
    return {
      tone: "error",
      title: "Serviço indisponível",
      body: "Tente novamente em instantes. Se persistir, fale com o suporte.",
    };
  }
  if (status !== null) {
    return { tone: status >= 500 ? "error" : "warn", title: "Não foi possível concluir", body };
  }
  return { tone: "error", title: "Algo deu errado", body };
}
