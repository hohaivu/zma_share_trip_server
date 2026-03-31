-- Idempotent rename: trip_plans → plans, trip_plan_id → plan_id
-- Works on both fresh DBs (01_init created trip_plans) and existing DBs.
DO $$
BEGIN
  -- Rename the table only if trip_plans exists and plans does NOT
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trip_plans')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plans')
  THEN
    ALTER TABLE trip_plans RENAME TO plans;
  END IF;

  -- Rename FK column in group_offers
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'group_offers' AND column_name = 'trip_plan_id'
  ) THEN
    ALTER TABLE group_offers RENAME COLUMN trip_plan_id TO plan_id;
  END IF;

  -- Rename FK column in search_requests
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'search_requests' AND column_name = 'trip_plan_id'
  ) THEN
    ALTER TABLE search_requests RENAME COLUMN trip_plan_id TO plan_id;
  END IF;
END $$;
