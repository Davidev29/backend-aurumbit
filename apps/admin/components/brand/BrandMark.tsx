"use client";

import Link from "next/link";

/**
 * Marca Aurum Bit — logotipo oficial + wordmark.
 * Usa `/brand/logo.png` (origem: `ASSETS/AURUM BIT LOGO SEM FUNDO.png`).
 * Fallback: monograma "A" em fundo accent (offline/asset ausente).
 */
export function BrandMark({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-base bg-accentsoft">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/logo.png"
          alt=""
          aria-hidden="true"
          className="h-8 w-8 object-contain"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-base bg-accentsoft">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/logo.png"
          alt="Aurum Bit"
          className="h-10 w-10 object-contain"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-headline text-text1">Aurum Admin</span>
        <span className="block truncate text-micro font-normal normal-case tracking-normal text-text2">
          Terminal administrativo · Aurum Bit
        </span>
      </span>
    </span>
  );
}

export function BrandLink({ href = "/dashboard" }: { href?: string }) {
  return (
    <Link href={href} aria-label="Aurum Admin — início" className="focus-ring rounded-base no-underline">
      <BrandMark />
    </Link>
  );
}
