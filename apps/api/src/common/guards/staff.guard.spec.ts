import { ForbiddenException } from '@nestjs/common';
import { StaffGuard, allowedStaffEmails } from './staff.guard';
import type { StaffDirectory } from './staff.guard';

function ctxWith(user: unknown): ExecutionContextLike {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContextLike;
}

type ExecutionContextLike = import('@nestjs/common').ExecutionContext;

const directory = (email: string | null): StaffDirectory => ({
  emailOf: async () => email,
});

describe('StaffGuard', () => {
  const prev = process.env.ADMIN_STAFF_EMAILS;
  afterEach(() => {
    if (prev === undefined) delete process.env.ADMIN_STAFF_EMAILS;
    else process.env.ADMIN_STAFF_EMAILS = prev;
  });

  it('sem identidade: 403 (nunca "sem token = staff")', async () => {
    process.env.ADMIN_STAFF_EMAILS = 'staff@aurum.test';
    await expect(new StaffGuard(directory('staff@aurum.test')).canActivate(ctxWith(undefined))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('role STAFF_* no JWT: passa sem consultar o diretório', async () => {
    delete process.env.ADMIN_STAFF_EMAILS;
    const guard = new StaffGuard({
      emailOf: async () => {
        throw new Error('não deveria consultar o diretório com role');
      },
    });
    await expect(
      guard.canActivate(ctxWith({ identityId: 'id-1', roles: ['STAFF_ADMIN'] })),
    ).resolves.toBe(true);
  });

  it('e-mail na allowlist: passa (case-insensitive)', async () => {
    process.env.ADMIN_STAFF_EMAILS = 'Financeiro@Aurum.test,suporte@aurum.test';
    await expect(
      new StaffGuard(directory('financeiro@aurum.test')).canActivate(ctxWith({ identityId: 'id-2', roles: [] })),
    ).resolves.toBe(true);
  });

  it('e-mail fora da allowlist: 403 (cliente do portal NÃO acessa)', async () => {
    process.env.ADMIN_STAFF_EMAILS = 'staff@aurum.test';
    await expect(
      new StaffGuard(directory('cliente@aurum.test')).canActivate(ctxWith({ identityId: 'id-3', roles: [] })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allowlist vazia: fail-closed com STAFF_NOT_CONFIGURED', async () => {
    delete process.env.ADMIN_STAFF_EMAILS;
    await expect(
      new StaffGuard(directory('staff@aurum.test')).canActivate(ctxWith({ identityId: 'id-4', roles: [] })),
    ).rejects.toMatchObject({ response: { code: 'STAFF_NOT_CONFIGURED' } });
  });

  it('diretório sem e-mail resolve: 403', async () => {
    process.env.ADMIN_STAFF_EMAILS = 'staff@aurum.test';
    await expect(
      new StaffGuard(directory(null)).canActivate(ctxWith({ identityId: 'id-5', roles: [] })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allowedStaffEmails ignora vazios/espaços', () => {
    process.env.ADMIN_STAFF_EMAILS = ' a@x.test , ,b@x.test ';
    expect([...allowedStaffEmails()]).toEqual(['a@x.test', 'b@x.test']);
  });
});