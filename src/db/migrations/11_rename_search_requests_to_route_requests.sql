-- Development full cutover: legacy search_requests is not supported.
-- Fresh databases already create route_requests; this only helps older dev DBs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'search_requests' AND table_type = 'BASE TABLE')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'route_requests')
  THEN
    ALTER TABLE search_requests RENAME TO route_requests;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'search_requests_active_client_route_idx')
     AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'route_requests_active_client_route_idx')
  THEN
    ALTER INDEX search_requests_active_client_route_idx RENAME TO route_requests_active_client_route_idx;
  END IF;
END $$;
