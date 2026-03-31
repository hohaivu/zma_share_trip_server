ALTER TABLE trip_plans ADD COLUMN IF NOT EXISTS pickup_ward_key VARCHAR(255);
ALTER TABLE trip_plans ADD COLUMN IF NOT EXISTS dropoff_ward_key VARCHAR(255);
ALTER TABLE trip_plans ADD COLUMN IF NOT EXISTS pickup_province_id VARCHAR(255);
ALTER TABLE trip_plans ADD COLUMN IF NOT EXISTS dropoff_province_id VARCHAR(255);
