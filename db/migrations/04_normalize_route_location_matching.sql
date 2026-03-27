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
CREATE OR REPLACE FUNCTION pg_temp.try_jsonb_get_text(value TEXT, key TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  parsed JSONB;
BEGIN
  IF value IS NULL OR btrim(value) = '' THEN
    RETURN NULL;
  END IF;

  parsed := value::jsonb;
  RETURN jsonb_extract_path_text(parsed, key);
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

WITH route_locations AS (
  SELECT
    id,
    NULLIF(pg_temp.try_jsonb_get_text(origin::text, 'ward_id'), '') AS origin_ward_id_json,
    NULLIF(pg_temp.try_jsonb_get_text(origin::text, 'province_id'), '') AS origin_province_id_json,
    NULLIF(pg_temp.try_jsonb_get_text(origin::text, 'ward_key'), '') AS origin_ward_key_json,
    NULLIF(pg_temp.try_jsonb_get_text(destination::text, 'ward_id'), '') AS destination_ward_id_json,
    NULLIF(pg_temp.try_jsonb_get_text(destination::text, 'province_id'), '') AS destination_province_id_json,
    NULLIF(pg_temp.try_jsonb_get_text(destination::text, 'ward_key'), '') AS destination_ward_key_json
  FROM routes
)
UPDATE routes AS routes
SET
  origin_ward_key = COALESCE(
    CASE
      WHEN route_locations.origin_ward_id_json IS NOT NULL
       AND route_locations.origin_province_id_json IS NOT NULL
      THEN route_locations.origin_ward_id_json || '_' || route_locations.origin_province_id_json
    END,
    route_locations.origin_ward_key_json,
    ''
  ),
  origin_ward_id = COALESCE(
    route_locations.origin_ward_id_json,
    NULLIF(split_part(COALESCE(route_locations.origin_ward_key_json, ''), '_', 1), ''),
    ''
  ),
  origin_province_id = COALESCE(
    route_locations.origin_province_id_json,
    NULLIF(split_part(COALESCE(route_locations.origin_ward_key_json, ''), '_', 2), ''),
    ''
  ),
  destination_ward_key = COALESCE(
    CASE
      WHEN route_locations.destination_ward_id_json IS NOT NULL
       AND route_locations.destination_province_id_json IS NOT NULL
      THEN route_locations.destination_ward_id_json || '_' || route_locations.destination_province_id_json
    END,
    route_locations.destination_ward_key_json,
    ''
  ),
  destination_ward_id = COALESCE(
    route_locations.destination_ward_id_json,
    NULLIF(split_part(COALESCE(route_locations.destination_ward_key_json, ''), '_', 1), ''),
    ''
  ),
  destination_province_id = COALESCE(
    route_locations.destination_province_id_json,
    NULLIF(split_part(COALESCE(route_locations.destination_ward_key_json, ''), '_', 2), ''),
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
