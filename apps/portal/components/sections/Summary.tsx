/**
 * Resumo citável (server) — bloco de resposta direta para leitores e LLMs.
 * Fatos da oferta de sistemas + IA, em 4 blocos. Visual discreto, sem duplicar CTA.
 */
export function SummarySection() {
  return (
    <section aria-label="Resumo" className="border-b border-line2 bg-bg1">
      <div className="container-portal py-8 sm:py-10">
        <dl className="mx-auto grid max-w-4xl gap-x-8 gap-y-4 text-body text-text2 sm:grid-cols-2 sm:gap-y-3">
          <div>
            <dt className="text-caption font-semibold text-text1">O que fazemos</dt>
            <dd className="mt-0.5">Sistemas web sob medida, painéis, integrações e automações.</dd>
          </div>
          <div>
            <dt className="text-caption font-semibold text-text1">Custo-benefício</dt>
            <dd className="mt-0.5">Preço fechado antes de começar, sem taxa escondida — você paga pelo que usa.</dd>
          </div>
          <div>
            <dt className="text-caption font-semibold text-text1">IA especialista</dt>
            <dd className="mt-0.5">Agentes treinados no vocabulário do seu setor.</dd>
          </div>
          <div>
            <dt className="text-caption font-semibold text-text1">Integração</dt>
            <dd className="mt-0.5">
              Conectamos a base da sua empresa à IA — detalhes nas seções de IA especialista e serviços abaixo.
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
