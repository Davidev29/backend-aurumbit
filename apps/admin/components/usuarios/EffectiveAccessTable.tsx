import { Badge } from "@/components/ui/Badge";
import { Table, Td, Th } from "@/components/ui/table";
import { MOCK_EFFECTIVE_ACCESS, MOCK_USERS } from "@/lib/mocks";
import { RoleBadge } from "./RoleBadge";

/**
 * Acesso efetivo por usuário (stub). Fonte real: `RoleGrant`/backend Fase 2+.
 * `finance.read` aparece só com concessão explícita (PROJECT §3).
 */
export function EffectiveAccessTable() {
  return (
    <Table
      caption="Acesso efetivo por usuário"
      head={
        <>
          <Th>Usuário</Th>
          <Th>Papel</Th>
          <Th>Permissões efetivas</Th>
        </>
      }
    >
      {MOCK_USERS.map((u) => (
        <tr key={u.id}>
          <Td>
            {u.name}
            <span className="block text-callout text-text2">{u.email}</span>
          </Td>
          <Td>
            <RoleBadge role={u.role} />
          </Td>
          <Td>
            {(MOCK_EFFECTIVE_ACCESS[u.id] ?? []).length === 0 ? (
              <span className="text-callout text-text2">nenhuma</span>
            ) : (
              <span className="inline-flex flex-wrap gap-1">
                {(MOCK_EFFECTIVE_ACCESS[u.id] ?? []).map((p) => (
                  <Badge key={p} tone="neutral">
                    <span className="font-mono tnum text-[0.85em]">{p}</span>
                  </Badge>
                ))}
              </span>
            )}
          </Td>
        </tr>
      ))}
    </Table>
  );
}
