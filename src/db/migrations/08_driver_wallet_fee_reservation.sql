CREATE TABLE IF NOT EXISTS wallets (
  id VARCHAR(255) PRIMARY KEY,
  driver_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  balance_vnd BIGINT NOT NULL DEFAULT 0,
  reserved_balance_vnd BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wallets_driver_id_idx ON wallets(driver_id);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id VARCHAR(255) PRIMARY KEY,
  wallet_id VARCHAR(255) NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  driver_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_id VARCHAR(255) REFERENCES routes(id) ON DELETE SET NULL,
  type VARCHAR(50) NOT NULL,
  amount_vnd BIGINT NOT NULL,
  balance_after_vnd BIGINT NOT NULL,
  reserved_balance_after_vnd BIGINT NOT NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wallet_transactions_wallet_id_created_at_idx
  ON wallet_transactions(wallet_id, created_at DESC);

CREATE INDEX IF NOT EXISTS wallet_transactions_driver_id_created_at_idx
  ON wallet_transactions(driver_id, created_at DESC);

ALTER TABLE routes
ADD COLUMN IF NOT EXISTS distance_meters INTEGER,
ADD COLUMN IF NOT EXISTS fee_rate_vnd_per_km INTEGER,
ADD COLUMN IF NOT EXISTS fee_required_vnd BIGINT,
ADD COLUMN IF NOT EXISTS wallet_fee_status VARCHAR(50),
ADD COLUMN IF NOT EXISTS wallet_reserved_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS wallet_charged_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS wallet_released_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS wallet_refunded_at TIMESTAMP WITH TIME ZONE;

UPDATE routes
SET
  fee_rate_vnd_per_km = COALESCE(fee_rate_vnd_per_km, 0),
  fee_required_vnd = COALESCE(fee_required_vnd, 0),
  wallet_fee_status = COALESCE(wallet_fee_status, 'none')
WHERE
  fee_rate_vnd_per_km IS NULL
  OR fee_required_vnd IS NULL
  OR wallet_fee_status IS NULL;

ALTER TABLE routes
ALTER COLUMN fee_rate_vnd_per_km SET DEFAULT 0,
ALTER COLUMN fee_rate_vnd_per_km SET NOT NULL,
ALTER COLUMN fee_required_vnd SET DEFAULT 0,
ALTER COLUMN fee_required_vnd SET NOT NULL,
ALTER COLUMN wallet_fee_status SET DEFAULT 'none',
ALTER COLUMN wallet_fee_status SET NOT NULL;
