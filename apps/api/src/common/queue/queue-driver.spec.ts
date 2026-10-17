/**
 * Driver de fila (achado N1 da auditoria de 2026-10-17).
 *
 * Prova que: (1) `bullmq` passou a resolver a partir de `apps/api` (era a causa
 * raiz — as factories caíam em in-memory em silêncio); (2) a escolha do driver é
 * explícita por `QUEUE_DRIVER`, com default `memory`; (3) a degradação NUNCA é
 * silenciosa — em produção o boot emite ERROR; (4) as factories de fila caem no
 * in-memory no default e não abrem conexão Redis.
 */
import { Logger } from '@nestjs/common';
import { InMemoryWebhookQueue, createWebhookQueue } from '../../modules/billing/webhook.queue';
import {
  InMemoryFinanceAutomationQueue,
  createFinanceAutomationQueue,
} from '../../modules/finance/finance-automation.queue';
import { InMemoryProjectionQueue, createProjectionQueue } from '../../modules/finance/projections.queue';
import { InMemoryFinanceSyncQueue, createFinanceSyncQueue } from '../../modules/finance/sync.queue';
import { RetentionCron } from '../../modules/retention/retention.cron';
import {
  QUEUE_DRIVERS,
  announceQueueDriver,
  loadBullMqQueueCtor,
  queueDriver,
  requireBullMqQueueCtor,
  resetQueueDriverAnnouncements,
} from './queue-driver';

const SAVED: Record<string, string | undefined> = {};
const KEYS = ['QUEUE_DRIVER', 'NODE_ENV'] as const;

beforeEach(() => {
  for (const k of KEYS) SAVED[k] = process.env[k];
  delete process.env.QUEUE_DRIVER;
  process.env.NODE_ENV = 'test';
  resetQueueDriverAnnouncements();
});

afterEach(() => {
  for (const k of KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
  resetQueueDriverAnnouncements();
  jest.restoreAllMocks();
});

describe('queueDriver', () => {
  it('default é memory — nada vai ao Redis sem opt-in explícito', () => {
    expect(queueDriver()).toBe('memory');
    process.env.QUEUE_DRIVER = '   ';
    expect(queueDriver()).toBe('memory');
  });

  it('aceita bullmq sem diferenciar caixa/espaços', () => {
    process.env.QUEUE_DRIVER = ' BULLMQ ';
    expect(queueDriver()).toBe('bullmq');
    process.env.QUEUE_DRIVER = 'Memory';
    expect(queueDriver()).toBe('memory');
  });

  it('valor inválido falha na hora (não vira default silencioso)', () => {
    process.env.QUEUE_DRIVER = 'redis';
    expect(() => queueDriver()).toThrow(/QUEUE_DRIVER inválido/);
  });

  it('lista canônica dos drivers', () => {
    expect([...QUEUE_DRIVERS]).toEqual(['memory', 'bullmq']);
  });
});

describe('bullmq é dependência real de apps/api (regressão do achado N1)', () => {
  it('o módulo bullmq resolve a partir de apps/api', () => {
    // Antes da correção isto devolvia `null` (dep ausente) e a fila virava no-op.
    expect(typeof loadBullMqQueueCtor()).toBe('function');
    expect(requireBullMqQueueCtor<unknown>('regressao').name).toBe('Queue');
  });
});

describe('factories no driver default (memory)', () => {
  it('as 4 filas caem no in-memory e não abrem conexão Redis', () => {
    expect(createWebhookQueue()).toBeInstanceOf(InMemoryWebhookQueue);
    expect(createFinanceSyncQueue()).toBeInstanceOf(InMemoryFinanceSyncQueue);
    expect(createProjectionQueue()).toBeInstanceOf(InMemoryProjectionQueue);
    expect(createFinanceAutomationQueue()).toBeInstanceOf(InMemoryFinanceAutomationQueue);
  });

  it('retenção: repeat do BullMQ não é registrado com memory', async () => {
    const cron = new RetentionCron();
    await expect(cron.registerRepeats()).resolves.toMatchObject({
      registered: false,
      queue: 'retention.daily',
    });
  });
});

describe('announceQueueDriver — degradação nunca silenciosa', () => {
  it('memory em produção emite ERROR citando a variável que liga o Redis', () => {
    process.env.NODE_ENV = 'production';
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    expect(announceQueueDriver('fila.teste')).toBe('memory');
    expect(error).toHaveBeenCalledTimes(1);
    const logged = String(error.mock.calls[0]?.[0] ?? '');
    expect(logged).toContain('queue.driver');
    expect(logged).toContain('QUEUE_DRIVER=bullmq');
  });

  it('memory fora de produção é log informativo (sem ERROR)', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    expect(announceQueueDriver('fila.teste')).toBe('memory');
    expect(error).not.toHaveBeenCalled();
    expect(String(log.mock.calls[0]?.[0] ?? '')).toContain('fila in-memory');
  });

  it('bullmq não emite ERROR de degradação, nem em produção', () => {
    process.env.NODE_ENV = 'production';
    process.env.QUEUE_DRIVER = 'bullmq';
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    expect(announceQueueDriver('fila.teste')).toBe('bullmq');
    expect(error).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('registra UMA vez por fila (não inunda o log)', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    announceQueueDriver('fila.teste');
    announceQueueDriver('fila.teste');
    announceQueueDriver('fila.teste');
    expect(log).toHaveBeenCalledTimes(1);
  });
});
