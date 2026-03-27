-- Add normalized location identifiers to routes table
ALTER TABLE routes
ADD COLUMN IF NOT EXISTS origin_ward_key VARCHAR(255),
ADD COLUMN IF NOT EXISTS origin_ward_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS origin_province_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS destination_ward_key VARCHAR(255),
ADD COLUMN IF NOT EXISTS destination_ward_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS destination_province_id VARCHAR(255);

-- Backfill data using the JSONB location fields for any existing routes
UPDATE routes
SET
  origin_ward_key = COALESCE(
    origin->>'ward_id' || '_' || origin->>'province_id',
    origin->>'ward_key',
    ''
  ),
  origin_ward_id = COALESCE(
    origin->>'ward_id',
    split_part(origin->>'ward_key', '_', 1),
    ''
  ),
  origin_province_id = COALESCE(
    origin->>'province_id',
    split_part(origin->>'ward_key', '_', 2),
    ''
  ),
  destination_ward_key = COALESCE(
    destination->>'ward_id' || '_' || destination->>'province_id',
    destination->>'ward_key',
    ''
  ),
  destination_ward_id = COALESCE(
    destination->>'ward_id',
    split_part(destination->>'ward_key', '_', 1),
    ''
  ),
  destination_province_id = COALESCE(
    destination->>'province_id',
    split_part(destination->>'ward_key', '_', 2),
    ''
  );

-- Now set columns to NOT NULL if possible, or just leave as nullable.
-- We will just make them NOT NULL but using ALTER TABLE ... SET DEFAULT '' 
-- might be preferable if there are any issues.
ALTER TABLE routes
ALTER COLUMN origin_ward_key SET NOT NULL,
ALTER COLUMN origin_ward_id SET NOT NULL,
ALTER COLUMN origin_province_id SET NOT NULL,
ALTER COLUMN destination_ward_key SET NOT NULL,
ALTER COLUMN destination_ward_id SET NOT NULL,
ALTER COLUMN destination_province_id SET NOT NULL;
