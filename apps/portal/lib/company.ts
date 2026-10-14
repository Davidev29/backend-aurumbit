/**
 * Dados públicos da empresa — fonte única para Footer, TrustBar e contato.
 * `whatsapp`/`cnpj`: preencher com valores reais quando existirem;
 * enquanto `undefined`, os itens correspondentes NÃO são renderizados
 * (nunca exibir placeholder como `wa.me/5500000000000`).
 */
export const COMPANY = {
  name: "AurumBit",
  email: "contato@aurumbit.com",
  site: "https://aurumbit.com",
  telegram: "https://t.me/aurumbit",
  whatsapp: undefined as string | undefined,
  cnpj: undefined as string | undefined,
} as const;

export function supportMailto(subject?: string): string {
  return subject
    ? `mailto:${COMPANY.email}?subject=${encodeURIComponent(subject)}`
    : `mailto:${COMPANY.email}`;
}
