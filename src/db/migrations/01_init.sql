CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(255) PRIMARY KEY,
  zalo_id VARCHAR(255) UNIQUE NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  verification_status VARCHAR(50) DEFAULT 'unverified',
  rating_avg NUMERIC(3,2) DEFAULT 0.0,
  trip_count INTEGER DEFAULT 0,
  role VARCHAR(50) NOT NULL,
  preferred_mode VARCHAR(50),
  mode_selected_at TIMESTAMP WITH TIME ZONE,
  blocked_user_ids JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

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
  photos JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS routes (
  id VARCHAR(255) PRIMARY KEY,
  driver_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  car_id VARCHAR(255) REFERENCES cars(id) ON DELETE SET NULL,
  origin JSONB NOT NULL,
  destination JSONB NOT NULL,
  service_date DATE NOT NULL,
  departure_time TIMESTAMP WITH TIME ZONE NOT NULL,
  window_start TIMESTAMP WITH TIME ZONE NOT NULL,
  window_end TIMESTAMP WITH TIME ZONE NOT NULL,
  trip_price NUMERIC(12,2) NOT NULL,
  notes TEXT,
  status VARCHAR(50) DEFAULT 'draft',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trip_plans (
  id VARCHAR(255) PRIMARY KEY,
  client_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  pickup JSONB NOT NULL,
  dropoff JSONB NOT NULL,
  pickup_ward_id VARCHAR(255) NOT NULL,
  dropoff_ward_id VARCHAR(255) NOT NULL,
  service_date DATE NOT NULL,
  departure_block_start TIMESTAMP WITH TIME ZONE NOT NULL,
  departure_block_end TIMESTAMP WITH TIME ZONE NOT NULL,
  passenger_count INTEGER NOT NULL,
  publish_mode VARCHAR(50) NOT NULL,
  notes TEXT,
  status VARCHAR(50) DEFAULT 'published',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_requests (
  id VARCHAR(255) PRIMARY KEY,
  driver_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  route_id VARCHAR(255) REFERENCES routes(id) ON DELETE CASCADE,
  demand_group_id VARCHAR(255) NOT NULL,
  note TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_offers (
  id VARCHAR(255) PRIMARY KEY,
  group_request_id VARCHAR(255) REFERENCES group_requests(id) ON DELETE CASCADE,
  route_id VARCHAR(255) REFERENCES routes(id) ON DELETE CASCADE,
  driver_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  client_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  trip_plan_id VARCHAR(255) REFERENCES trip_plans(id) ON DELETE CASCADE,
  trip_price NUMERIC(12,2),
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS search_requests (
  id VARCHAR(255) PRIMARY KEY,
  client_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  trip_plan_id VARCHAR(255) REFERENCES trip_plans(id) ON DELETE CASCADE,
  route_id VARCHAR(255) REFERENCES routes(id) ON DELETE CASCADE,
  driver_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  trip_price NUMERIC(12,2),
  note TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saved_locations (
  id VARCHAR(255) PRIMARY KEY,
  label VARCHAR(255) NOT NULL,
  lat NUMERIC(10,7) NOT NULL,
  lng NUMERIC(10,7) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
