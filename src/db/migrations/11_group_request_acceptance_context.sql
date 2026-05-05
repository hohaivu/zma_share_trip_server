-- Persist accepted client and plan context on driver group requests.
ALTER TABLE group_requests
  ADD COLUMN IF NOT EXISTS accepted_client_user_id VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_plan_id VARCHAR(255) REFERENCES trip_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_id VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL;
