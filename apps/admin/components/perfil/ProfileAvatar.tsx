"use client";

import { useRef, useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { initialsOf, useProfileStore } from "@/stores/profile-store";
import { cn } from "@/lib/cn";

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Avatar do perfil: foto 1:1 (preview em sessão via FileReader) ou iniciais.
 * Backend real usa object storage + CDN (TODO) — nunca persiste bytes crus.
 */
export function ProfileAvatar({ size = 96, editable = true }: { size?: number; editable?: boolean }) {
  const fotoPreviewUrl = useProfileStore((s) => s.fotoPreviewUrl);
  const nomeExibicao = useProfileStore((s) => s.nomeExibicao);
  const setPhoto = useProfileStore((s) => s.setPhoto);
  const removePhoto = useProfileStore((s) => s.removePhoto);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const initials = initialsOf(nomeExibicao || "?");

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Escolha uma imagem (PNG ou JPG).");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Imagem até 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setError(null);
      setPhoto(typeof reader.result === "string" ? reader.result : null, file.name);
    };
    reader.onerror = () => setError("Não foi possível ler a imagem.");
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex items-center gap-4">
      <span
        aria-label={fotoPreviewUrl ? `Foto de ${nomeExibicao || "perfil"}` : `Iniciais de ${nomeExibicao || "perfil"}`}
        role="img"
        className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-line2 bg-accentsoft text-text1"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.32), fontWeight: 700 }}
      >
        {fotoPreviewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fotoPreviewUrl} alt="" aria-hidden="true" className="h-full w-full object-cover" />
        ) : (
          <span aria-hidden="true">{initials}</span>
        )}
      </span>
      {editable && (
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              title="Escolher foto de perfil (PNG/JPG até 2 MB)"
              className="focus-ring inline-flex min-h-[44px] items-center gap-2 rounded-base border border-line2 bg-bg2 px-4 text-body text-text1 hover:border-line3"
            >
              <Camera size={16} strokeWidth={1.75} aria-hidden="true" />
              Alterar foto
            </button>
            {fotoPreviewUrl && (
              <button
                type="button"
                onClick={removePhoto}
                title="Remover foto de perfil"
                className={cn(
                  "focus-ring inline-flex min-h-[44px] items-center gap-2 rounded-base border border-danger",
                  "bg-dangersoft px-4 text-body font-semibold text-danger hover:brightness-125",
                )}
              >
                <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                Remover
              </button>
            )}
          </div>
          <p className="m-0 mt-1 text-callout text-text2">
            PNG/JPG até 2 MB. Pré-visualização local — o envio definitivo usa object storage (em breve).
          </p>
          {error && (
            <p className="m-0 mt-1 text-callout text-danger" role="alert">
              {error}
            </p>
          )}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" aria-label="Escolher foto de perfil" onChange={onPick} />
        </div>
      )}
    </div>
  );
}
