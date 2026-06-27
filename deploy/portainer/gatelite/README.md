# GateLite Portainer Stack

This stack deploys GateLite as a companion for the existing Portainer-managed
Traefik stack.

Expected existing Traefik shape:

- Docker network: `proxy`
- Traefik API reachable from the `proxy` network as `http://traefik:8080`
- Traefik dynamic directory on the Docker host: `/data/compose/1/dynamic`
- Traefik certificate directory on the Docker host: `/data/compose/1/certs`
- Traefik file provider configured with `--providers.file.directory=/dynamic`

GateLite writes generated dynamic config to `/dynamic/gatelite.yml` and stores
its own state in the `gatelite_data` Docker volume. Production deployment sets
`GATELITE_SEED_DEMO=false` so the first boot starts empty instead of creating
local `whoami.localhost` demo routes.

ACME observability is optional and read-only. To let GateLite display Traefik
resolver definitions and certificate expiry state, mount the Traefik static
config and ACME storage file into the GateLite container as read-only paths,
then set:

```env
GATELITE_TRAEFIK_STATIC_CONFIG_FILE=/readonly-traefik/traefik.yml
GATELITE_ACME_STORAGE_FILE=/readonly-acme/acme.json
```

Traefik continues to own ACME issuance and reads ACME provider credentials from
its own secret environment. GateLite can optionally own Cloudflare DNS/DDNS
updates for an explicit allowlist of records. When enabled, keep Cloudflare
tokens in environment variables only; GateLite never writes them to state or
returns them through the API/UI.

Set `GATELITE_HOST` to the hostname that points to your own Traefik ingress.
The template defaults to `gatelite.example.com` only as a placeholder. For
multi-host deployments, edit the Traefik router rule intentionally instead of
shipping maintainer-owned domains in the project template.

Built-in GateLite authentication is disabled by default. To enable it in
Portainer, set at least one credential:

```env
GATELITE_AUTH_ENABLED=true
GATELITE_AUTH_USERNAME=admin
GATELITE_AUTH_PASSWORD=<strong-password>
```

For API clients, use role-scoped Bearer tokens such as
`GATELITE_AGENT_TOKEN` or `GATELITE_ADMIN_TOKEN`.

Cloudflare DNS/DDNS management is disabled by default and requires GateLite
auth when enabled:

```env
GATELITE_DNS_ENABLED=true
GATELITE_CLOUDFLARE_ZONE_TOKENS=example.com=<cloudflare-token>
GATELITE_DNS_RECORDS=example.com|A|example.com|@ipv4|true|1|Managed by GateLite;example.com|A|*.example.com|@ipv4|true|1|Managed by GateLite
```

GateLite only creates or updates the declared records. It reports A/CNAME
conflicts instead of deleting existing records.

Before updating this stack, run `npm run backup` against the current runtime
state. After updating it, verify:

```bash
GATELITE_PUBLIC_URLS=https://gatelite.example.com npm run verify:domains
```
