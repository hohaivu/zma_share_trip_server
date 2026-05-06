-- Backfill accepted active pairings into canonical matched trip lifecycle.
-- Only nonterminal published route/plan rows are changed.

UPDATE routes r
SET status = 'matched'
WHERE r.status = 'published'
  AND EXISTS (
    SELECT 1
    FROM route_requests rr
    WHERE rr.route_id = r.id
      AND rr.status = 'accepted'
  );

UPDATE plans p
SET status = 'matched'
WHERE p.status = 'published'
  AND EXISTS (
    SELECT 1
    FROM route_requests rr
    WHERE rr.plan_id = p.id
      AND rr.status = 'accepted'
  );

UPDATE routes r
SET status = 'matched'
WHERE r.status = 'published'
  AND EXISTS (
    SELECT 1
    FROM group_offers go
    WHERE go.route_id = r.id
      AND go.status = 'accepted'
  );

UPDATE plans p
SET status = 'matched'
WHERE p.status = 'published'
  AND EXISTS (
    SELECT 1
    FROM group_offers go
    WHERE go.plan_id = p.id
      AND go.status = 'accepted'
  );
