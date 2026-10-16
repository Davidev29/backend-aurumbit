/**
 * Faixa de depoimentos (server) — só as mensagens flutuantes de satisfação.
 * Camada 100% ambiente e `aria-hidden`: não entra em leitores de tela nem
 * em LLMs (os textos são ilustrativos — trocar por depoimentos reais
 * de clientes quando existirem).
 */
import { SummaryVoices } from "./SummaryVoices";

export function SummarySection() {
  return (
    <section
      aria-hidden="true"
      className="relative min-h-[340px] overflow-hidden border-b border-line2 bg-bg1 sm:min-h-[400px]"
    >
      <SummaryVoices />
    </section>
  );
}
