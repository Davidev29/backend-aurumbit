import { SetMetadata } from '@nestjs/common';

/**
 * Exige escopo de organização: o guard resolve `X-Org-Id` + membership
 * ACTIVE e anexa `request.org = { id, role }`. Sem o marcador, o guard pula.
 */
export const CUSTOMER_SCOPE_KEY = 'aurum:customerScope';
export const CustomerScope = (): MethodDecorator & ClassDecorator => SetMetadata(CUSTOMER_SCOPE_KEY, true);

/** Rotas autenticadas acessíveis mesmo sem e-mail verificado (ex. reenvio). */
export const ALLOW_UNVERIFIED_KEY = 'aurum:allowUnverified';
export const AllowUnverified = (): MethodDecorator & ClassDecorator => SetMetadata(ALLOW_UNVERIFIED_KEY, true);
