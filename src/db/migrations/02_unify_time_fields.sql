ALTER TABLE routes
  CHANGE window_start departure_window_start_date DATETIME(3) NOT NULL,
  CHANGE window_end   departure_window_end_date   DATETIME(3) NOT NULL,
  DROP COLUMN departure_date;

ALTER TABLE plans
  CHANGE window_start departure_window_start_date DATETIME(3) NOT NULL,
  CHANGE window_end   departure_window_end_date   DATETIME(3) NOT NULL,
  DROP COLUMN departure_date;
