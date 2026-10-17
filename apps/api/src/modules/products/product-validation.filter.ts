import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';

/**
 * Traduz as mensagens do `ValidationPipe` para pt-BR — só no módulo de produtos.
 *
 * POR QUE UM FILTRO E NÃO UM `exceptionFactory` GLOBAL:
 * o `main.ts:42` monta um `ValidationPipe` com `forbidNonWhitelisted: true`
 * compartilhado por todos os módulos. Trocar o `exceptionFactory` global
 * reescreveria o contrato de erro de todo o sistema fora do escopo desta
 * mudança. Um `@UseFilters` no controller restringe o efeito ao que o operador
 * vê ao editar produto.
 *
 * O que traduz:
 * - `"<campo>" should not exist` (campo não declarado + whitelist estrita);
 * - os defaults do class-validator que escapam sem `message` customizada
 *   (ex.: `property platforms should be an array`).
 *
 * O que NÃO traduz: mensagens que já venham em português (DTOs deste módulo
 * declaram `message` em pt-BR) e códigos de erro em string.
 */
@Catch(HttpException)
export class ProductValidationPtBrFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse();
    const status = exception.getStatus();
    const body = exception.getResponse();

    if (typeof body === 'string' || !isRecord(body) || !Array.isArray(body['message'])) {
      res.status(status).json(body);
      return;
    }

    const translated = (body['message'] as unknown[])
      .map((m) => (typeof m === 'string' ? translate(m) : m))
      // remove duplicatas: o mesmo campo pode falhar em dois validators
      .filter((m, i, arr) => arr.indexOf(m) === i);

    res.status(status).json({ ...body, message: translated });
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** "property tags should not exist" → frase em pt-BR com o nome do campo. */
function translate(message: string): string {
  const notExist = /^property (\w+) should not exist$/.exec(message);
  if (notExist) {
    return `O campo "${notExist[1]}" não existe neste produto. Envie apenas os campos editáveis.`;
  }
  const generic = /^property (\w+) should be (.+)$/.exec(message);
  if (generic) {
    const [, field, expected] = generic;
    return `O campo "${field}" está inválido: deve ser ${expected}.`;
  }
  return message;
}
