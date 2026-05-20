ALTER TABLE routes
  DROP COLUMN IF EXISTS origin_ward_key,
  DROP COLUMN IF EXISTS destination_ward_key;

ALTER TABLE plans
  DROP COLUMN IF EXISTS origin_ward_key,
  DROP COLUMN IF EXISTS destination_ward_key;
