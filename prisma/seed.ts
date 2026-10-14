// Stub Fase 1 — cria admin demo (log apenas, sem regra de negócio).
// Seed real (9 DBs) entra no T4/Fase 2.

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@aurumbit.local';
  console.log(`[seed] stub Fase 1 — admin demo: ${adminEmail} (nada persistido)`);
}

main().catch((e) => {
  console.error('[seed] fail', e);
  process.exit(1);
});
