import { EffectiveAccessTable } from "@/components/usuarios/EffectiveAccessTable";

// TODO(backend pronto): listar `/v1/users` + grants escopados por org.
export default function UsuariosPage() {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-title-page text-text1">Usuários</h1>
      </div>
      <EffectiveAccessTable />
    </div>
  );
}
