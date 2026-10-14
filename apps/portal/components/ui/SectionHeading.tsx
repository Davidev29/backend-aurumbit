"use client";

import type { ReactNode } from "react";
import { Reveal } from "@/components/motion";
import { cn } from "@/lib/utils";

export interface SectionHeadingProps {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  align?: "center" | "left";
  id?: string;
  className?: string;
}

/**
 * Cabeçalho de seção padrão — eyebrow dourada (opcional, máx. 1 a cada 3 seções) +
 * título display + subtítulo. Garante ritmo vertical e hierarquia H1 > H2.
 */
export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "center",
  id,
  className,
}: SectionHeadingProps) {
  const centered = align === "center";

  return (
    <Reveal variant="fade" delay={0}>
      <div
        className={cn(
          "max-w-3xl mb-10 sm:mb-12 lg:mb-16",
          centered ? "mx-auto text-center" : "text-left",
          className
        )}
      >
        {eyebrow && <span className="badge-gold mb-4 inline-block">{eyebrow}</span>}
        <h2
          id={id}
          className="font-display font-extrabold text-section text-text1 mb-4 text-balance"
        >
          {title}
        </h2>
        {subtitle && (
          <p className="text-headline text-text2 leading-relaxed">{subtitle}</p>
        )}
      </div>
    </Reveal>
  );
}
