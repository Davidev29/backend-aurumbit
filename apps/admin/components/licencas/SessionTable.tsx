import { Table, Td, Th } from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/EmptyState";
import { formatDateTimeInTZ } from "@/lib/format";
import type { SessionView } from "@/lib/types";
import { HeartbeatDot } from "./HeartbeatDot";

/**
 * Sessões com heartbeat + última atividade (relativa + absoluta TZ).
 * IP sempre mascarado (`/24` p/ detecção — PROJECT §4, nunca raw na UI).
 */
export function SessionTable({ sessions, timeZone }: { sessions: SessionView[]; timeZone?: string }) {
  if (sessions.length === 0) {
    return <EmptyState title="Sem sessões" message="Nenhuma sessão registrada para este cliente." />;
  }
  return (
    <Table
      caption="Sessões (heartbeat + última atividade)"
      head={
        <>
          <Th>Dispositivo</Th>
          <Th>Heartbeat</Th>
          <Th>Última atividade (absoluta)</Th>
          <Th>IP</Th>
        </>
      }
    >
      {sessions.map((s) => (
        <tr key={s.id}>
          <Td>{s.deviceLabel}</Td>
          <Td>
            <HeartbeatDot lastActivity={s.lastActivity} timeZone={timeZone} />
          </Td>
          <Td>
            <time dateTime={s.lastActivity}>{formatDateTimeInTZ(s.lastActivity, timeZone)}</time>
          </Td>
          <Td mono>{s.ipMasked}</Td>
        </tr>
      ))}
    </Table>
  );
}
