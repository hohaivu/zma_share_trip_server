CREATE TABLE IF NOT EXISTS reviews (
  id VARCHAR(255) PRIMARY KEY,
  trip_id VARCHAR(255) NOT NULL,
  reviewer_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  reviewee_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT reviews_unique_trip_reviewer_reviewee UNIQUE (trip_id, reviewer_id, reviewee_id)
);

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
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

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
  metadata JSONB DEFAULT '{}'::jsonb,
  read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_recipient_id_created_at_idx
  ON notifications (recipient_id, created_at DESC, id DESC);

ALTER TABLE users
  ALTER COLUMN mauid SET NOT NULL;
