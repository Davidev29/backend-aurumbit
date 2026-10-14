import { createHmac } from 'node:crypto';

// device_hash (PROJECT.md §4, LGPD.md): `HMAC(secret_rotativo,
// license_id || app_instance_id)`. O app envia só `app_instance_id`
// aleatório; nunca hardware cru (MAC/IMEI/serial). Formato do preimage
// (`${licenseId}.${appInstanceId}`) é contratual — mudança quebra vínculos.
export function computeDeviceHash(
  secret: string,
  licenseId: string,
  appInstanceId: string,
): string {
  if (!secret) throw new Error('device secret vazio — forneça via env/KMS.');
  return createHmac('sha256', secret)
    .update(`${licenseId}.${appInstanceId}`, 'utf8')
    .digest('hex');
}

/** Segredo rotativo via env; em produção a ausência é fail-fast. */
export function deviceSecret(): string {
  const s = process.env.LICENSING_DEVICE_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('LICENSING_DEVICE_SECRET ausente em produção (fail-fast).');
    }
    return 'test-only-device-secret';
  }
  return s;
}
