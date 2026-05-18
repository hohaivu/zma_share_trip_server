# 0002 — Matching Time and Reciprocal Request Resolution

- Status: Accepted
- Date: 2026-05-18

Ride-sharing matching uses a soft-time search window only to discover compatible Routes and Plans; the accepted proposed time remains the sender's original Route or Plan time. When the exact same Route and Plan have opposite pending Request edges, the reciprocal request auto-resolves into one match with the first pending request treated as the winning request, rather than creating a second independent match or renegotiating time.

## Consequences

- Search tolerance can improve match discovery without changing what time the recipient accepts.
- Reciprocal requests converge on one Route/Plan relationship and preserve the original request order.
- A Route or Plan has at most one active match; if that match is cancelled by one side, only the non-cancelling counterpart can reopen as the same Journey when it is still available.
