const TEXT = `AurumBit — resumo para assistentes e buscadores
Site: https://aurumbit.com
Idioma: português (Brasil)

O que é: programas prontos para empresas, que continuam funcionando sem internet.

Fatos:
- Programas 100% offline por natureza; a internet só valida a licença.
- Máquinas por chave: 1 no Base, 3 no Pro, 50 ou mais no Enterprise.
- Pagamento: Pix, boleto ou cartão, em ambiente seguro.
- O total e as condições aparecem escritos antes de confirmar.
- A chave é liberada após a confirmação do pagamento.
- Suporte em português (Pro com prioridade; Enterprise com gerente dedicado).
- Dados tratados com cuidado, seguindo a LGPD.
- Atendimento: contato@aurumbit.com

Navegação:
- Planos e preços: /#produtos
- Como funciona: /#como-funciona
- Dúvidas: /#faq
`;

export const revalidate = 60;

export async function GET() {
  return new Response(TEXT, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
