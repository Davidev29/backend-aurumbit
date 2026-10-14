import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '../auth/jwt.service';
import { InMemorySessionLookup, SESSION_LOOKUP } from '../auth/session-lookup.port';
import { InMemoryMembershipLookup, MEMBERSHIP_LOOKUP } from '../auth/membership-lookup.port';
import { CustomerScopeGuard } from './customer-scope.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { MfaGuard } from './mfa.guard';
import { PgSessionLookup } from '../auth/pg-session-lookup';
import { RolesGuard } from './roles.guard';
import { SessionGuard } from './session.guard';
import { VerifiedEmailGuard } from './verified-email.guard';

/**
 * Cadeia de guards compartilhada (ordem de avaliação = ordem dos
 * providers APP_GUARD abaixo — ver `docs/ADR-002-guards.md`):
 * 1 JwtAuthGuard (401 sem claims iss/aud/exp/jti/sid válidas)
 * 2 SessionGuard (401 sessão ausente/revogada/expirada)
 * 3 MfaGuard (403 MFA_REQUIRED em rotas @RequireMfa)
 * 4 VerifiedEmailGuard (403 EMAIL_NOT_VERIFIED)
 * 5 RolesGuard (403 em rotas @Roles)
 * 6 CustomerScopeGuard (400/403 em rotas @CustomerScope)
 *
 * Guards 3–6 são seletivos (só agem com o marcador da rota) e pulam
 * rotas públicas (sem `request.user`). `InMemory*` é o provider default
 * das portas p/ testes; produção troca pelo adaptador Prisma (Fase 3)
 * sem tocar nos guards.
 */
@Module({
  providers: [
    JwtService,
    // `SESSION_LOOKUP`: sessões reais em PG por padrão (lazy, sem DB = deny);
    // testes/CI sem Postgres usam `AUTH_REPO=memory` (mesma convenção de auth.module).
    {
      provide: SESSION_LOOKUP,
      useClass: process.env.AUTH_REPO === 'memory' ? InMemorySessionLookup : PgSessionLookup,
    },
    { provide: MEMBERSHIP_LOOKUP, useClass: InMemoryMembershipLookup },
    // Classes registradas p/ injeção/export; APP_GUARD abaixo cria as
    // instâncias globais (mesma ordem de avaliação).
    JwtAuthGuard,
    SessionGuard,
    MfaGuard,
    VerifiedEmailGuard,
    RolesGuard,
    CustomerScopeGuard,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: MfaGuard },
    { provide: APP_GUARD, useClass: VerifiedEmailGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: CustomerScopeGuard },
  ],
  exports: [
    JwtService,
    SESSION_LOOKUP,
    MEMBERSHIP_LOOKUP,
    JwtAuthGuard,
    SessionGuard,
    MfaGuard,
    VerifiedEmailGuard,
    RolesGuard,
    CustomerScopeGuard,
  ],
})
export class GuardsModule {}
