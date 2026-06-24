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
- Simple/custom mode -> Host rules for normal use, default fallback rules for
  unmatched domains, and custom Traefik rule text for advanced `Host(...) &&
  PathPrefix(...)` style routing.
- Domain list -> `Host(...)` rule projection.
- Listening port -> local host port hint for the configured Traefik entrypoint.
- Backend address -> Traefik service server URL.
- Backend Host forwarding -> per-service `passHostHeader` switch, defaulting to
  Traefik's normal frontend Host behavior.
- TLS/SNI -> file certificate or cert-resolver mode.
- Default rule / unmatched-domain fallback -> managed Traefik catch-all router
  using `PathPrefix(`/`)` with low priority.
- Grouped display -> GateLite group metadata, independent of Traefik runtime.
- Group create/rename -> shadcn-style modal form so grouping operations use
  the same interaction pattern as rule and certificate forms.
- Group reorder -> Web service group chips can be dragged to persist group
  order, matching Lucky's list-first management model.
- Drag reorder -> GateLite metadata order and deterministic generated YAML order.
- Copy rule/sub-rule data -> prefilled `copy as new rule` form that keeps
  backend, TLS, group, and middleware settings while generating a safe
  `copy-` frontend domain.
- Multi-select rows -> shadcn-style table selection with batch enable/disable
  for visible Web service rules.
- Web service page shape -> dense reverse-proxy rule table, matching the
  Lucky mental model that Web 服务 means reverse proxy rules. Each row leads
  with frontend domain -> backend IP:port and then shows downstream/upstream
  bytes plus current connection count instead of a bulky service card.
- Web service toolbar -> top-level creation is always a blank `New rule` for
  a new main-domain rule; `New sub-rule` appears directly in the toolbar after
  the user selects a concrete main domain, and also in that domain's table
  header. This keeps sub-rules scoped to an existing domain the way Lucky
  presents them.
- Main-domain metadata -> GateLite stores the user-selected main domain as
  management metadata (`domainRoot`) so `jb.1804.surfacer.cc` stays grouped
  under `1804.surfacer.cc` during edit, duplicate, and sub-rule creation
  instead of being guessed back to `surfacer.cc`. Traefik generation still uses
  the concrete frontend Host domain.
- Rule row density -> each reverse-proxy rule is a single shadcn-style data
  table row with rule name, frontend domain, backend IP:port, downstream
  traffic, upstream traffic, live connection count, and status. The frontend
  cell leads with the domain name, while protocol/port are secondary; the
  backend cell leads with host:port.
- Lucky-style traffic columns -> each Web service rule row shows downstream
  and upstream byte rates from Prometheus counters, with cumulative bytes kept
  as secondary context.
- Live connection count -> service-level Traefik connection metrics are used
  when available; otherwise the table shows the Traefik entrypoint aggregate
  with an explicit `entrypoint` source label.
- Lucky-style rule creation -> `New rule` asks for a main frontend domain and
  backend IP:port without inheriting the currently filtered domain. `New
  sub-rule` is only enabled inside a selected main domain, or from that
  domain's table header. It pre-fills the main domain and inherits TLS,
  entrypoints, middleware, and group settings only when that domain has an
  explicit `@` rule, avoiding accidental inheritance from an arbitrary sibling
  sub-rule. The form opens on a lightweight `frontend domain -> backend
  IP:port` mapping first, with Traefik-specific controls folded into advanced
  settings.
- Web service detail view -> explicit row action opens a compact rule detail
  dialog with frontend/backend mapping, generated Traefik rule, runtime status,
  TLS, Host header behavior, traffic, and notes.
- Access log / service log entry points -> per-rule Traefik router
  observability switches for access logs, Prometheus metrics, and tracing.
- Web service save validation -> rejects missing groups, missing/disabled
  file certificates, ACME/sync certificates used in file-certificate mode, and
  invalid/pending/expired file certificates before writing generated Traefik
  config.
