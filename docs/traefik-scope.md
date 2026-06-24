# Traefik Information Scope

GateLite should mirror Traefik OSS visibility before it attempts advanced
editing. The first implementation should treat Traefik's API/dashboard output
as runtime truth and GateLite-managed files as desired configuration.

## Runtime Objects To Surface

| Area | Objects |
| --- | --- |
| HTTP | routers, services, middlewares |
| TCP | routers, services, middlewares, TLS settings |
| UDP | routers, services |
| TLS | certificates, stores, options, resolver/source metadata where available |
| Platform | providers, entrypoints, configuration errors/status |

Current GateLite runtime payload normalizes HTTP/TCP/UDP routers and services
with an explicit protocol field, normalizes HTTP/TCP middlewares, and extracts
a TLS runtime summary from Traefik raw data plus TLS-enabled routers. If the
Traefik dashboard API does not expose certificate, store, option, or resolver
inventory, the UI keeps that absence visible instead of hiding it in raw JSON.

## Domain-Centric Projection

Traefik is router-centric. GateLite should add a domain-centric projection for
humans:

- domain or host matcher
- router name and provider
- backend service and server URLs
- entrypoints
- middleware chain
- TLS mode and certificate/resolver
- router-level observability: access logs, metrics, and tracing
- status and last validation result

## Configuration Surfaces

GateLite should start with Traefik-supported configuration surfaces:

- File/structured provider for deterministic generated configuration.
- Docker labels as read-only discovery first, with write support only after the
  workflow is clearly safe.
- Kubernetes resources as read-only discovery first.

References:

- https://doc.traefik.io/traefik/operations/dashboard/
- https://doc.traefik.io/traefik/reference/routing-configuration/dynamic-configuration-methods/
- https://doc.traefik.io/traefik/reference/routing-configuration/http/routing/observability/
- https://doc.traefik.io/traefik/reference/install-configuration/tls/certificate-resolvers/overview/
