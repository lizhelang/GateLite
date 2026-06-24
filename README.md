# GateLite

Simple, agent-friendly control panel for Traefik.

GateLite is a lightweight management panel for Traefik OSS. It aims to combine
Lucky-style ease of use, Traefik's underlying proxy capabilities, and a stable
API surface that AI agents and scripts can use safely.

GateLite is not a Traefik fork and does not replace Traefik core. It is a
companion control plane: Traefik continues to own reverse proxying, TLS, ACME,
Docker provider, file provider, Kubernetes integrations, and runtime routing.
GateLite stays above that layer and focuses on human-friendly workflows,
configuration generation, rollback, and agent-friendly automation.

## Core Users

- Humans who want to fill in a domain, backend address, and certificate method,
  then save without writing YAML first.
- AI agents and scripts that need stable APIs for creating, updating, deleting,
  and auditing routes without directly editing Traefik configuration files.

## Initial Product Scope

1. Web services / reverse proxy rules
   - Show which domains are currently in use.
   - Show each frontend domain, backend IP:port, downstream/upstream bytes, and
     live connection count in one dense rule row.
   - Connect each rule to its router, service, entrypoints, middleware chain,
     TLS mode, provider, and current health/config status.
   - Make common route creation feel closer to Lucky than raw Traefik YAML.

2. SSL/TLS certificate management
   - Provide guided certificate setup for beginners.
   - Support viewing certificate coverage, expiry, resolver/source, and
     associated domains.
   - Generate the needed Traefik dynamic or install configuration instead of
     forcing new users to write YAML at the start.

3. Traefik dashboard parity
   - Surface the information Traefik's own dashboard/API exposes: routers,
     services, middlewares, TLS objects, providers, entrypoints, and routing
     status across HTTP, TCP, and UDP where available.
   - Keep Traefik OSS as the runtime source of truth.

4. Agent API
   - Stable HTTP API for route and certificate workflows.
   - Explicit dry-run, diff, apply, and rollback operations.
   - Machine-readable validation errors so agents can repair requests without
     guessing.

## Non-Goals

- Forking Traefik.
- Reimplementing Traefik's proxy engine.
- Hiding advanced Traefik concepts when users need them.
- Making direct production changes without preview, validation, and rollback.

## Repository Status

This repository now contains the first local development module:

- React/Vite management frontend
- Express API companion
- Traefik file-provider configuration generation
- Docker Compose Traefik + whoami test environment
- Web services and SSL/TLS certificate management pages

## Local Development

Install dependencies:

```bash
npm install
```

Start local Traefik and the sample backend:

```bash
npm run compose:up
```

Start GateLite:

```bash
npm run dev
```

Open:

- GateLite frontend: http://localhost:5173
- GateLite API: http://localhost:3001/api/health
- Traefik dashboard/API: http://localhost:18081
- Traefik Prometheus metrics: http://localhost:18081/metrics
- HTTP test route: http://whoami.localhost:18080
- HTTPS test route: https://secure.localhost:18443

The first server start creates local runtime state under `runtime/`, generates a
self-signed development certificate, and writes Traefik dynamic configuration
to `runtime/traefik/gatelite.yml`.

The local Traefik container enables Prometheus router/service metrics so the
GateLite overview can plot managed-domain request activity from real Traefik
counters instead of static preview data.

Run checks:

```bash
npm run build
npm run test
npm run verify:local
npm run verify:crud
```

`npm run verify:local` assumes `npm run compose:up` and `npm run dev` are
already running. It checks the local Traefik API, the GateLite API connection,
the generated dynamic configuration, and both seeded HTTP/HTTPS whoami routes.
`npm run verify:crud` uses temporary `*.localhost` domains to exercise Web
service, group, and certificate create/edit/toggle/reorder/delete flows against
the same local Traefik stack, then removes those temporary resources.

## References

- Traefik API and dashboard documentation:
  https://doc.traefik.io/traefik/operations/dashboard/
- Traefik dynamic routing configuration methods:
  https://doc.traefik.io/traefik/reference/routing-configuration/dynamic-configuration-methods/
- Traefik TLS documentation:
  https://doc.traefik.io/traefik/https/tls/
