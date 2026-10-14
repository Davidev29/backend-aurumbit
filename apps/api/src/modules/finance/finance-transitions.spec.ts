import {
  IllegalTransitionError,
  assertTransition,
  canTransition,
} from './finance-transitions';

describe('finance-transitions — receivable', () => {
  it('fluxo feliz: PREVISTO → PENDENTE → RECEBIDO', () => {
    expect(() => assertTransition('receivable', 'PREVISTO', 'PENDENTE')).not.toThrow();
    expect(() => assertTransition('receivable', 'PENDENTE', 'RECEBIDO')).not.toThrow();
  });

  it('inadimplência: PENDENTE → INADIMPLENTE → RECEBIDO', () => {
    expect(() => assertTransition('receivable', 'PENDENTE', 'INADIMPLENTE')).not.toThrow();
    expect(() => assertTransition('receivable', 'INADIMPLENTE', 'RECEBIDO')).not.toThrow();
  });

  it.each([
    ['RECEBIDO', 'PENDENTE'],
    ['RECEBIDO', 'CANCELADO'],
    ['CANCELADO', 'RECEBIDO'],
    ['CANCELADO', 'PREVISTO'],
    ['INADIMPLENTE', 'PENDENTE'],
    ['PREVISTO', 'INADIMPLENTE'],
  ])('ilegal: %s → %s (422 sem sobrescrever)', (from, to) => {
    expect(() => assertTransition('receivable', from, to)).toThrow(IllegalTransitionError);
    expect(canTransition('receivable', from, to)).toBe(false);
  });

  it('no-op é replay idempotente', () => {
    expect(canTransition('receivable', 'RECEBIDO', 'RECEBIDO')).toBe(true);
    expect(() => assertTransition('receivable', 'RECEBIDO', 'RECEBIDO')).not.toThrow();
  });
});

describe('finance-transitions — payable', () => {
  it('fluxo feliz: PREVISTO → PENDENTE → PAGO', () => {
    expect(() => assertTransition('payable', 'PREVISTO', 'PENDENTE')).not.toThrow();
    expect(() => assertTransition('payable', 'PENDENTE', 'PAGO')).not.toThrow();
  });

  it.each([
    ['PAGO', 'PENDENTE'],
    ['PAGO', 'CANCELADO'],
    ['CANCELADO', 'PAGO'],
    ['PREVISTO', 'RECEBIDO'],
  ])('ilegal: %s → %s (422 sem sobrescrever)', (from, to) => {
    expect(() => assertTransition('payable', from, to)).toThrow(IllegalTransitionError);
    expect(canTransition('payable', from, to)).toBe(false);
  });
});
