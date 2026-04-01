-- 1. Deduplicate existing active search requests
-- Keep the most recent 'pending' or 'accepted' request for each client_id + route_id pair,
-- and set older active requests to 'closed'.

WITH DuplicateActive AS (
    SELECT id,
           ROW_NUMBER() OVER(
               PARTITION BY client_id, route_id
               ORDER BY created_at DESC
           ) as rn
    FROM search_requests
    WHERE status IN ('pending', 'accepted')
)
UPDATE search_requests
SET status = 'closed'
WHERE id IN (
    SELECT id
    FROM DuplicateActive
    WHERE rn > 1
);

-- 2. Add partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS search_requests_active_client_route_idx
ON search_requests (client_id, route_id)
WHERE status IN ('pending', 'accepted');
