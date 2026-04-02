ALTER TABLE plans
ADD COLUMN IF NOT EXISTS publish_mode VARCHAR(50);

UPDATE plans
SET publish_mode = 'grouped'
WHERE publish_mode IS NULL;

ALTER TABLE plans
ALTER COLUMN publish_mode SET DEFAULT 'grouped';

ALTER TABLE plans
ALTER COLUMN publish_mode SET NOT NULL;
