import { Module, OnApplicationShutdown } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AUTH_REPOSITORY, IAuthRepository, InMemoryAuthRepository, PgAuthRepository } from './auth.repository';
import { AUTH_POOL, getSharedAuthPool, onAuthPoolShutdown } from './auth-pool.provider';
import { assertMfaEncKeyConfig, AuthService } from './auth.service';
import { JwtAuthGuard, SessionGuard } from './guards';
import { AuthRateLimitGuard } from './rate-limit';

function buildRepository(pool?: unknown): IAuthRepository {
  // Testes/CI sem Postgres: AUTH_REPO=memory. Padrão: pg lazy (DATABASE_URL_AUTH).
  if (process.env.AUTH_REPO === 'memory') return new InMemoryAuthRepository();
  // D2-5: o pool vem do provider (singleton compartilhado com PgSessionLookup),
  // não de um `new Pool()` dentro do repositório.
  return new PgAuthRepository(undefined, pool ?? null);
}

// D2-5: UM pool p/ o domínio auth, injetado no repositório (e o mesmo singleton
// de `getSharedAuthPool()` que o `PgSessionLookup` usa) — antes eram 2 pools
// contra o mesmo DATABASE_URL_AUTH, sem timeout, com espera infinita por conexão.
const poolProvider = { provide: AUTH_POOL, useFactory: () => getSharedAuthPool() };

const repositoryProvider = { provide: AUTH_REPOSITORY, useFactory: () => buildRepository(getSharedAuthPool()) };

const authServiceProvider = {
  provide: AuthService,
  useFactory: (repo: IAuthRepository) => {
    // D2-3(a): em produção o segredo TOTP exige chave dedicada (fail-fast).
    assertMfaEncKeyConfig();
    return new AuthService(repo, {
      jwtSecret: process.env.AUTH_JWT_SECRET ?? process.env.JWT_SECRET ?? 'dev-only-insecure-secret',
    });
  },
  inject: [AUTH_REPOSITORY],
};

/** D2-5(c): `pool.end()` no shutdown (idempotente — o pool é singleton). */
class AuthPoolShutdown implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await onAuthPoolShutdown();
  }
}

@Module({
  controllers: [AuthController],
  providers: [poolProvider, repositoryProvider, authServiceProvider, AuthPoolShutdown, JwtAuthGuard, SessionGuard, AuthRateLimitGuard],
  exports: [AuthService, AUTH_REPOSITORY, AUTH_POOL],
})
export class AuthModule {}
