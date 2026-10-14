"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, PasswordInput } from "@/components/ui/Field";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { mfaRequired?: boolean; message?: string };
      if (!res.ok) throw new Error(data.message ?? "Falha no login.");
      router.push(data.mfaRequired ? "/mfa" : "/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="w-full max-w-[25rem] rounded-card bg-bg1 border border-line1 shadow-1 p-6">
      <div className="flex items-center gap-3 mb-4">
        <div
          aria-hidden="true"
          className="w-11 h-11 rounded-base bg-accent text-accentink flex items-center justify-center text-headline font-extrabold"
        >
          A
        </div>
        <div>
          <p className="m-0 text-headline text-text1 font-semibold">Aurum Bit</p>
          <p className="m-0 text-callout text-text2">Terminal administrativo</p>
        </div>
      </div>
      <h1 className="text-title-auth text-text1 m-0 mb-1">Bem-vindo de volta</h1>
      <p className="text-body text-text2 mt-0 mb-5">
        Entre com suas credenciais para gerenciar produtos, licenças e cobranças.
      </p>
      <form onSubmit={submit}>
        <Field label="E-mail" htmlFor="email" hint="O mesmo e-mail do seu usuário administrativo.">
          <Input
            id="email"
            type="email"
            autoComplete="username"
            placeholder="voce@empresa.com.br"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Senha" htmlFor="password" hint="Sua senha + verificação em duas etapas.">
          <PasswordInput
            id="password"
            autoComplete="current-password"
            placeholder="••••••••"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && (
          <p className="flex items-center gap-2 text-callout text-danger mt-0 mb-4" role="alert">
            <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
            {error}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          disabled={pending}
          title={pending ? "Entrando…" : "Entrar"}
        >
          {pending ? "Entrando…" : "Entrar"}
        </Button>
      </form>
      <p className="text-callout text-text2 mb-0 mt-5">Protegido por verificação em duas etapas.</p>
    </div>
  );
}
