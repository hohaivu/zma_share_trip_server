CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS identities (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::varchar(255),
  mauid VARCHAR(255) UNIQUE NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  phone VARCHAR(50),
  preferred_mode VARCHAR(50) DEFAULT 'client',
  mode_selected_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);

ALTER TABLE users ALTER COLUMN mauid DROP NOT NULL;
ALTER TABLE users ALTER COLUMN display_name DROP NOT NULL;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_mauid_key;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_zalo_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_identity_fk'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_identity_fk
        FOREIGN KEY (identity_id) REFERENCES identities(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_identity_role_unique_idx
  ON users (identity_id, role)
  WHERE identity_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS identity_blocks (
  blocker_identity_id VARCHAR(255) REFERENCES identities(id) ON DELETE CASCADE,
  blocked_identity_id VARCHAR(255) REFERENCES identities(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (blocker_identity_id, blocked_identity_id),
  CHECK (blocker_identity_id <> blocked_identity_id)
);

CREATE INDEX IF NOT EXISTS identity_blocks_blocked_identity_id_idx
  ON identity_blocks (blocked_identity_id);
