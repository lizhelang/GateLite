# GateLite Roadmap

## Phase 0: Repository Foundation

- Capture positioning, non-goals, and first workflows.
- Create the GitHub repository and connect this local folder.
- Track implementation work as GitHub issues.

## Phase 1: Read-Only Traefik Companion

- Connect to a Traefik API endpoint.
- Read and normalize active routers, services, middlewares, TLS data,
  providers, entrypoints, and config errors.
- Build the Web Services view around domain usage.
- Build the SSL/TLS view around certificate coverage and expiry.
- Expose read-only Agent API endpoints.

## Phase 2: Safe Configuration Generation

- Generate file-provider dynamic configuration for simple HTTP routes.
- Support dry-run and diff before apply. Current Web service create/update
  endpoints and form flows expose dry-run preview APIs that reuse the same
  validation and deterministic file-provider generator without writing state.
  Certificate create/update preview covers path, ACME, sync, and metadata-only
  changes from both the UI and Agent API; self-signed/upload operations remain
  apply-only because they generate local PEM material.
- Validate domains, backend URLs, entrypoints, middleware references, and TLS
  resolver choices.
- Add local version history and rollback. Current local module snapshots state
  before successful writes and exposes history rollback handles through the UI
  and Agent API.

## Phase 3: Guided TLS

- Add guided self-signed, imported certificate, and ACME resolver flows.
- Highlight certificate/domain gaps before exposing a route.
- Provide beginner-safe defaults while preserving advanced Traefik options.

## Phase 4: Agent-First Writes

- Add stable create/update/delete route APIs.
- Add idempotency keys and machine-readable error codes.
- Add audit log entries for human and agent actions.
- Add policy hooks for production safety checks.

## Phase 5: Provider Expansion

- Improve Docker provider awareness.
- Add Kubernetes read-only visibility.
- Evaluate provider-specific write support only where it can be safe and
  predictable.
