# GateLite Product Brief

## Positioning

GateLite is a companion/control-plane for Traefik OSS.

The product promise is:

> Lucky's ease of use + Traefik's runtime power + an API that AI agents can use
> without editing YAML by hand.

Traefik remains the runtime. GateLite manages workflows around Traefik:

- Web UI
- route rule management
- TLS/certificate setup entrypoints
- configuration generation
- validation and rollback
- agent-facing API

## Why GateLite Should Not Fork Traefik

Traefik core already owns reverse proxying, TLS termination, ACME, Docker,
file, Kubernetes, and other providers. Forking it would create an upstream
tracking burden and would shift GateLite away from its intended job.

GateLite should instead integrate with original Traefik OSS and treat Traefik's
API/configuration model as the source of truth.

## Primary Workflows

### Web Services / Reverse Proxy Rules

Goal: make it visually obvious which frontend domains are in use and which
backend IP:port each reverse proxy rule points to.

The first Web Services screen should answer:

- Which domains are currently active?
- Which router owns each domain?
- Which backend service receives the traffic?
- What are the per-row downstream bytes, upstream bytes, and current
  connection count from Traefik metrics?
- Is TLS enabled, passthrough, or missing?
- Which entrypoints and middlewares apply?
- Which provider produced the route?
- Does Traefik currently consider the route/service healthy or errored?

### SSL/TLS Certificate Management

Goal: let a newcomer configure certificates without starting from YAML.

The first SSL/TLS screen should answer:

- Which certificates exist?
- Which domains/SANs do they cover?
- Which resolver or source created them?
- When do they expire?
- Which routers use them?
- What needs attention before a domain is safe to expose?

### Dashboard Parity

Goal: GateLite should not make users switch back to the Traefik dashboard for
basic visibility.

GateLite should show Traefik dashboard/API-level information for:

- HTTP routers, services, and middlewares
- TCP routers, services, middlewares, and TLS settings
- UDP routers and services
- TLS options, stores, certificates, and resolvers where available
- providers and entrypoints
- configuration status/errors

## Agent API Principles

- Every write supports preview before apply.
- Web service create/update previews return the current YAML, next YAML, and a
  compact line diff through the same validation layer used by apply.
- Every apply returns a config diff and rollback handle.
- Validation errors are structured and repairable.
- Generated configuration is deterministic.
- Human UI and Agent API use the same backend validation layer.
- GateLite should prefer Traefik-supported configuration surfaces instead of
  inventing a private runtime format.
