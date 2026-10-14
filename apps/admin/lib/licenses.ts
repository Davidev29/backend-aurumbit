import { apiPost } from "./api/client";
import type {
  AdjustMachinesRequest,
  BonusGrantRequest,
  LicenseRevealResponse,
  RenewRequest,
  RevokeRequest,
} from "./types";

/**
 * Ações de licença via BFF (`/api/licenses/*` → Nest `/v1/licenses/*` quando
 * `API_INTERNAL_URL` está configurado; stub auditado em `lib/mocks.ts` senão).
 *
 * Sem financeiro real: nenhuma rota aqui cria cobrança — ajuste/bônus/renovação
 * só mutam limites/vigência da licença (fonte real: backend + audit append-only).
 */

function idempotencyHeaders(): Record<string, string> {
  const key =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { "Idempotency-Key": key };
}

/** Revelação auditada (PROJECT §2: exige `license.read` + MFA, rate-limit 10/h no backend). */
export function revealLicense(licenseId: string, motivo?: string): Promise<LicenseRevealResponse> {
  return apiPost<LicenseRevealResponse>(
    `/api/licenses/${encodeURIComponent(licenseId)}/reveal`,
    motivo ? { motivo } : {},
    { headers: idempotencyHeaders() },
  );
}

/** Ajuste de limite de máquinas (exige `license.adjust`; justificativa >= 10 — REQUIREMENTS §5). */
export function adjustMachines(licenseId: string, req: AdjustMachinesRequest): Promise<{ machinesAllowed: number }> {
  return apiPost(
    `/api/licenses/${encodeURIComponent(licenseId)}/adjust`,
    req,
    { headers: idempotencyHeaders() },
  );
}

/** Bônus de acesso (exige `bonus.grant`; motivo >= 10; `endsAt null` = vitalícia revogável). */
export function grantBonus(licenseId: string, req: BonusGrantRequest): Promise<{ bonusId: string }> {
  return apiPost(
    `/api/licenses/${encodeURIComponent(licenseId)}/bonus`,
    req,
    { headers: idempotencyHeaders() },
  );
}

/** Renovação em graça mantém continuidade (`starts_at = max(now, expires_at)` — PROJECT §1). */
export function renewLicense(licenseId: string, req: RenewRequest): Promise<{ expiresAt: string }> {
  return apiPost(
    `/api/licenses/${encodeURIComponent(licenseId)}/renew`,
    req,
    { headers: idempotencyHeaders() },
  );
}

/** Revogação: bump `token_version`, invalida JWTs/offline-tokens no próximo online (PROJECT §2). */
export function revokeLicense(licenseId: string, req: RevokeRequest): Promise<{ revoked: boolean }> {
  return apiPost(
    `/api/licenses/${encodeURIComponent(licenseId)}/revoke`,
    req,
    { headers: idempotencyHeaders() },
  );
}
