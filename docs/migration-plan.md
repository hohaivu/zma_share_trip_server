# Backend Migration Plan

## Phase 0: MoleculerJS Preparation

**Status:** Planned

This phase prepares the codebase for a future strangler migration to MoleculerJS without changing the current runtime.

### Why

- The current Express layered architecture already contains service boundaries that can be mapped to future actions.
- Preparing service contracts first reduces the risk of a later framework switch.
- A contract-first migration keeps the HTTP API stable while infrastructure changes behind the scenes.

### Recommended strangler path

1. Keep Express as the public HTTP entry point.
2. Document and stabilize plain-data action contracts for each service boundary.
3. Introduce explicit ports/adapters between cross-domain dependencies instead of direct sibling imports.
4. Add a Moleculer broker only after the service contracts are stable.
5. Migrate endpoints incrementally so each area can move behind the broker without changing public responses.

### Non-goals

- No Moleculer runtime dependency is added in this phase.
- No public API behavior or response-shape change is introduced in this phase.
- No database split or data-model split is introduced in this phase.
- No Express route/controller rewrite is required in this phase.

## Phase 1: Postgres → MariaDB

**Status:** Complete (2026-05-19)

### Why

- MariaDB is the target production database.
- MariaDB R-Tree SPATIAL INDEX enables bbox prefilters for matching (Phase 2).
- Doing the matching refactor before the DB swap would require a second pass over all repositories.

### Target MariaDB Version

10.6 LTS or 11.x. Rationale: `INSERT … RETURNING` available from 10.5+; JSON function set stable from 10.6+.

### Surface Area

| File / Area | Change |
|---|---|
| `package.json` | Remove `pg`, `@types/pg`. Add `mariadb`. |
| `src/db/connection.ts` | Replace `pg.Pool` with `mariadb.createPool`. Keep export shape compatible. |
| `src/db/utils.ts` | Adapt row coercion for mariadb driver types (`BIGINT`, `DATETIME`, `JSON`, `TINYINT(1)` booleans). |
| `src/db/schema.sql` | Port schema: `gen_random_uuid()` → `UUID()`, `SERIAL` → `BIGINT AUTO_INCREMENT`, `JSONB` → `JSON`, arrays → `JSON` or normalized, `TIMESTAMP WITH TIME ZONE` → `DATETIME`. Remove `CREATE EXTENSION pgcrypto`. |
| `src/repositories/*.ts` | `$1, $2, …` → `?` (positional, duplicates for reused params). Audit UPDATE `RETURNING` — MariaDB has no `RETURNING` on UPDATE; split into UPDATE + SELECT. |
| `src/db/setup-schema.ts`, `seed.ts`, `truncate.ts` | Rewrite for MariaDB syntax (foreign-key disable/enable, `TRUNCATE TABLE`). |
| `docker-compose.test.yml` | Swap Postgres image for MariaDB. |
| `package.json` test script | Update `DATABASE_URL` format. |

### UUID Storage

Use `CHAR(36)` (readable, minimal churn, no app-side UUID parsing). Existing UUID values transfer directly.

### Query Builder

Keep raw SQL for this migration — one migration at a time. No knex/drizzle.

### Known Risks

| Risk | Mitigation |
|---|---|
| Type coercion drift (`BIGINT`, `BOOL`, `JSON`) | Run full test suite; add coercion unit tests for boundary values. |
| `UPDATE … RETURNING` (if used) | Grep all `RETURNING` usage; split into UPDATE + SELECT at those sites. |
| Transaction isolation: Postgres READ COMMITTED vs MariaDB REPEATABLE READ | Audit any transaction-sensitive logic. |
| `departureDate.slice(0,10)` TZ fragility | Pre-existing issue; out of scope here — separate change. |

### Verification

1. `docker compose -f docker-compose.test.yml up -d` (MariaDB image).
2. `npm run db:schema && npm run db:seed`.
3. `npm test` — all tests pass.
4. `gitnexus_detect_changes` — only DB-layer symbols touched; no business logic drift.
5. Manual E2E smoke: publish route → search routes → send request → accept. Diff JSON responses against Postgres baseline.

---

## Phase 2: Matching Engine Refactor

