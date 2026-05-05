-- Repair stale foreign keys left behind by 03_rename_trip_plans.sql.
-- PostgreSQL keeps original constraint names after column/table renames, and
-- some databases still have route_requests/group_offers constraints pointing at
-- the pre-rename trip_plans relation. Recreate them against plans(id).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'route_requests_trip_plan_id_fkey'
      AND conrelid = 'route_requests'::regclass
  ) THEN
    ALTER TABLE route_requests
      DROP CONSTRAINT route_requests_trip_plan_id_fkey;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'route_requests_plan_id_fkey'
      AND conrelid = 'route_requests'::regclass
  ) THEN
    ALTER TABLE route_requests
      DROP CONSTRAINT route_requests_plan_id_fkey;
  END IF;

  ALTER TABLE route_requests
    ADD CONSTRAINT route_requests_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'group_offers_trip_plan_id_fkey'
      AND conrelid = 'group_offers'::regclass
  ) THEN
    ALTER TABLE group_offers
      DROP CONSTRAINT group_offers_trip_plan_id_fkey;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'group_offers_plan_id_fkey'
      AND conrelid = 'group_offers'::regclass
  ) THEN
    ALTER TABLE group_offers
      DROP CONSTRAINT group_offers_plan_id_fkey;
  END IF;

  ALTER TABLE group_offers
    ADD CONSTRAINT group_offers_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE;
END $$;
