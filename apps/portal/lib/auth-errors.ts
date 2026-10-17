/**
 * Códigos de erro do domínio `auth` → mensagem para o cliente.
 *
 * O backend devolve códigos estáveis (`EMAIL_NOT_VERIFIED`, `ACCOUNT_LOCKED`,
 * `RATE_LIMITED`, `PASSWORD_CONTAINS_EMAIL`...) mas nem sempre com `message`
 * legível (o `ValidationPipe` manda array; o `AuthError` de política sai sem
 * texto). Aqui o código ganha uma frase única e acionável — e erros
 * desconhecidos caem no texto do backend ou num fallback honesto.
 */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  // Cadastro
  INVALID_EMAIL: "E-mail inválido.",
  PASSWORD_TOO_SHORT: "A senha deve ter ao menos 8 caracteres.",
  PASSWORD_TOO_LONG: "A senha deve ter no máximo 128 caracteres.",
  PASSWORD_CONTAINS_EMAIL: "A senha não pode conter o seu e-mail.",
  CONSENTS_REQUIRED: "Aceite os Termos de Uso e a Política de Privacidade para continuar.",
  CONFLICT: "Este e-mail já está cadastrado. Use a aba Entrar.",
  // Login
  INVALID_CREDENTIALS: "E-mail ou senha incorretos.",
  EMAIL_NOT_VERIFIED: "Confirme seu e-mail para entrar — o link foi enviado no cadastro.",
  ACCOUNT_LOCKED: "Conta bloqueada temporariamente por tentativas demais. Tente em alguns minutos.",
  RATE_LIMITED: "Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente.",
  // Sessão / infra
  INVALID_TOKEN: "Link inválido ou expirado. Peça um novo.",
  SESSION_INVALID: "Sessão inválida. Entre de novo.",
  REVOKED: "Sessão expirada. Entre de novo.",
  FORBIDDEN_ORIGIN: "Não foi possível validar a origem da sessão. Recarregue a página.",
  UPSTREAM_MISSING: "Serviço indisponível agora. Tente novamente em instantes.",
  UPSTREAM_UNAVAILABLE: "Serviço indisponível agora. Tente novamente em instantes.",
  UNPROCESSABLE: "Confira os dados informados e tente novamente.",
  BAD_REQUEST: "Confira os dados informados e tente novamente.",
};

export function authErrorMessage(
  code: string | undefined,
  backendMessage?: string,
  fallback = "Algo deu errado. Tente novamente."
): string {
  // Mensagem legível do backend vence (é específica); o mapa cobre os casos
  // em que só existe código.
  if (backendMessage && !/^Falha na requisição \(\d+\)\.$/.test(backendMessage)) {
    return backendMessage;
  }
  if (code && AUTH_ERROR_MESSAGES[code]) return AUTH_ERROR_MESSAGES[code];
  return backendMessage ?? fallback;
}
