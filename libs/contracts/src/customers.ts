/**
 * Contratos zod — customers (Fase 2): perfil próprio (`me`) e convite p/ org.
 * Enums espelham `prisma/customers` (MembershipRole/Status). E-mail é
 * normalizado (NFKC + lowercase) na aplicação antes de persistir.
 */
import { z } from "zod";

export const MembershipRoleSchema = z.enum(["OWNER", "ADMIN", "FINANCE", "MEMBER"]);
export type MembershipRole = z.infer<typeof MembershipRoleSchema>;

export const MembershipStatusSchema = z.enum(["INVITED", "ACTIVE", "SUSPENDED", "REMOVED"]);
export type MembershipStatus = z.infer<typeof MembershipStatusSchema>;

/** `GET /v1/customers/me` — perfil PF + vínculos PJ (GDPR export usa este shape). */
export const MeOrganizationSchema = z.object({
  id: z.string().min(1),
  role: MembershipRoleSchema,
  status: MembershipStatusSchema,
});
export type MeOrganization = z.infer<typeof MeOrganizationSchema>;

export const MeResponseSchema = z.object({
  identityId: z.string().min(1),
  email: z.string().email().max(254),
  emailVerified: z.boolean(),
  organizations: z.array(MeOrganizationSchema),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const PatchMeSchema = z.object({
  name: z.string().max(200).optional(),
  email: z.string().email().max(320).optional(),
});
export type PatchMeRequest = z.infer<typeof PatchMeSchema>;

/** Convite p/ organização (`POST /v1/organizations/:id/invites`). */
export const OrgInviteSchema = z.object({
  /** Identidade convidada (opaca, `auth.UserIdentity.id`) ou e-mail p/ convite externo. */
  identityId: z.string().min(1).optional(),
  email: z.string().email().max(254).optional(),
  role: MembershipRoleSchema.default("MEMBER"),
});
export type OrgInviteRequest = z.infer<typeof OrgInviteSchema>;

export const OrgInviteResponseSchema = z.object({
  inviteId: z.string().min(1),
  organizationId: z.string().min(1),
  status: MembershipStatusSchema,
});
export type OrgInviteResponse = z.infer<typeof OrgInviteResponseSchema>;

export const UpdateMemberSchema = z.object({
  role: MembershipRoleSchema.optional(),
  status: MembershipStatusSchema.optional(),
});
export type UpdateMemberRequest = z.infer<typeof UpdateMemberSchema>;
