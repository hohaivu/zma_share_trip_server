-- Migration: Rename zalo_id -> mauid, make users.id default to UUID
-- This supports the bootstrap-by-mauid identity model where backend
-- users.id is an internal UUID and mauid is the external Zalo Mini App
-- app-scoped identifier.

-- Enable UUID generation (PG 13+ has gen_random_uuid() built-in)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Handle both legacy databases (still on zalo_id) and databases that were
-- already created with mauid before this migration chain runs.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'zalo_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'mauid'
  ) THEN
    ALTER TABLE users RENAME COLUMN zalo_id TO mauid;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'id'
  ) THEN
    ALTER TABLE users
    ALTER COLUMN id SET DEFAULT gen_random_uuid()::varchar(255);
  END IF;
END $$;
