import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AUTH_REPOSITORY, IAuthRepository, InMemoryAuthRepository, PgAuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { JwtAuthGuard, SessionGuard } from './guards';
import { AuthRateLimitGuard } from './rate-limit';

function buildRepository(): IAuthRepository {
  // Testes/CI sem Postgres: AUTH_REPO=memory. Padrão: pg lazy (DATABASE_URL_AUTH).
  if (process.env.AUTH_REPO === 'memory') return new InMemoryAuthRepository();
  return new PgAuthRepository();
}

const repositoryProvider = { provide: AUTH_REPOSITORY, useFactory: () => buildRepository() };

const authServiceProvider = {
  provide: AuthService,
  useFactory: (repo: IAuthRepository) =>
    new AuthService(repo, {
      jwtSecret: process.env.AUTH_JWT_SECRET ?? process.env.JWT_SECRET ?? 'dev-only-insecure-secret',
    }),
  inject: [AUTH_REPOSITORY],
};

@Module({
  controllers: [AuthController],
  providers: [repositoryProvider, authServiceProvider, JwtAuthGuard, SessionGuard, AuthRateLimitGuard],
  exports: [AuthService, AUTH_REPOSITORY],
})
export class AuthModule {}
