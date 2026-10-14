// Política pura de detecção de clone (Fase 3, PROJECT.md §4). Sem I/O — coberta por unit test.
// Sinais (qualquer um marca `cloned_suspect`):
// - `future-iat`: token/offline apresentado com iat além da tolerância de relógio (5min).
// - `ctr-rollback`: contador do token < último contador visto (replay/rollback).
// - `impossible-travel`: país (geo-IP aproximada, só em memória) trocou em < 2h.
// Geo-IP nunca persiste como localização do usuário; só o sinal vai p/ `cloned_evidence`.

import { FUTURE_IAT_SKEW_S } from './offline-jwt';

export const CLONE_FUTURE_IAT_SKEW_S = FUTURE_IAT_SKEW_S;
/** Troca de país em menos de 2h = deslocamento impossível (sinal, não prova). */
export const IMPOSSIBLE_TRAVEL_MS = 2 * 3600_000;

export type CloneDeviceState = {
  lastSeenAt: Date | string | null;
  lastCountry: string | null;
  lastCtr: number | null;
};

export type CloneSighting = {
  at?: Date;
  country?: string | null;
  tokenIatS?: number | null; // iat (epoch s) do token apresentado, se houver
  ctr?: number | null; // contador do token apresentado, se houver
};

export type CloneVerdict = {
  suspect: boolean;
  reasons: Array<'future-iat' | 'ctr-rollback' | 'impossible-travel'>;
  evidence: Record<string, unknown>;
};

function toMs(v: Date | string | null | undefined): number | null {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v as string);
  return Number.isNaN(t) ? null : t;
}

export function detectCloneSuspect(
  prev: CloneDeviceState | null,
  cur: CloneSighting,
  now: Date = new Date(),
): CloneVerdict {
  const reasons: CloneVerdict['reasons'] = [];
  const evidence: Record<string, unknown> = {};
  const nowS = Math.floor(now.getTime() / 1000);

  if (typeof cur.tokenIatS === 'number' && cur.tokenIatS - nowS > CLONE_FUTURE_IAT_SKEW_S) {
    reasons.push('future-iat');
    evidence.futureIat = { presentedIat: cur.tokenIatS, serverNow: nowS, skewS: CLONE_FUTURE_IAT_SKEW_S };
  }

  if (
    typeof cur.ctr === 'number' &&
    prev?.lastCtr !== null &&
    prev?.lastCtr !== undefined &&
    cur.ctr < (prev.lastCtr as number)
  ) {
    reasons.push('ctr-rollback');
    evidence.ctrRollback = { presentedCtr: cur.ctr, lastCtr: prev.lastCtr };
  }

  const prevCountry = prev?.lastCountry ?? null;
  const curCountry = cur.country ?? null;
  if (prevCountry && curCountry && prevCountry !== curCountry) {
    const prevMs = toMs(prev?.lastSeenAt ?? null);
    const curMs = cur.at ? cur.at.getTime() : now.getTime();
    if (prevMs !== null && curMs - prevMs < IMPOSSIBLE_TRAVEL_MS) {
      reasons.push('impossible-travel');
      // Guarda só o sinal (par de países + delta), nunca localização precisa.
      evidence.impossibleTravel = {
        fromCountry: prevCountry,
        toCountry: curCountry,
        deltaMs: curMs - prevMs,
        note: 'geo-IP aproximada, só sinal — ver PROJECT.md §4',
      };
    }
  }

  return { suspect: reasons.length > 0, reasons, evidence };
}
