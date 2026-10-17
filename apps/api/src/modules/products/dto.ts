import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { PRODUCT_DELIVERY_MODES, PRODUCT_PLATFORM_IDS } from './platform-catalog.generated';

export { PRODUCT_DELIVERY_MODES, PRODUCT_PLATFORM_IDS };
export type { ProductDeliveryMode, ProductPlatformId } from './platform-catalog.generated';

/**
 * Catálogo canônico de plataformas (fail-closed na borda) — artefato GERADO.
 *
 * FONTE ÚNICA: `libs/contracts/src/products.catalog.json` (o contrato zod em
 * `libs/contracts/src/products.ts` valida o mesmo dado). Este arquivo NÃO lista
 * ids à mão: reexporta `./platform-catalog.generated`, produzido por
 * `tools/sync-platform-catalog.mjs` (`pnpm catalog:sync`); o CI reprova drift
 * com `pnpm catalog:check`.
 *
 * Os ids são ESTÁVEIS e vão para `products.platforms` — são os mesmos ids do
 * catálogo de ícones (`tools/build-tag-icons.py`). Nunca renomear.
 */

export class CreateProductDto {
  @IsString({ message: 'O código deve ser um texto.' })
  @MinLength(2, { message: 'O código deve ter pelo menos 2 caracteres.' })
  @MaxLength(64, { message: 'O código deve ter no máximo 64 caracteres.' })
  code!: string;

  @IsString({ message: 'O nome deve ser um texto.' })
  @MinLength(2, { message: 'O nome deve ter pelo menos 2 caracteres.' })
  @MaxLength(120, { message: 'O nome deve ter no máximo 120 caracteres.' })
  name!: string;

  @IsString({ message: 'O slug deve ser um texto.' })
  @MinLength(2, { message: 'O slug deve ter pelo menos 2 caracteres.' })
  @MaxLength(120, { message: 'O slug deve ter no máximo 120 caracteres.' })
  slug!: string;

  @IsOptional()
  @IsString({ message: 'A descrição deve ser um texto.' })
  @MaxLength(500, { message: 'A descrição deve ter no máximo 500 caracteres.' })
  description?: string;

  @IsOptional()
  @IsIn(['DRAFT', 'ACTIVE'], { message: 'Situação inválida. Use DRAFT ou ACTIVE.' })
  status?: string;

  // Limite padrão de máquinas por licença (admin/BFF validam 1..100).
  @IsOptional()
  @IsInt({ message: 'O limite de máquinas deve ser um número inteiro.' })
  @Min(1, { message: 'O limite de máquinas deve ser no mínimo 1.' })
  @Max(100, { message: 'O limite de máquinas deve ser no máximo 100.' })
  machinesAllowed?: number;

  // Slugs de plataforma do catálogo (`@IsIn(..., { each: true })` = fail-closed:
  // id desconhecido é 400, nunca "aceita e ignora"). O service ainda revalida
  // (defesa em profundidade p/ chamadas internas que não passam pelo pipe).
  @IsOptional()
  @IsArray({ message: 'As plataformas devem ser uma lista.' })
  @ArrayMaxSize(PRODUCT_PLATFORM_IDS.length, {
    message: `Escolha no máximo ${PRODUCT_PLATFORM_IDS.length} plataformas.`,
  })
  @IsString({ each: true, message: 'Cada plataforma deve ser um texto.' })
  @IsIn([...PRODUCT_PLATFORM_IDS], {
    each: true,
    message: `Plataforma inválida. Use: ${PRODUCT_PLATFORM_IDS.join(', ')}.`,
  })
  platforms?: string[];

  @IsOptional()
  @IsIn([...PRODUCT_DELIVERY_MODES], {
    message: `Modo de entrega inválido. Use: ${PRODUCT_DELIVERY_MODES.join(' ou ')}.`,
  })
  deliveryMode?: string;
}

/* ==========================================================================
 * PATCH / PUT /v1/products/:code — atualização do produto (Lane E)
 * ========================================================================== */

/**
 * Slug é URL PÚBLICA (SEO): formato travado no mesmo regex que o admin valida
 * antes de enviar (`CreateProductDialog.slugValid`), para o gateway nunca
 * gravar um slug que a UI considere válido e a URL não resolva.
 *
 * Fail-closed: `Aurum Pro`, `aurum_pro` e `aurum--pro` são recusados (400 do
 * `ValidationPipe` na borda; 422 do service em chamada interna) — nunca
 * "normalizados", porque salvar em silêncio com outro texto do que o operador
 * digitou é pior que recusar.
 */
