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

1. Web services
   - Show which domains are currently in use.
   - Connect each domain to its router, service, backend target, entrypoints,
     middleware chain, TLS mode, provider, and current health/config status.
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

This repository currently contains the initial product brief and implementation
roadmap. Runtime implementation is intentionally still open so the first code
commit can choose a stack and API shape deliberately.

## References

- Traefik API and dashboard documentation:
  https://doc.traefik.io/traefik/operations/dashboard/
- Traefik dynamic routing configuration methods:
  https://doc.traefik.io/traefik/reference/routing-configuration/dynamic-configuration-methods/
- Traefik TLS documentation:
  https://doc.traefik.io/traefik/https/tls/

