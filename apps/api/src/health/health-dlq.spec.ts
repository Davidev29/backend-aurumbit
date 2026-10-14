import { dlqReadyStatus } from './health-dlq';

describe('ready com DLQ (Fase 6)', () => {
  it('sem pendentes → warn false (readiness só depende de PG+Redis)', () => {
    expect(dlqReadyStatus({})).toEqual({ pending: 0, perQueue: {}, warn: false });
  });

  it('com pendentes → warn true com profundidade por fila (sem 503 sozinha)', () => {
    const out = dlqReadyStatus({ 'billing.dlq': 2, 'finance.dlq': 1 });
    expect(out.pending).toBe(3);
    expect(out.warn).toBe(true);
    expect(out.perQueue).toEqual({ 'billing.dlq': 2, 'finance.dlq': 1 });
  });

  it('filas zeradas são omitidas do envelope', () => {
    const out = dlqReadyStatus({ 'billing.dlq': 0, 'comm.email.dlq': 4 });
    expect(out).toEqual({ pending: 4, perQueue: { 'comm.email.dlq': 4 }, warn: true });
  });
});
