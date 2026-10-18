-- Promoções de desconto (influenciador) + ativações + chave parcial.
-- Aditivo, sem quebra do fluxo existente.

ALTER TABLE licensing.licenses
  ADD COLUMN IF NOT EXISTS "promotionId" TEXT;

CREATE TABLE IF NOT EXISTS licensing.promotions (
  id TEXT PRIMARY KEY,
  "productId" TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'BONUS',
  "promoCode" TEXT NOT NULL UNIQUE,
  "discountPercent" INTEGER NOT NULL DEFAULT 0,
  "expiresInHours" INTEGER,
  "maxDevices" INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  "influencerName" TEXT,
  "influencerPlatformUrl" TEXT,
  "influencerSource" TEXT,
  "commissionPercent" INTEGER NOT NULL DEFAULT 0,
  "keyBasePrefix" TEXT,
  "keyBaseHash" TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promotions_product_status
  ON licensing.promotions ("productId", status);

CREATE TABLE IF NOT EXISTS licensing.promotion_activations (
  id TEXT PRIMARY KEY,
  "promotionId" TEXT NOT NULL REFERENCES licensing.promotions(id),
  "licenseId" TEXT,
  "customerId" TEXT,
  "keyHash" TEXT,
  "keyMasked" TEXT,
  "amountPaidCents" INTEGER NOT NULL DEFAULT 0,
  "commissionCents" INTEGER NOT NULL DEFAULT 0,
  "commissionStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "activatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promo_activations_promotion
  ON licensing.promotion_activations ("promotionId");
CREATE INDEX IF NOT EXISTS idx_promo_activations_customer
  ON licensing.promotion_activations ("customerId");