BEGIN;

ALTER TABLE routes
  ADD COLUMN departure_date TIMESTAMP WITH TIME ZONE;

UPDATE routes
SET departure_date = departure_time;

ALTER TABLE routes
  ALTER COLUMN departure_date SET NOT NULL,
  DROP COLUMN service_date,
  DROP COLUMN departure_time;

ALTER TABLE plans
  ADD COLUMN departure_date TIMESTAMP WITH TIME ZONE,
  ADD COLUMN window_start TIMESTAMP WITH TIME ZONE,
  ADD COLUMN window_end TIMESTAMP WITH TIME ZONE;

UPDATE plans
SET
  departure_date = departure_block_start,
  window_start = departure_block_start,
  window_end = departure_block_end;

ALTER TABLE plans
  ALTER COLUMN departure_date SET NOT NULL,
  ALTER COLUMN window_start SET NOT NULL,
  ALTER COLUMN window_end SET NOT NULL,
  DROP COLUMN service_date,
  DROP COLUMN departure_block_start,
  DROP COLUMN departure_block_end;

COMMIT;