export const PRODUCT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Campos PROIBIDOS em qualquer escrita de produto, com o motivo que vai para o
 * cliente (a mesma fonte serve o DTO — 400 na borda — e o service — 422 em
 * chamada interna que não passa pelo `ValidationPipe`).
 *
 * Motivos (não são estilo, são DADO de outros domínios):
 * - `code`: `licenses.productId`, `access.ContractItem.productId` e as linhas
 *   de plano gravam o code do produto. Renomear deixa órfãs todas as
 *   licenças emitidas (ver `product-licenses.controller.ts:17-19`).
 * - `status`: arquivar tem endpoint próprio, destrutivo e em 2 passos.
 * - preço: catálogo imutável (`.planning/REQUIREMENTS.md` §2) — novo preço é
 *   `POST /v1/products/:code/plans` + activate.
 */
export const PRODUCT_IMMUTABLE_FIELDS: Readonly<Record<string, string>> = {
  code:
    'O código do produto é imutável: licenças emitidas e contratos gravam esse código. Renomear deixaria todas as licenças órfãs — crie um produto novo.',
  status:
    'A situação do produto não é editada aqui: use o arquivamento (POST /v1/products/:code/archive), que é destrutivo e pede confirmação.',
  priceCents:
    'O preço é imutável por linha de catálogo: para mudá-lo, crie uma nova linha de plano (POST /v1/products/:code/plans) e ative-a.',
  monthlyPriceCents:
    'O preço é imutável por linha de catálogo: para mudá-lo, crie uma nova linha de plano (POST /v1/products/:code/plans) e ative-a.',
  annualPriceCents:
    'O preço é imutável por linha de catálogo: para mudá-lo, crie uma nova linha de plano (POST /v1/products/:code/plans) e ative-a.',
};

/**
 * Recusa a presença de um campo IMUTÁVEL, com o motivo na resposta.
 *
 * Por que declarado no DTO e não só no service: o `ValidationPipe` global roda
 * com `forbidNonWhitelisted: true`, então campo não declarado morre no
 * genérico "property code should not exist" — que não diz por que o campo é
 * proibido nem qual é o caminho certo (criar produto novo / endpoint de
 * archive / nova linha de plano). Declarado aqui, o operador recebe a frase
 * que explica a consequência.
 *
 * Ausente (`undefined`/`null`) = ok, para o patch parcial continuar valendo.
 */
@ValidatorConstraint({ name: 'immutableProductField', async: false })
export class ImmutableProductFieldConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    return args.value === undefined || args.value === null;
  }

  defaultMessage(args: ValidationArguments): string {
    return (
      PRODUCT_IMMUTABLE_FIELDS[args.property] ??
      `campo "${args.property}" não é editável em produto`
    );
  }
}

/** Marcador de campo proibido (o motivo vem do `defaultMessage` da constraint). */
function Immutable(): PropertyDecorator {
  return Validate(ImmutableProductFieldConstraint);
}

/**
 * `PATCH /v1/products/:code` — atualização PARCIAL: só os campos presentes no
 * corpo mudam; ausente = preservado. `description: null` limpa o texto.
 *
 * Os campos proibidos ficam declarados (§`PRODUCT_IMMUTABLE_FIELDS`) para
 * devolver 400 com o motivo certo em vez do genérico do `forbidNonWhitelisted`.
 * Os dois DTOs (PATCH e PUT) declaram os campos explicitamente em vez de
 * herdar de uma classe-base: a lista branca do `ValidationPipe` é metadado por
 * classe, e 6 campos repetidos são mais baratos de auditar do que a herança
 * decidir se `code` continua barrado.
 */
export class UpdateProductDto {
  @IsOptional()
  @IsString({ message: 'O nome deve ser um texto.' })
  @MinLength(2, { message: 'O nome deve ter pelo menos 2 caracteres.' })
  @MaxLength(120, { message: 'O nome deve ter no máximo 120 caracteres.' })
  name?: string;
  @IsOptional()
  @IsString({ message: 'O slug deve ser um texto.' })
  @Matches(PRODUCT_SLUG_PATTERN, {
    message: 'O slug deve usar apenas letras minúsculas, números e hífen simples (ex.: "aurum-pro").',
  })
  @MaxLength(120, { message: 'O slug deve ter no máximo 120 caracteres.' })
  slug?: string;

  /** `null` limpa a descrição (PATCH: ausente = preserva). */
  @IsOptional()
  @IsString({ message: 'A descrição deve ser um texto.' })
  @MaxLength(500, { message: 'A descrição deve ter no máximo 500 caracteres.' })
  description?: string | null;

  @IsOptional()
  @IsInt({ message: 'O limite de máquinas deve ser um número inteiro.' })
  @Min(1, { message: 'O limite de máquinas deve ser no mínimo 1.' })
  @Max(100, { message: 'O limite de máquinas deve ser no máximo 100.' })
  machinesAllowed?: number;

  @IsOptional()
  @IsArray({ message: 'As plataformas devem ser uma lista.' })
  @ArrayMaxSize(PRODUCT_PLATFORM_IDS.length, {
    message: `Escolha no máximo ${PRODUCT_PLATFORM_IDS.length} plataformas.`,
  })
  @IsString({ each: true, message: 'Cada plataforma deve ser um texto.' })
  @IsIn([...PRODUCT_PLATFORM_IDS], {
    each: true,
    message: `Plataforma inválida. Use: ${PRODUCT_PLATFORM_IDS.join(', ')}.`,
  })
  platforms?: string[];