**Prerequisite**: Phase 1 merged.

### Why

`src/matching.ts` (582 lines) mixes geo helpers, thresholds, hard filters, scoring, tier classification, and repo orchestration. Adding any new filter, changing the candidate source, or tuning scoring requires modifying the entry points directly. The plug-in pipeline shape lets each concern evolve independently.

**Zero behavior change.** `tests/matching.test.ts` (863 lines) is the regression contract.

### Architecture

```
matching/
├── index.ts              ← public API (same signatures callers use today)
├── engine.ts             ← MatchEngine<Q,C,R> orchestrator
├── ports.ts              ← CandidateSource, HardFilter, Scorer, Ranker interfaces
├── geo.ts                ← haversine, computeBearing, bearingDifference
├── thresholds.ts         ← MAX_BEARING_DIFF, MAX_PICKUP_KM, MAX_DROPOFF_KM, weights
├── tier.ts               ← hasExactAdminMatch, classifyByAdminAndDistance, computeVisibilityMode
├── score.ts              ← directionScore, proximityScore, timeOverlapScore, estimateDetour
├── filters/
│   ├── sameDateFilter.ts
│   ├── blockOverlapFilter.ts
│   ├── mutualBlockFilter.ts     ← owns memoized user/blocked lookups
│   ├── bearingFilter.ts
│   └── proximityFilter.ts
├── sources/
│   ├── allRoutesSource.ts       ← listAllRoutes + status/availability gate (MariaDB)
│   └── demandGroupsSource.ts    ← deriveDemandGroups + pendingInboundPlanIds suppression
└── rankers/
    └── tierThenScoreRanker.ts   ← exact_3 first, then matchScore desc
```

### Key Interface (`ports.ts`)

```ts
interface CandidateSource<Q, C> { list(query: Q): Promise<C[]> }
interface HardFilter<Q, C>      { name: string; passes(c: C, q: Q, ctx: FilterContext): Promise<boolean> }
interface Scorer<Q, C>          { score(c: C, q: Q): ScoreFields & { matchTier: 'exact_3' | 'near_3' } }
interface Ranker<R>             { rank(results: R[]): R[] }

interface FilterContext {
  driver: User | null
  blockedUserCache: Map<string, string[]>   // memoized — eliminates N+1
  userCache: Map<string, User | null>
}
```

### Preserved Invariants

- `exact_3` / `near_3` tier labels unchanged in wire format.
- Filter execution order unchanged.
- `hasExactAdminMatch` bypass on bearing+proximity filters unchanged.
- `pendingInboundPlanIds` suppression stays in `DemandGroupsSource`.
- `FilterContext` caches eliminate N+1 user lookups per run (free correctness win — same inputs, same outputs, fewer DB calls).

### Future Additions Enabled (no rewrite needed)

| Future need | Add |
|---|---|
| Capacity gate | New `CapacityFilter` file |
| Date+bbox SQL prefilter | New `BboxSqlSource` (MariaDB SPATIAL INDEX) |
| Driver rating tiebreaker | Update `TierThenScoreRanker` |
| Externalized weights | Move `thresholds.ts` values to DB config table |

### Commit Sequence

1. **Extract pure modules** — move `geo.ts`, `thresholds.ts`, `tier.ts`, `score.ts` from `matching.ts`. Tests pass unchanged.
2. **Introduce engine + plug-ins** — add `ports.ts`, `engine.ts`, filter/source/ranker files. Wire entry points through engine. Tests pass unchanged.
3. **Add `FilterContext` caches** — memoize `getUser` / `getBlockedUsers` per run. Add test asserting one call per unique user.
4. **Delete `src/matching.ts`**. Update import paths in `matchingService.ts`, `matchingController.ts`.

### Verification

1. `npm test` — all matching tests pass with zero edits.
2. `gitnexus_impact({ target: "computeMatchedDemandGroups" })` — upstream callers unchanged.
3. `gitnexus_detect_changes` — new symbols added, old `matching.ts` symbols relocated; no wire-format change.
4. Manual smoke: diff JSON from `/api/client/route-suggestions` and `/api/driver/routes/:id/matched-demand-groups` before vs after. Byte-identical.
