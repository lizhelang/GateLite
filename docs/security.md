# GateLite Security And Access Control

GateLite can change Traefik routes, certificate bindings, and optionally
Cloudflare DNS records, so public deployments should put it behind access
control. The built-in access control is off by default for local development and
existing private deployments.

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
| `admin` | Everything, including private-key download, certificate sync receive, DNS sync, history rollback, bulk import, and certificate deletion. |

Basic auth currently maps to `admin`, because it is meant for the trusted
operator opening the browser UI. Use Bearer tokens when agents need narrower
roles.

## Agent API Idempotency

State-changing API requests can include `Idempotency-Key` or
`X-Idempotency-Key`. GateLite stores successful apply responses server-side next
to the state file and replays them only when the method, path, query, and JSON
body match. Reusing a key for a different request returns a conflict instead of
applying a second change.

## Certificate File Deletion

Deleting a certificate normally removes only GateLite metadata. Admin users can
also choose to clean up GateLite-managed PEM files during deletion.

File cleanup is intentionally narrow:

- `self-signed`, `upload`, and `sync` certificates can clean up local `.crt` and
  `.key` files that live inside `GATELITE_CERT_DIR`.
- `path` certificates never delete their referenced source files; GateLite
  treats those as externally managed.
- `acme` certificates do not delete ACME storage because Traefik owns
  `acme.json` and renewal state.
- Cleanup refuses any path outside `GATELITE_CERT_DIR`.

## Cloudflare DNS Tokens

Cloudflare DNS/DDNS management is disabled by default. If
`GATELITE_DNS_ENABLED=true`, GateLite also requires `GATELITE_AUTH_ENABLED=true`
at startup. This prevents a public unauthenticated GateLite instance from
exposing DNS write operations.

Cloudflare tokens should be provided through
`GATELITE_CLOUDFLARE_ZONE_TOKENS`. GateLite uses them only server-side and does
not write them to state, backups, API responses, or the browser UI.

## External Access Control

It is also valid to keep built-in auth disabled and protect GateLite with an
external layer, such as Traefik BasicAuth, ForwardAuth, Cloudflare Access, VPN,
or an IP allowlist. Do not expose an unauthenticated GateLite instance on a
public network.
