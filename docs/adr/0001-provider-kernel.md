# 0001 — Provider/Kernel Skeleton for App Bootstrap

- Status: Accepted
- Date: 2026-05-16
- Linear: ALI-56

## Context

`src/index.ts` previously mixed several concerns into one module:

- Construction of the express app
- Mounting of route groups
- Registration of HTTP middleware (`express.json`, `cors`)
- The global error envelope handler
- The `/health` endpoint
- Database connectivity check at startup
- `app.listen(PORT, ...)`

This shape made it hard to:

- Test individual pieces of the bootstrap in isolation
- Add or reorder middleware without touching a single monolithic file
- Reason about ordering constraints (e.g. that the error handler must be the last `app.use`)

We want a small structural backbone that organizes bootstrap into named units
without pulling in a DI container or rewriting the service layer to accept
injected dependencies.

## Decision

Introduce a minimal `Kernel` + `Provider` pair under `src/`:

- `src/kernel.ts` exports `Kernel`, `Provider`, and `createKernel()`.
  - The Kernel owns the express `app` instance.
  - `register(provider)` records a provider and immediately invokes its
    `register(kernel)` hook so that synchronous providers configure the app
    eagerly. The (possibly-promise) return value is tracked so callers can
    `await kernel.boot()` to flush async providers before serving traffic.
  - `boot()` awaits any pending registration promises and is idempotent
    against subsequent calls (it drains its queue).
- `src/providers/` holds one provider per bootstrap concern:
  - `httpProvider` — `express.json` + `cors`
  - `routeProvider` — mounts all route groups under `/api`, `/api/driver`,
    `/api/client`
  - `healthProvider` — the `/health` endpoint
  - `errorProvider` — the existing `{ error: -1, message }` envelope handler.
    Must be the last provider registered.
- `src/index.ts` becomes a thin composition root: build the kernel, register
  the providers in order, run the DB check, await `kernel.boot()`, then
  `kernel.app.listen(PORT, ...)`.

The default export of `src/index.ts` remains the express `Express` instance
(now sourced from `kernel.app`) so `src/api.test.ts` continues to work
unchanged.

## Naming

- **Kernel**: the lifecycle owner that holds the app and the provider list.
- **Provider**: a `{ name, register(kernel) }` object that registers exactly
  one bootstrap concern. The name is human-readable for logging and future
  diagnostics; it is not used for resolution.

## Out of scope

This change deliberately does **not**:

- Introduce a DI container (`inversify`, `tsyringe`, `awilix`, etc.).
- Rewrite services or repositories to accept injected dependencies.
- Add a service-locator pattern to look up dependencies by name.
- Reshape route handlers or middleware contracts.

Those are larger moves that, if needed, can be evaluated separately.

## Consequences

Positive:

- Each bootstrap concern lives in a focused file with a clear name.
- Adding a new bootstrap step (e.g. request logging, metrics) is a new
  provider plus one `.register(...)` line — no edits to existing providers.
- The error middleware's "must be last" rule is enforced by registration
  order in one obvious place.
- The Kernel surface is small enough to test directly if needed.

Neutral / trade-offs:

- Providers see the kernel directly rather than receiving narrow inputs.
  This is intentional for now; tightening that contract can come later if
  the surface grows.
- Async providers require callers to `await kernel.boot()` before treating
  the app as ready. Tests that import the app today only rely on synchronous
  providers, so they continue to work without a boot await.
