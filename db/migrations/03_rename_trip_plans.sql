-- Rename trip_plans table and FK columns for existing databases
ALTER TABLE IF EXISTS trip_plans RENAME TO plans;
ALTER TABLE IF EXISTS group_offers RENAME COLUMN trip_plan_id TO plan_id;
ALTER TABLE IF EXISTS search_requests RENAME COLUMN trip_plan_id TO plan_id;
