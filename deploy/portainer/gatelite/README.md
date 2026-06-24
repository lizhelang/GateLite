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
