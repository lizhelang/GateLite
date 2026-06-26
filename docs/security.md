# GateLite Security And Access Control

GateLite can change Traefik routes and certificate bindings, so public
deployments should put it behind access control. The built-in access control is
off by default for local development and existing private deployments.

## Enable Built-In Access Control

Set:

```bash
GATELITE_AUTH_ENABLED=true
GATELITE_AUTH_USERNAME=admin
GATELITE_AUTH_PASSWORD=<strong-password>
```

This protects the browser UI and API with Basic auth. `/api/health` remains
public for uptime checks and only reports non-secret status.

API clients can also use Bearer tokens:

```bash
GATELITE_VIEWER_TOKEN=<read-only-token>
GATELITE_AGENT_TOKEN=<agent-token>
GATELITE_OPERATOR_TOKEN=<operator-token>
GATELITE_ADMIN_TOKEN=<admin-token>
```

Or compact form:

```bash
GATELITE_AUTH_TOKENS=viewer:<token>,agent:<token>,operator:<token>,admin:<token>
```

## Roles

| Role | Can do |
| --- | --- |
| `viewer` | Open the UI and read dashboard, runtime, services, certificates, history, and generated config. |
| `agent` | Same write level as `operator`, intended for machine clients. Cannot perform admin-only secret or rollback operations. |
| `operator` | Create, edit, toggle, reorder, and preview Web services, groups, and normal certificate metadata. |
| `admin` | Everything, including private-key download, certificate sync receive, history rollback, bulk import, and certificate deletion. |

Basic auth currently maps to `admin`, because it is meant for the trusted
operator opening the browser UI. Use Bearer tokens when agents need narrower
roles.

## External Access Control

It is also valid to keep built-in auth disabled and protect GateLite with an
external layer, such as Traefik BasicAuth, ForwardAuth, Cloudflare Access, VPN,
or an IP allowlist. Do not expose an unauthenticated GateLite instance on a
public network.