- Web service dry-run preview -> the rule form can call the same create/update
  preview API before saving, showing a compact generated YAML diff without
  writing GateLite state or the Traefik file-provider file.
- Backend address input -> accepts Lucky-style bare `IP:port` / `host:port`
  values from both UI and agent API, normalizing them to Traefik server URLs
  before writing file-provider config.
- Domain occupancy protection -> enabled Host rules cannot reuse the same
  frontend domain on the same Traefik entrypoint, and disabled duplicate
  drafts are blocked when enabled, keeping the domain list truthful and the
  generated router set unambiguous.
- One row / one Host rule -> normal reverse-proxy rules accept exactly one
  frontend domain. Additional domains must be modeled as separate rules or
  sub-rules so table actions do not silently edit or delete multiple rows at
  once.

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
- PEM upload by local file picker or paste, plus existing path registration.
- Uploaded PEM certificates are covered by the local CRUD verifier: a temporary
  PEM bundle is uploaded, bound to an HTTPS Web service, reached through
  Traefik, and then cleaned up.
- Existing path certificates are covered by the local CRUD verifier using a
  temporary PEM bundle written into the Docker-mounted certificate directory,
  then registered by path, bound to HTTPS, reached through Traefik, and
  cleaned up.
- Existing path certificate creation is constrained to the configured
  `GATELITE_CERT_DIR` so the Docker Traefik container can actually read those
  files through the `/certs` mount instead of generating unusable YAML.
- ACME resolver reference for Traefik-managed issuance.
- Certificate status from `openssl x509` metadata where files are available.
- Expiry status: valid, expiring, expired, pending, invalid.
- Refresh/sync status action -> row-level certificate status refresh that
  re-reads local PEM metadata and records `lastSyncTime` for sync targets.
- Certificate sync receive -> sync certificate rows expose a PEM receive
  action and the agent API can import a synced PEM bundle into the Docker-
  mounted certificate store, turning a pending sync target into a bindable
  Traefik TLS certificate while preserving bound-domain coverage checks.
- Binding view from Web services using a certificate ID.
- ACME resolver binding view from Web services using the same resolver name.
- PEM bundle download for locally readable certificate/key pairs.
- Drag reorder for certificate list metadata and generated TLS certificate order.
- Copy certificate configuration -> prefilled `copy as new certificate` form
  that keeps domains and ACME/sync/path settings, with the copied item disabled
  until the user reviews and enables it.
- Multi-select rows -> shadcn-style table selection with batch enable/disable
  for visible certificate items.
- Certificate detail view -> explicit row action opens a metadata and binding
  dialog, keeping the primary certificate table dense and scannable.
- Certificate binding expansion -> bound certificate rows can be expanded
  inline to show Lucky-style frontend domain -> backend IP:port mappings,
  rule name, entrypoint, TLS mode, and SAN coverage without leaving the list.
- Bound certificate protection -> certificates still bound to Web service
  rules cannot be disabled, deleted, moved to runtime-only sources, have their
  resolver changed, replace certificate files, or drop SAN coverage for bound
  domains, preventing active TLS routes from losing their generated certificate
  material.
- Bound certificate edit UX -> the SSL/TLS edit dialog mirrors the server-side
  protection by locking source, SAN, certificate file, resolver, sync target,
  validity and enabled-state controls while still allowing safe metadata edits.
- Certificate dry-run preview -> the SSL/TLS form can preview path, ACME, sync,
  and metadata-only changes through the same API used by agents. PEM-generating
  self-signed/upload changes surface the server-side apply-only warning instead
  of pretending to be no-side-effect previews.

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

## Bilingual UI Verification

- `npm run verify:ui-i18n` uses Playwright against the running local frontend to
  force Chinese and English language modes through `localStorage`, then checks
  the Web services and SSL/TLS certificate navigation labels, key actions,
  table columns, and inline certificate binding expansion.
