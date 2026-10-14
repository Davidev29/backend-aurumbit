import { SetMetadata } from '@nestjs/common';

/**
 * Exige ao menos uma das roles (convenção staff `STAFF_*`;
 * `finance.read`/`finance.manage` seguem PROJECT §3 — concessão explícita).
 */
export const ROLES_KEY = 'aurum:roles';
export const Roles = (...roles: string[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);
