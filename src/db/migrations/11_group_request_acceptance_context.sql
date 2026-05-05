-- Persist accepted client and plan context on driver group requests.
-- Migration 03 renames trip_plans -> plans, so accepted_plan_id must point at plans.
ALTER TABLE group_requests
  ADD COLUMN IF NOT EXISTS accepted_client_user_id VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_plan_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS client_id VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'group_requests_accepted_plan_id_fkey'
      AND conrelid = 'group_requests'::regclass
  ) THEN
    ALTER TABLE group_requests DROP CONSTRAINT group_requests_accepted_plan_id_fkey;
  END IF;

  ALTER TABLE group_requests
    ADD CONSTRAINT group_requests_accepted_plan_id_fkey
    FOREIGN KEY (accepted_plan_id) REFERENCES plans(id) ON DELETE SET NULL;
END $$;
