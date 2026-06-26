# GateLite ACME Operations Test Plan

## Claims To Prove

- GateLite can read resolver state without writing Traefik static config.
- GateLite can read ACME certificate state from `acme.json`.
- GateLite shows renewal attention for expiring/expired/unreadable states.
- GateLite ACME certificate references remain compatible with existing
  resolver binding behavior.
- GateLite does not persist or display DNS provider plaintext secrets.
- Existing new-domain routing and certificate management are not disturbed.

## Unit Tests

Run:

```bash
npm test
```

Required coverage:

- `tests/acme.test.ts`
  - reads `certificatesResolvers` from a mounted static config fixture
  - reads ACME storage certificates and parses X.509 expiry metadata
  - detects DNS-01 provider name without exposing provider secrets
  - enriches GateLite ACME certificate references by resolver/domain
  - reports missing storage as warning/unknown instead of healthy
- Existing tests remain passing:
  - `tests/traefik-runtime.test.ts`
  - `tests/bindings.test.ts`
  - `tests/web-services.test.ts`
  - `tests/certificates.test.ts`
  - `tests/discovery.test.ts`

## Static Checks

Run:

```bash
npm run typecheck
npm run build
```

Success means the shared `DashboardPayload` and UI additions are type-safe and
the frontend still builds.

## Local Runtime Smoke

Run the existing local stack when Docker is available:

```bash
npm run compose:up
npm run verify:local
```

Expected result without ACME mounts:

- dashboard loads
- SSL/TLS page renders
- ACME operations panel reports that static config/storage are not mounted
- no existing local demo routes or file certificates are removed

Optional ACME fixture smoke:

1. Create a local static config fixture with `certificatesResolvers`.
2. Create an `acme.json` fixture with a non-production test certificate.
3. Start GateLite with:

```bash
GATELITE_TRAEFIK_STATIC_CONFIG_FILE=/path/to/traefik.yml \
GATELITE_ACME_STORAGE_FILE=/path/to/acme.json \
npm run dev
```

Expected result:

- `/api/acme/status` lists resolvers
- storage file is marked readable
- ACME certificates show domains and expiry
- no DNS token value appears in JSON or UI

## Production-Safety Checks

Before any live deployment, confirm:

- No Traefik production static config file is modified by this branch.
- No production `acme.json` is written by this branch.
- ACME-related compose changes are limited to optional env pointers. If the
  working tree also contains release/auth/domain-template edits, verify those
  as their own release surface rather than treating them as ACME behavior.
- Any future live stack mount for static config/storage is read-only.
- Deployment-specific public-domain verification still passes when operators
  provide their own URL list:

```bash
GATELITE_PUBLIC_URLS=https://gatelite.example.com npm run verify:domains
```

Live Traefik resolver changes are out of scope for this phase.
