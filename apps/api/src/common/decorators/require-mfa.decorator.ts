import { SetMetadata } from '@nestjs/common';

/** Exige step-up MFA na rota (`amr` do JWT deve conter `mfa`). */
export const REQUIRE_MFA_KEY = 'aurum:requireMfa';
export const RequireMfa = (): MethodDecorator & ClassDecorator => SetMetadata(REQUIRE_MFA_KEY, true);
