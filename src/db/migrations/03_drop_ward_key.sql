BEGIN;

ALTER TABLE routes
  DROP COLUMN origin_ward_key,
  DROP COLUMN destination_ward_key;

ALTER TABLE plans
  DROP COLUMN origin_ward_key,
  DROP COLUMN destination_ward_key;

COMMIT;
