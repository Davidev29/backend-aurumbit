/**
 * Arte da logomarca para o motor líquido (`LiquidMarkStage`).
 *
 * Símbolo AurumBit (cf. `/icon-192.png`) renderizado em canvas 2D como
 * PEÇA ÚNICA: pastilha escura + união dos dois quadrados e da ponte num só
 * `fill` — sem emendas visíveis entre bloquinhos. O ouro é quase chapado
 * (sheen sutil) como no ícone, para não criar faixas de tom na peça.
 *
 * O canvas usa as fontes da página? Não precisa — é só geometria, zero
 * texto, zero fetch externo/CSP. Fundo transparente (o motor amostra alfa).
 */

const S = 800;

/** Ouro chapado do ícone: sheen de ±8% para não faixar a peça. */
const GOLD: Array<[number, string]> = [
  [0, "#A88248"],
  [0.5, "#D9BC7C"],
  [1, "#A88248"],
];

function drawMark(ctx: CanvasRenderingContext2D, tx: number, ty: number, t: number): void {
  const s = t * 0.41;
  const o = t * 0.11;

  ctx.fillStyle = "#0d0b09";
  ctx.beginPath();
  const tileR = t * 0.27;
  ctx.moveTo(tx + tileR, ty);
  ctx.arcTo(tx + t, ty, tx + t, ty + t, tileR);
  ctx.arcTo(tx + t, ty + t, tx, ty + t, tileR);
  ctx.arcTo(tx, ty + t, tx, ty, tileR);
  ctx.arcTo(tx, ty, tx + t, ty, tileR);
  ctx.closePath();
  ctx.fill();

  const g = ctx.createLinearGradient(0, ty, 0, ty + t);
  for (const [offset, color] of GOLD) g.addColorStop(offset, color);
  ctx.fillStyle = g;

  // União num único path: quadrados + ponte sob rotação — 1 fill, sem costura.
  // (O `sub` adiciona subpaths ao path atual; a rotação é aplicada na
  // construção, então o fill único cobre a união sem emendas.)
  ctx.beginPath();
  const sub = (x: number, y: number, w: number, h: number, r: number) => {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  };
  sub(tx + o, ty + o, s, s, s * 0.3);
  sub(tx + t - o - s, ty + t - o - s, s, s, s * 0.3);
  // Ponte centro a centro (top-left → bottom-right = +45° no canvas),
  // com as pontas arredondadas enterradas dentro dos quadrados.
  ctx.save();
  ctx.translate(tx + t / 2, ty + t / 2);
  ctx.rotate(Math.PI / 4);
  sub(-t * 0.49, -t * 0.11, t * 0.98, t * 0.22, t * 0.11);
  ctx.restore();
  ctx.fill();
}

/** Símbolo centralizado em canvas quadrado transparente → dataURL PNG. */
export function renderLiquidMarkImage(): string {
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const t = S * 0.65;
  drawMark(ctx, (S - t) / 2, (S - t) / 2, t);
  return canvas.toDataURL("image/png");
}

/* — Palavras e H1 líquidos: mesmo ouro dos SVGs, por tema — */

export type WordArtTheme = "light" | "dark";

/** Mesmos stops de `aurum-liquid-light/dark.svg`. */
const STOPS: Record<WordArtTheme, Array<[number, string]>> = {
  light: [
    [0, "#6B5320"],
    [0.3, "#C0A060"],
    [0.48, "#EADAB6"],
    [0.62, "#D8B879"],
    [0.85, "#755D2E"],
    [1, "#6B5320"],
  ],
  dark: [
    [0, "#755D2E"],
    [0.35, "#C0A060"],
    [0.5, "#EADAB6"],
    [0.65, "#C0A060"],
    [1, "#755D2E"],
  ],
};

const DISPLAY_STACK = `"Space Grotesk","Sora",system-ui,-apple-system,"Segoe UI",sans-serif`;

function setTrackedFont(ctx: CanvasRenderingContext2D, weight: number, px: number, tracking: number): void {
  ctx.font = `${weight} ${px}px ${DISPLAY_STACK}`;
  try {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${Math.round(
      px * tracking
    )}px`;
  } catch {
    /* letterSpacing não suportado — segue sem tracking */
  }
}

/** Canvas da palavra: 1800×360 cropado justo — texto grande em negrito,
    bleed vertical p/ as partículas; horizontal segue o bleed do cursor. */
export const WORD_W = 1800;
export const WORD_H = 360;
export const WORD_MAXW = 1680;

/**
 * Tamanho ÚNICO para todas as palavras = o que cabe na maior, medido uma vez.
 * Todas rendem na mesma escala (sem "grande/pequeno" entre palavras).
 */
export function measureWordUnit(words: readonly string[]): number {
  const meas = document.createElement("canvas").getContext("2d");
  if (!meas) return 96;
  let uni = 250;
  for (const w of words) {
    let size = 250;
    setTrackedFont(meas, 700, size, -0.02);
    while (size > 84 && meas.measureText(w).width > WORD_MAXW) {
      size -= 4;
      setTrackedFont(meas, 700, size, -0.02);
    }
    uni = Math.min(uni, size);
  }
  return uni;
}

/** Gradiente ouro do tema para a palavra. */
export function wordGold(
  ctx: CanvasRenderingContext2D,
  theme: WordArtTheme,
  y0: number,
  y1: number
): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [offset, color] of STOPS[theme]) g.addColorStop(offset, color);
  return g;
}

/** Desenha o prefixo atual no canvas 2D persistente (vazio = limpo). */
export function paintWordPrefix(
  ctx: CanvasRenderingContext2D,
  text: string,
  uni: number,
  theme: WordArtTheme
): void {
  ctx.clearRect(0, 0, WORD_W, WORD_H);
  if (!text) return;
  setTrackedFont(ctx, 700, uni, -0.02);
  ctx.fillStyle = wordGold(ctx, theme, WORD_H / 2 - uni * 0.4, WORD_H / 2 + uni * 0.4);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, WORD_W / 2, WORD_H / 2 + 2);
}

/** H1 em 2 linhas (branco + acento ouro), quadro 1600×340 cropado justo. */
export function renderLiquidH1Image(theme: WordArtTheme): string {
  const W2 = 1600;
  const H2 = 340;
  const canvas = document.createElement("canvas");
  canvas.width = W2;
  canvas.height = H2;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const ink = theme === "dark" ? "#F5F5F4" : "#14161A";
  const accent = theme === "dark" ? "#C0A060" : "#755D2E";

  const l1 = "Sistemas que colocam";
  const a = "sua empresa ";
  const b = "no padrão.";
  const l2 = a + b;
  const maxWidth = W2 - 280;
  // Auto-fit: a maior das linhas manda no tamanho (mín. 96px).
  let size = 170;
  const widest = (px: number): number => {
    setTrackedFont(ctx, 500, px, -0.02);
    return Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width);
  };
  while (size > 96 && widest(size) > maxWidth) size -= 6;
  setTrackedFont(ctx, 500, size, -0.02);
  ctx.textBaseline = "middle";

  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.fillText(l1, W2 / 2, H2 / 2 - size * 0.62);

  const total = ctx.measureText(l2).width;
  let x = W2 / 2 - total / 2;
  ctx.textAlign = "left";
  ctx.fillStyle = ink;
  ctx.fillText(a, x, H2 / 2 + size * 0.62);
  x += ctx.measureText(a).width;
  ctx.fillStyle = accent;
  ctx.fillText(b, x, H2 / 2 + size * 0.62);

  return canvas.toDataURL("image/png");
}