  @IsOptional()
  @IsIn([...PRODUCT_DELIVERY_MODES], {
    message: `Modo de entrega inválido. Use: ${PRODUCT_DELIVERY_MODES.join(' ou ')}.`,
  })
  deliveryMode?: string;

  @Immutable()
  code?: never;

  @Immutable()
  status?: never;

  @Immutable()
  priceCents?: never;

  @Immutable()
  monthlyPriceCents?: never;

  @Immutable()
  annualPriceCents?: never;
}

/**
 * `PUT /v1/products/:code` — SUBSTITUIÇÃO TOTAL: `name`, `slug`,
 * `description`, `machinesAllowed`, `platforms` e `deliveryMode` são todos
 * obrigatórios.
 *
 * A presença de TODOS eles é exigida no service (400 com a lista do que falta)
 * e não por `@IsDefined()` aqui, porque `@IsDefined` devolveria 5 mensagens
 * genéricas do class-validator ("name should not be null or undefined")
 * em vez de uma frase que o operador entende ("faltam: platforms, deliveryMode").
 * As VALORES seguem validados aqui normalmente — só a presença é do service.
 */
export class ReplaceProductDto {
  @IsOptional()
  @IsString({ message: 'O nome deve ser um texto.' })
  @MinLength(2, { message: 'O nome deve ter pelo menos 2 caracteres.' })
  @MaxLength(120, { message: 'O nome deve ter no máximo 120 caracteres.' })
  name?: string;
  @IsOptional()
  @IsString({ message: 'O slug deve ser um texto.' })
  @Matches(PRODUCT_SLUG_PATTERN, {
    message: 'O slug deve usar apenas letras minúsculas, números e hífen simples (ex.: "aurum-pro").',
  })
  @MaxLength(120, { message: 'O slug deve ter no máximo 120 caracteres.' })
  slug?: string;

  /** `null` é valor VÁLIDO e limpa a descrição; AUSENTE é o que o PUT proíbe. */
  @IsOptional()
  @IsString({ message: 'A descrição deve ser um texto.' })
  @MaxLength(500, { message: 'A descrição deve ter no máximo 500 caracteres.' })
  description?: string | null;

  @IsOptional()
  @IsInt({ message: 'O limite de máquinas deve ser um número inteiro.' })
  @Min(1, { message: 'O limite de máquinas deve ser no mínimo 1.' })
  @Max(100, { message: 'O limite de máquinas deve ser no máximo 100.' })
  machinesAllowed?: number;

  @IsOptional()
  @IsArray({ message: 'As plataformas devem ser uma lista.' })
  @ArrayMaxSize(PRODUCT_PLATFORM_IDS.length, {
    message: `Escolha no máximo ${PRODUCT_PLATFORM_IDS.length} plataformas.`,
  })
  @IsString({ each: true, message: 'Cada plataforma deve ser um texto.' })
  @IsIn([...PRODUCT_PLATFORM_IDS], {
    each: true,
    message: `Plataforma inválida. Use: ${PRODUCT_PLATFORM_IDS.join(', ')}.`,
  })
  platforms?: string[];

  @IsOptional()
  @IsIn([...PRODUCT_DELIVERY_MODES], {
    message: `Modo de entrega inválido. Use: ${PRODUCT_DELIVERY_MODES.join(' ou ')}.`,
  })
  deliveryMode?: string;

  @Immutable()
  code?: never;

  @Immutable()
  status?: never;

  @Immutable()
  priceCents?: never;

  @Immutable()
  monthlyPriceCents?: never;

  @Immutable()
  annualPriceCents?: never;
}

export class CreateVersionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  version!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  changelog?: string;
}

export class PlanFeatureInput {
  @IsString()
  @MinLength(1)
  featureCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  value?: string;
}

export class CreatePlanDto {
  @IsString()
  @MinLength(1)
  productCode!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(64)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  // IMUTÁVEL: não existe endpoint de update de preço; novo preço = nova linha.
  @IsInt()
  @Min(0)
  priceCents!: number;

  @IsIn(['MONTH', 'YEAR', 'ONE_TIME'])
  billingInterval!: string;

  @IsDateString()
  validFrom!: string;

  @IsOptional()
  @IsDateString()
  validTo?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PlanFeatureInput)
  features?: PlanFeatureInput[];
}

export class ArchivePlanDto {
  // Linha sucessora (nova linha de catálogo que substitui esta).
  @IsOptional()
  @IsString()
  @MinLength(1)
  supersededBy?: string;
}

export class CreateFeatureDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsIn(['BOOLEAN', 'QUOTA', 'LIMIT'])
  kind!: string;

  // Fase 8: canal da capability. Omitido = BOTH (legado, sem gating).
  @IsOptional()
  @IsIn(['WEB', 'DESKTOP', 'BOTH'])
  channel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  unit?: string;
}
