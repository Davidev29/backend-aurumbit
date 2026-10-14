import { SetMetadata } from '@nestjs/common';

/** Marca rota/controller públicos (login, refresh, verify, health). Pula toda a cadeia. */
export const IS_PUBLIC_KEY = 'aurum:isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
