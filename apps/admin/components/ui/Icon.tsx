import type { ComponentType } from "react";

export type IconSize = 16 | 20 | 24;

type GlyphProps = {
  size?: number | string;
  strokeWidth?: number | string;
  "aria-hidden"?: boolean | "true" | "false";
  className?: string;
};

export interface IconProps {
  /** Componente de ícone `lucide-react` (ex.: `import { Eye } from "lucide-react"`). */
  icon: ComponentType<GlyphProps>;
  /** Tamanhos permitidos DS §4: 16/20/24 (toque ≥44px no botão que envolve). */
  size?: IconSize;
  /**
   * Stroke DS §4: default 1.75 (1.5 em 16px, 2 em 24px).
   * Override explícito permitido quando o contexto exigir.
   */
  strokeWidth?: number;
  className?: string;
}

/**
 * Wrapper canônico `lucide-react` (DS §4): tamanhos 16/20/24, stroke 1.75,
 * `currentColor` (default do lucide), decorativo com `aria-hidden`.
 * Ícone interativo: o botão que envolve leva `aria-label` pt-BR.
 */
export function Icon({ icon: Glyph, size = 20, strokeWidth, className }: IconProps) {
  const sw = strokeWidth ?? (size === 16 ? 1.5 : size === 24 ? 2 : 1.75);
  return <Glyph size={size} strokeWidth={sw} aria-hidden="true" className={className} />;
}
