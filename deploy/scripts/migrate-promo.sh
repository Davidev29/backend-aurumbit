#!/usr/bin/env bash
set -euo pipefail
# Aplica migrations promocionais em licensing e billing (produção).
# Requer MIGRATOR_DATABASE_URL.
cd "$(dirname "$0")/../.."
echo "==> licensing"
psql "$MIGRATOR_DATABASE_URL" -f prisma/licensing/migrations/0003_promo_discount/migration.sql
echo "==> billing"
psql "$MIGRATOR_DATABASE_URL" -f prisma/billing/migrations/0004_promo_discount/migration.sql
echo "OK"