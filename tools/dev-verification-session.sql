-- Sessao de verificacao local (NAO e parte do produto).
-- Reutiliza uma identidade ACTIVE ja existente: auth_sessions tem FK p/ user_identities.
INSERT INTO auth.auth_sessions (id, identity_id, family_id, device_label, status, expires_at, last_seen_at, "createdAt")
VALUES ('sess-dev-verify', '9ef82aa1-f30c-41dd-955f-18ea7b8ee817', 'fam-dev-verify', 'verificacao-local', 'ACTIVE', now() + interval '30 days', now(), now())
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE', expires_at = now() + interval '30 days'
RETURNING id, status;
