# GateLite ACME Operations Design

## Goal

Give GateLite an ACME operations loop without moving ACME ownership away from
Traefik and without changing the current production Traefik configuration.

The first implementation is read-only observability:

- discover resolver references from Traefik runtime
- read resolver definitions from an optional mounted Traefik static config
- read certificate state from an optional mounted `acme.json`
- show expiry, renewal attention, storage/read failures, and resolver gaps
- keep DNS provider credentials outside GateLite state and UI

## Current Findings

Current local Traefik static config is command-line based in `compose.yaml`.
It exposes the dashboard API, file provider, Docker provider, `web`, and
`websecure`, but it does not define ACME resolvers or ACME storage.

The Portainer GateLite stack mounts only:

- `/data/compose/1/dynamic:/dynamic`
- `/data/compose/1/certs:/certs`

GateLite currently writes dynamic file-provider config to `/dynamic/gatelite.yml`.
For resolver mode, it emits only router-level `tls.certResolver`. It does not
define `certificatesResolvers`, `acme.storage`, or DNS challenge credentials.

Traefik's own model matches this boundary: certificate resolvers are part of
static configuration, while dynamic routers reference them with `tls.certResolver`.
ACME storage is part of the resolver configuration. DNS challenge providers use
Traefik/lego environment variables owned by the Traefik process.

References:

- https://doc.traefik.io/traefik/reference/install-configuration/tls/certificate-resolvers/overview/
- https://doc.traefik.io/traefik/https/acme/

## Boundary

### GateLite Owns

- Human and agent-facing inventory of routes, TLS bindings, and ACME state.
- Read-only parsing of mounted Traefik static config and ACME storage.
- Correlating GateLite `source: "acme"` certificate references with Traefik
  resolver names and storage certificates.
- Warnings for missing storage, unreadable storage, expired certs, certs within
  30 days of expiry, and resolver references without visible certificates.
- Preview/apply workflow for dynamic routers that reference existing resolvers.

### Traefik Owns

- TLS termination.
- ACME account registration, challenge execution, issuance, renewal, and retry.
- `certificatesResolvers` static config.
- `acme.storage`.
- DNS provider credentials and lego provider environment variables.
- Runtime certificate selection.

### Explicit Non-Goals

- GateLite does not write production Traefik static config in this phase.
- GateLite does not store DNS provider plaintext secrets.
- GateLite does not call ACME CAs directly.
- GateLite does not edit `acme.json`.
- GateLite does not infer that a resolver is healthy when storage is missing.

## Data Flow

1. `getTraefikRuntime()` reads Traefik dashboard/API runtime as before.
2. `getAcmeStatus(runtime, state)` builds a read-only ACME view:
   - optional `GATELITE_TRAEFIK_STATIC_CONFIG_FILE`
   - optional `GATELITE_ACME_STORAGE_FILE`
   - runtime TLS resolver references
   - GateLite ACME certificate references
3. `enrichCertificatesWithAcmeRuntime()` adds `acmeRuntime` to ACME certificate
   rows without changing persisted GateLite state.
4. `/api/dashboard` returns both `acme` and enriched certificates.
5. `/api/acme/status` returns the same ACME view for agent/API consumers.
6. The SSL/TLS page shows an ACME operations panel plus per-certificate runtime
   status where a storage certificate matches the resolver and domains.

## Security Design

The only supported DNS credential design in this phase is external ownership:

- Traefik keeps DNS provider secrets in its own deployment environment.
- GateLite may display provider names such as `cloudflare` from static config.
- GateLite does not require or display token values.
- GateLite only needs read-only mounts for config/storage files.
- The production template includes optional env pointers but does not mount
  production ACME files automatically.

If GateLite later gains resolver editing, it must use a secret reference model
rather than plaintext state fields.

## Minimal Implementation

- Add shared ACME status types.
- Add optional config envs:
  - `GATELITE_TRAEFIK_STATIC_CONFIG_FILE`
  - `GATELITE_ACME_STORAGE_FILE`
- Add `server/acme.ts` for read-only static config and storage parsing.
- Add `/api/acme/status`.
- Add `DashboardPayload.acme`.
- Add `CertificateWithBindings.acmeRuntime`.
- Add an SSL/TLS ACME operations panel.
- Add tests for resolver parsing, storage certificate parsing, enrichment, and
  missing storage visibility.

## Production Rollout Plan

This change should be shipped as code first. Do not modify the live Traefik
stack or mounted ACME files as part of this implementation.

When ready for production observability:

1. Identify the real Traefik static config and ACME storage path.
2. Add read-only GateLite mounts for those files.
3. Set `GATELITE_TRAEFIK_STATIC_CONFIG_FILE` and `GATELITE_ACME_STORAGE_FILE`.
4. Verify `/api/acme/status` shows resolver and certificate state.
5. Verify existing public domains and current cert behavior still work.

Any change to Traefik resolver definitions, DNS provider env, or storage path is
a separate production change and needs its own backup and rollback plan.
