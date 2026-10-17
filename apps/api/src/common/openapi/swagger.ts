// Swagger UI servido pela própria API (docs/openapi.yaml como fonte da verdade).
//
// Por que ler o YAML em vez de gerar por decorators? A spec `docs/openapi.yaml`
// é curada à mão (contrato de integração com os programas gerenciados) e cobre
// a superfície estável de `/v1`; gerar por reflexão exigiria decorar ~145 rotas
// e ainda assim divergiria do documento publicado. Aqui a API apenas *serve*
// a spec já revisada — uma única fonte, sem drift.
//
// Segurança: a CSP hardenizada (`securityHelmetOptions`) é `default-src 'none'`
// e bloquearia o bundle do Swagger UI. O middleware abaixo troca a CSP **apenas**
// no caminho do Swagger UI; o resto da API segue intacto. Fora de produção o
// Swagger UI é ligado por padrão; em produção exige `SWAGGER_ENABLED=true`.
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { load as loadYaml } from 'js-yaml';

const logger = new Logger('Swagger');
const SPEC_RELATIVE = join('docs', 'openapi.yaml');

/** Sobe a árvore de diretórios procurando o caminho relativo (máx. `maxDepth`). */
function findUp(relative: string, start: string, maxDepth = 8): string | null {
  let dir = start;
  for (let i = 0; i <= maxDepth; i += 1) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Resolve a spec: `OPENAPI_SPEC_PATH` (absoluto ou relativo ao cwd) tem
 * prioridade; senão sobe a árvore a partir do cwd e do `__dirname`
 * (cobre dev `pnpm --filter api start` e prod `/app/apps/api` → `/app/docs`).
 */
export function resolveOpenApiSpecPath(): string | null {
  const explicit = process.env.OPENAPI_SPEC_PATH?.trim();
  if (explicit) {
    const path = isAbsolute(explicit) ? explicit : join(process.cwd(), explicit);
    return existsSync(path) ? path : null;
  }
  return findUp(SPEC_RELATIVE, process.cwd()) ?? findUp(SPEC_RELATIVE, __dirname);
}

/** Lê e faz parse do `docs/openapi.yaml`. Nunca lança: devolve `null` e loga. */
export function loadOpenApiDocument(): OpenAPIObject | null {
  const path = resolveOpenApiSpecPath();
  if (!path) {
    logger.warn(
      `Spec não encontrada (${SPEC_RELATIVE}); defina OPENAPI_SPEC_PATH p/ servir o Swagger UI.`,
    );
    return null;
  }
  try {
    const parsed = loadYaml(readFileSync(path, 'utf8')) as OpenAPIObject | undefined;
    if (!parsed || typeof parsed !== 'object' || !parsed.openapi || !parsed.paths) {
      logger.warn(`${path} não é um documento OpenAPI válido (falta openapi/paths).`);
      return null;
    }
    return parsed;
  } catch (err) {
    logger.warn(`Falha ao ler ${path}: ${(err as Error).message}`);
    return null;
  }
}

/** Ligado fora de produção por padrão; em produção só com `SWAGGER_ENABLED=true`. */
export function swaggerEnabled(): boolean {
  const flag = process.env.SWAGGER_ENABLED?.trim().toLowerCase();
  if (flag === 'true' || flag === '1') return true;
  if (flag === 'false' || flag === '0') return false;
  return process.env.NODE_ENV !== 'production';
}

function swaggerPath(): string {
  const raw = process.env.SWAGGER_PATH?.trim() ?? 'docs';
  return raw.replace(/^\/+|\/+$/g, '') || 'docs';
}

/** CSP própria do Swagger UI (único ponto da API que serve HTML/JS). */
function docsCspMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "connect-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  next();
}

/**
 * Monta o Swagger UI (`/{SWAGGER_PATH}`, default `/docs`) e a spec bruta
 * (`/docs-json`, `/docs-yaml`). No-op silencioso se desabilitado ou sem spec.
 */
export function registerSwagger(app: INestApplication): void {
  if (!swaggerEnabled()) {
    logger.log('Swagger UI desabilitado (SWAGGER_ENABLED=false).');
    return;
  }
  const document = loadOpenApiDocument();
  if (!document) return;

  const path = swaggerPath();
  // Registrado ANTES do setup: o middleware precisa vir primeiro na pilha do
  // Express p/ sobrepor a CSP do helmet nas respostas do Swagger UI.
  app.use(`/${path}`, docsCspMiddleware);
  SwaggerModule.setup(path, app, document, {
    customSiteTitle: 'Aurum Bit API v1',
    jsonDocumentUrl: `${path}-json`,
    yamlDocumentUrl: `${path}-yaml`,
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'none',
      filter: true,
      tryItOutEnabled: true,
    },
  });
  logger.log(`Swagger UI em /${path} (spec: /${path}-json · YAML: /${path}-yaml)`);
}
