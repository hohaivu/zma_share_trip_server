-- Migration: Rename zalo_id -> mauid, make users.id default to UUID
-- This supports the bootstrap-by-mauid identity model where backend
-- users.id is an internal UUID and mauid is the external Zalo Mini App
-- app-scoped identifier.

-- Enable UUID generation (PG 13+ has gen_random_uuid() built-in)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Rename the external identity column
ALTER TABLE users RENAME COLUMN zalo_id TO mauid;

-- Set default UUID generation for new user rows
ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid()::varchar(255);
