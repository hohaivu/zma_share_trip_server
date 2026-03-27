-- Add normalized location identifiers to routes table
ALTER TABLE routes
ADD COLUMN IF NOT EXISTS origin_ward_key VARCHAR(255),
ADD COLUMN IF NOT EXISTS origin_ward_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS origin_province_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS destination_ward_key VARCHAR(255),
ADD COLUMN IF NOT EXISTS destination_ward_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS destination_province_id VARCHAR(255);

-- Backfill data from legacy location columns. Older deployments stored route
-- locations as TEXT, so parse defensively instead of assuming JSONB.
CREATE OR REPLACE FUNCTION pg_temp.try_parse_jsonb(value TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  IF value IS NULL OR btrim(value) = '' THEN
    RETURN NULL;
  END IF;

  RETURN value::jsonb;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

WITH route_locations AS (
  SELECT
    id,
    pg_temp.try_parse_jsonb(origin::text) AS origin_json,
    pg_temp.try_parse_jsonb(destination::text) AS destination_json
  FROM routes
)
UPDATE routes AS routes
SET
  origin_ward_key = COALESCE(
    CASE
      WHEN COALESCE(route_locations.origin_json->>'ward_id', '') <> ''
       AND COALESCE(route_locations.origin_json->>'province_id', '') <> ''
      THEN route_locations.origin_json->>'ward_id' || '_' || route_locations.origin_json->>'province_id'
    END,
    NULLIF(route_locations.origin_json->>'ward_key', ''),
    ''
  ),
  origin_ward_id = COALESCE(
    NULLIF(route_locations.origin_json->>'ward_id', ''),
    NULLIF(split_part(COALESCE(route_locations.origin_json->>'ward_key', ''), '_', 1), ''),
    ''
  ),
  origin_province_id = COALESCE(
    NULLIF(route_locations.origin_json->>'province_id', ''),
    NULLIF(split_part(COALESCE(route_locations.origin_json->>'ward_key', ''), '_', 2), ''),
    ''
  ),
  destination_ward_key = COALESCE(
    CASE
      WHEN COALESCE(route_locations.destination_json->>'ward_id', '') <> ''
       AND COALESCE(route_locations.destination_json->>'province_id', '') <> ''
      THEN route_locations.destination_json->>'ward_id' || '_' || route_locations.destination_json->>'province_id'
    END,
    NULLIF(route_locations.destination_json->>'ward_key', ''),
    ''
  ),
  destination_ward_id = COALESCE(
    NULLIF(route_locations.destination_json->>'ward_id', ''),
    NULLIF(split_part(COALESCE(route_locations.destination_json->>'ward_key', ''), '_', 1), ''),
    ''
  ),
  destination_province_id = COALESCE(
    NULLIF(route_locations.destination_json->>'province_id', ''),
    NULLIF(split_part(COALESCE(route_locations.destination_json->>'ward_key', ''), '_', 2), ''),
    ''
  )
FROM route_locations
WHERE routes.id = route_locations.id;

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
