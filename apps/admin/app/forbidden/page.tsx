import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="auth-wrap" role="main">
      <div
        className="w-full max-w-[25rem] rounded-card bg-bg1 border border-line1 shadow-1 p-6"
        style={{ textAlign: "center" }}
      >
        <h1 className="text-title-auth text-text1 mt-0">Acesso negado (403)</h1>
        <p className="text-body text-text2">
          Você não tem a permissão necessária. A área financeira, por exemplo, exige a concessão
          explícita <code className="font-mono tnum text-[0.85em] text-text1">finance.read</code>.
        </p>
        <p className="mb-0">
          <Link
            href="/dashboard"
            className="inline-flex min-h-[44px] items-center justify-center rounded-base border border-line2 bg-bg2 px-4 text-body text-text1 no-underline hover:border-line3 focus-ring"
          >
            Voltar ao painel
          </Link>
        </p>
      </div>
    </main>
  );
}
