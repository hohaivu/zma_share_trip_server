-- Enforce direct search requests always link to a client plan.
ALTER TABLE search_requests
  ALTER COLUMN plan_id SET NOT NULL;
