# GateLite Release Readiness Design

## Goal

Move GateLite from a working private control panel toward a repeatable private
beta release without forcing authentication on existing deployments.

## Decisions

- Access control is opt-in. `GATELITE_AUTH_ENABLED=false` remains the default.
- When enabled, browser access uses Basic auth and API clients can use Bearer
  tokens. Roles are `viewer`, `agent`, `operator`, and `admin`.
- Public health remains unauthenticated so deployment checks can keep using
  `/api/health`.
- High-risk actions require `admin`: certificate private-key download,
  certificate sync receive, history rollback, bulk import, and certificate
  deletion.
- Backups are file-level archives of GateLite state, rollback snapshots,
  generated dynamic config, and mounted certificates.
- Release checks are scriptable locally and in CI: typecheck, tests, build, and
  production dependency audit.
- The Portainer template defaults to a neutral placeholder host,
  `gatelite.example.com`; released artifacts should not point at
  maintainer-owned deployment domains.

## Verification

- Unit tests cover the role policy.
- CI runs typecheck, tests, build, production audit, and Docker build.
- `npm run verify:release` mirrors the release gate locally.
- `npm run verify:domains` checks that configured public domains serve
  GateLite and return health.
