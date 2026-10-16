/**
 * Ecos da operação — camada ambiente decorativa do `SummarySection`.
 *
 * Pílulas estilo comentário que aparecem e somem em SLOTS fixos
 * (3 fileiras × laterais), nunca sobrepostas: a animação é só
 * vertical (opacity + translateY), então slots lado a lado com
 * folga jamais colidem.
 *
 * - `aria-hidden`: decorativo — leitores de tela e LLMs leem só o `dl` factual.
 * - Jitter determinístico (PRNG com seed): sem divergência de hidratação.
 * - `prefers-reduced-motion` → camada desligada; `forced-colors` → oculta.
 */

interface Voice {
  text: string;
  name: string;
  detail: string;
}

interface Slot {
  left: number;
  top: number;
  show: string;
}

const VOICES: Voice[] = [
  { text: "Entenderam minha operação logo na primeira conversa.", name: "Mariana", detail: "loja" },
  { text: "Preço fechado antes de começar, sem surpresa.", name: "João", detail: "oficina" },
  { text: "Entregaram no prazo que combinaram.", name: "Carlos", detail: "distribuidora" },
  { text: "Explicaram tudo sem enrolação.", name: "Paula", detail: "clínica" },
  { text: "O sistema ficou do jeito que eu pedi.", name: "Fernanda", detail: "padaria" },
  { text: "Ajustaram comigo até ficar bom.", name: "Rafael", detail: "advocacia" },
  { text: "Atendimento rápido, em português.", name: "Aline", detail: "salão" },
  { text: "Tiraram minhas dúvidas com paciência.", name: "Diego", detail: "autopeças" },
  { text: "Processo claro do início ao fim.", name: "Camila", detail: "pet shop" },
  { text: "Resolveram rápido quando precisei.", name: "Marcos", detail: "contabilidade" },
  { text: "Deu para acompanhar cada etapa.", name: "Beatriz", detail: "escola" },
  { text: "Contrataria de novo sem pensar.", name: "Larissa", detail: "farmácia" },
];

/**
 * 12 slots fixos em 3 fileiras cheias (4 por fileira), com folga generosa.
 * A animação é só vertical (opacity + translateY), então slots lado a lado
 * com vão jamais colidem. <lg mostra 6 (2 por fileira); lg+ mostra as 12.
 */
const SLOTS: Slot[] = [
  // Fileira superior
  { left: 3, top: 4, show: "flex" },
  { left: 28, top: 3, show: "hidden lg:flex" },
  { left: 53, top: 4, show: "flex" },
  { left: 76, top: 3, show: "hidden lg:flex" },
  // Fileira do meio (par central visível sempre; quarteto completo no lg+)
  { left: 28, top: 42, show: "hidden lg:flex" },
  { left: 5, top: 42, show: "flex" },
  { left: 53, top: 42, show: "flex" },
  { left: 76, top: 42, show: "hidden lg:flex" },
  // Fileira inferior
  { left: 4, top: 77, show: "flex" },
  { left: 29, top: 78, show: "hidden lg:flex" },
  { left: 54, top: 77, show: "flex" },
  { left: 78, top: 78, show: "hidden lg:flex" },
];

/** PRNG determinístico (mulberry32) — mesma composição no server e no client. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

export function SummaryVoices() {
  const rand = prng(20261015);
  const placed = VOICES.map((voice, i) => {
    const slot = SLOTS[i % SLOTS.length];
    // Jitter pequeno: ±0.6% na horizontal, ±0.8% na vertical — nunca fecha o vão.
    const left = slot.left + (rand() * 2 - 1) * 0.6;
    const top = slot.top + (rand() * 2 - 1) * 0.8;
    const duration = 16 + rand() * 8; // 16s–24s: cada voz tem seu ritmo
    const delay = -(rand() * 24); // negativo: já entram em fases distintas
    return { voice, left, top, duration, delay, show: slot.show };
  });

  return (
    <div
      className="summary-voices pointer-events-none absolute inset-0 select-none overflow-hidden"
      aria-hidden="true"
    >
      <style>{`
        @keyframes voice-cycle {
          0% { opacity: 0; transform: translateY(12px) scale(0.97); }
          10% { opacity: 1; transform: translateY(0) scale(1); }
          55% { opacity: 1; transform: translateY(-4px) scale(1); }
          68% { opacity: 0; transform: translateY(-12px) scale(0.98); }
          100% { opacity: 0; transform: translateY(-12px) scale(0.98); }
        }
        .voice-item {
          animation: voice-cycle var(--voice-dur, 20s) ease-in-out infinite;
          animation-delay: var(--voice-delay, 0s);
          will-change: transform, opacity;
          backface-visibility: hidden;
        }
        @media (prefers-reduced-motion: reduce) {
          .voice-item { animation: none !important; opacity: 0 !important; }
        }
        @media (prefers-reduced-transparency: reduce) {
          .voice-pill { background: var(--bg-2); }
        }
        @media (forced-colors: active) {
          .summary-voices { display: none; }
        }
      `}</style>
      {placed.map(({ voice, left, top, duration, delay, show }, i) => (
        <div
          key={`${voice.name}-${i}`}
          className={`voice-item absolute ${show}`}
          style={
            {
              left: `${left.toFixed(2)}%`,
              top: `${top.toFixed(2)}%`,
              "--voice-dur": `${duration.toFixed(2)}s`,
              "--voice-delay": `${delay.toFixed(2)}s`,
            } as React.CSSProperties
          }
        >
          <div className="voice-pill flex max-w-[165px] items-start gap-2 rounded-[14px] border border-line2 bg-bg2/60 px-3 py-2 shadow-2 backdrop-blur-sm sm:max-w-[200px]">
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10px] font-bold text-accent"
              aria-hidden="true"
            >
              {initials(voice.name)}
            </span>
            <span className="min-w-0">
              <span className="block line-clamp-2 text-[11px] leading-snug text-text1">
                &ldquo;{voice.text}&rdquo;
              </span>
              <span className="mt-0.5 block text-[10px] font-medium text-text3">
                {voice.name} · {voice.detail}
              </span>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
