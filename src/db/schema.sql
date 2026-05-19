CREATE TABLE IF NOT EXISTS identities (
  id VARCHAR(255) PRIMARY KEY DEFAULT UUID(),
  mauid VARCHAR(255) UNIQUE NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  phone VARCHAR(50),
  preferred_mode VARCHAR(50) DEFAULT 'client',
  mode_selected_at DATETIME(3),
  created_at DATETIME(3) DEFAULT NOW(),
  updated_at DATETIME(3) DEFAULT NOW()
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(255) PRIMARY KEY DEFAULT UUID(),
  identity_id VARCHAR(255) REFERENCES identities(id) ON DELETE CASCADE,
  mauid VARCHAR(255),
  display_name VARCHAR(255),
  avatar_url TEXT,
  phone VARCHAR(50),
  verification_status VARCHAR(50) DEFAULT 'unverified',
  rating_avg DECIMAL(3,2) DEFAULT 0.0,
  trip_count INTEGER DEFAULT 0,
  role VARCHAR(50) NOT NULL,
  preferred_mode VARCHAR(50),
  mode_selected_at DATETIME(3),
  blocked_user_ids JSON DEFAULT NULL,
  created_at DATETIME(3) DEFAULT NOW()
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX IF NOT EXISTS users_identity_role_unique_idx
  ON users (identity_id, role);

CREATE TABLE IF NOT EXISTS identity_blocks (
  blocker_identity_id VARCHAR(255) REFERENCES identities(id) ON DELETE CASCADE,
  blocked_identity_id VARCHAR(255) REFERENCES identities(id) ON DELETE CASCADE,
  created_at DATETIME(3) DEFAULT NOW(),
  PRIMARY KEY (blocker_identity_id, blocked_identity_id),
  CHECK (blocker_identity_id <> blocked_identity_id)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS identity_blocks_blocked_identity_id_idx
  ON identity_blocks (blocked_identity_id);

CREATE TABLE IF NOT EXISTS cars (
  id VARCHAR(255) PRIMARY KEY,
  owner_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  nickname VARCHAR(255),
  plate_number_masked VARCHAR(255) NOT NULL,
  plate_number_full VARCHAR(255) NOT NULL,
  brand VARCHAR(255),
  model VARCHAR(255),
  color VARCHAR(50),
  seat_capacity INTEGER,
  verification_status VARCHAR(50) DEFAULT 'unverified',
  photos JSON DEFAULT NULL,
  created_at DATETIME(3) DEFAULT NOW()
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS routes (
  id VARCHAR(255) PRIMARY KEY,
  driver_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  car_id VARCHAR(255) REFERENCES cars(id) ON DELETE SET NULL,
  origin JSON NOT NULL,
  destination JSON NOT NULL,
  origin_ward_id VARCHAR(255) NOT NULL,
  origin_province_id VARCHAR(255) NOT NULL,
  destination_ward_id VARCHAR(255) NOT NULL,
  destination_province_id VARCHAR(255) NOT NULL,
  departure_date DATETIME(3) NOT NULL,
  window_start DATETIME(3) NOT NULL,
  window_end DATETIME(3) NOT NULL,
  trip_price DECIMAL(12,2) NOT NULL,
  distance_meters INTEGER,
  fee_rate_vnd_per_km INTEGER NOT NULL DEFAULT 0,
  fee_required_vnd BIGINT NOT NULL DEFAULT 0,
  wallet_fee_status VARCHAR(50) NOT NULL DEFAULT 'none',
  wallet_reserved_at DATETIME(3),
  wallet_charged_at DATETIME(3),
  wallet_released_at DATETIME(3),
  wallet_refunded_at DATETIME(3),
  notes TEXT,
  status VARCHAR(50) DEFAULT 'draft',
  completed_at DATETIME(3),
  created_at DATETIME(3) DEFAULT NOW()
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plans (
  id VARCHAR(255) PRIMARY KEY,
  client_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  origin JSON NOT NULL,
  destination JSON NOT NULL,
  origin_ward_id VARCHAR(255) NOT NULL,
  destination_ward_id VARCHAR(255) NOT NULL,
  origin_province_id VARCHAR(255),
  destination_province_id VARCHAR(255),
  departure_date DATETIME(3) NOT NULL,
  window_start DATETIME(3) NOT NULL,
  window_end DATETIME(3) NOT NULL,
  passenger_count INTEGER NOT NULL,
  notes TEXT,
  status VARCHAR(50) DEFAULT 'published',
  publish_mode VARCHAR(50) NOT NULL DEFAULT 'grouped',
  completed_at DATETIME(3),
  created_at DATETIME(3) DEFAULT NOW()
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS group_requests (
  id VARCHAR(255) PRIMARY KEY,
  driver_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  route_id VARCHAR(255) REFERENCES routes(id) ON DELETE CASCADE,
  demand_group_id VARCHAR(255) NOT NULL,
  note TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  accepted_client_user_id VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
  accepted_plan_id VARCHAR(255) REFERENCES plans(id) ON DELETE SET NULL,
  client_id VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
  created_at DATETIME(3) DEFAULT NOW()
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS group_offers (
  id VARCHAR(255) PRIMARY KEY,
  group_request_id VARCHAR(255) REFERENCES group_requests(id) ON DELETE CASCADE,
  route_id VARCHAR(255) REFERENCES routes(id) ON DELETE CASCADE,
  driver_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  client_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  plan_id VARCHAR(255) REFERENCES plans(id) ON DELETE CASCADE,
  trip_price DECIMAL(12,2),
  status VARCHAR(50) DEFAULT 'pending',
  created_at DATETIME(3) DEFAULT NOW()
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS route_requests (
  id VARCHAR(255) PRIMARY KEY,
  client_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  plan_id VARCHAR(255) NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  route_id VARCHAR(255) REFERENCES routes(id) ON DELETE CASCADE,
  driver_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  trip_price DECIMAL(12,2),
  note TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  created_at DATETIME(3) DEFAULT NOW()
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS route_requests_client_route_idx
  ON route_requests (client_id, route_id);

CREATE TABLE IF NOT EXISTS saved_locations (
  id VARCHAR(255) PRIMARY KEY,
  label VARCHAR(255) NOT NULL,
  lat DECIMAL(10,7) NOT NULL,
  lng DECIMAL(10,7) NOT NULL,
  created_at DATETIME(3) DEFAULT NOW()
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wallets (
  id VARCHAR(255) PRIMARY KEY,
  driver_id VARCHAR(255) NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance_vnd BIGINT NOT NULL DEFAULT 0,
  reserved_balance_vnd BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW()
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS wallets_driver_id_idx ON wallets(driver_id);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id VARCHAR(255) PRIMARY KEY,
  wallet_id VARCHAR(255) NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  driver_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_id VARCHAR(255) REFERENCES routes(id) ON DELETE SET NULL,
  type VARCHAR(50) NOT NULL,
  amount_vnd BIGINT NOT NULL,
  balance_after_vnd BIGINT NOT NULL,
  reserved_balance_after_vnd BIGINT NOT NULL,
  description TEXT,
  metadata JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW()
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS wallet_transactions_wallet_id_created_at_idx
  ON wallet_transactions(wallet_id, created_at DESC);

CREATE INDEX IF NOT EXISTS wallet_transactions_driver_id_created_at_idx
  ON wallet_transactions(driver_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reviews (
  id VARCHAR(255) PRIMARY KEY,
  trip_id VARCHAR(255) NOT NULL,
  reviewer_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  reviewee_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at DATETIME(3) DEFAULT NOW(),
  CONSTRAINT reviews_unique_trip_reviewer_reviewee UNIQUE (trip_id, reviewer_id, reviewee_id)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS reviews_reviewer_id_idx ON reviews (reviewer_id);
CREATE INDEX IF NOT EXISTS reviews_reviewee_id_idx ON reviews (reviewee_id);
CREATE INDEX IF NOT EXISTS reviews_trip_id_idx ON reviews (trip_id);

CREATE TABLE IF NOT EXISTS reports (
  id VARCHAR(255) PRIMARY KEY,
  trip_id VARCHAR(255) NOT NULL,
  reporter_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  reportee_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  reason VARCHAR(50) NOT NULL CHECK (
    reason IN (
      'no_show',
      'unsafe_behavior',
      'misleading_route',
      'harassment',
      'spam',
      'fake_profile'
    )
  ),
  detail TEXT,
  created_at DATETIME(3) DEFAULT NOW()
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS reports_reporter_id_idx ON reports (reporter_id);
CREATE INDEX IF NOT EXISTS reports_reportee_id_idx ON reports (reportee_id);
CREATE INDEX IF NOT EXISTS reports_trip_id_idx ON reports (trip_id);

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(255) PRIMARY KEY,
  recipient_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target_route TEXT,
  deep_link TEXT,
  request_source VARCHAR(50),
  metadata JSON,
  `read` TINYINT(1) DEFAULT 0,
  read_at DATETIME(3),
  created_at DATETIME(3) DEFAULT NOW()
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS notifications_recipient_id_created_at_idx
  ON notifications (recipient_id, created_at DESC, id DESC);
