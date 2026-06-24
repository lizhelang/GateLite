# Lucky Feature Audit For GateLite MVP

This audit is based on the referenced Lucky routes and their static page chunks:

- `/web` route: `WebService`, title `Web服务`
- `/ssl` route: `SSL`, title `SSL/TLS证书`

The reference site is reachable, but live authenticated data was not available
in this workspace. The first GateLite implementation therefore follows the
observable route/chunk behavior and maps it to Traefik OSS concepts.

## Web 服务 Core Behaviors

Lucky behaviors observed from the Web service chunk:

- Main rule list with empty state and add button.
- Add, edit, delete Web service rules.
- Enable/disable main rules.
- Rule name can be blank.
- Simple/custom operating modes.
- Listening type, address, and port.
- Domain list display with count and quick open.
- Backend address display.
- TLS/SNI-related options.
- Sub-rules with add/edit/delete and enable/disable.
- Default rule and unmatched-domain fallback concepts.
- Security settings, access log, and service log entry points.
- Group management: grouped display, flat display, group filter, ungrouped
  filter, group context menu.
- Drag reorder for main rules and sub-rules.
- Copy/drag main rule and sub-rule data.

GateLite MVP mapping:

- Main rule -> managed Traefik HTTP router plus load-balancer service.
- Blank rule name -> accepted in state/API, with domain fallback in the UI.
- Domain list -> `Host(...)` rule projection.
- Listening port -> local host port hint for the configured Traefik entrypoint.
- Backend address -> Traefik service server URL.
- TLS/SNI -> file certificate or cert-resolver mode.
- Default rule / unmatched-domain fallback -> managed Traefik catch-all router
  using `PathPrefix(`/`)` with low priority.
- Grouped display -> GateLite group metadata, independent of Traefik runtime.
- Drag reorder -> GateLite metadata order and deterministic generated YAML order.

## SSL/TLS Core Behaviors

Lucky behaviors observed from the SSL chunk:

- Certificate list with remark/name, source, validity dates, domains/SANs, CA,
  DNS provider, and status.
- Certificate sources: file, path, ACME, certificate sync.
- Add/edit/delete certificate items.
- Enable/disable certificate items.
- Download certificate.
- ACME cancel/sync actions and ACME-in-progress status.
- Certificate sync clients and sync status.
- Order adjustment via drag list.
- Copy/drag certificate configuration from SSL/DDNS contexts.

GateLite MVP mapping:

- Self-signed local certificate generation for immediate Docker validation.
- PEM upload and existing path registration.
- ACME resolver reference for Traefik-managed issuance.
- Certificate status from `openssl x509` metadata where files are available.
- Expiry status: valid, expiring, expired, pending, invalid.
- Binding view from Web services using a certificate ID.
- PEM bundle download for locally readable certificate/key pairs.
- Drag reorder for certificate list metadata and generated TLS certificate order.

## Parallax Storytelling Design Mapping

The referenced style guide defines Parallax Storytelling as scroll-driven,
layered, immersive, progressive disclosure with fixed/sticky layers and
scroll-triggered reveal. It recommends dark cinematic colors such as
`#1A1A2E`, `#16213E`, `#0F3460` with accent colors `#E94560` and `#F39C12`.

GateLite adapts this to an operational tool by using:

- Fixed typographic watermark layer.
- Subtle background grid depth.
- Sticky section headers as narrative anchors.
- Progressive page sections for Web services, certificates, and runtime truth.
- Dense, readable operational rows instead of marketing-only story panels.
