# GateLite v0.1.1 Release Polish Design

## Goal

Turn the existing v0.1.0 project release into a more comfortable self-hosted
release without tying the project to maintainer-owned infrastructure.

## Decisions

- Publish Docker images to GHCR from the release workflow while keeping the
  existing tar.gz artifact for offline installs.
- Add a short README quickstart for operators who already have Traefik, a
  Docker network, a dynamic config directory, and a certificate directory.
- Preserve the newly added logo assets and brand component. Treat them as
  release assets, not generated clutter.
- Add explicit certificate file cleanup as an admin-only, opt-in delete mode.
  Metadata-only delete remains available, and path-mode certificates keep their
  source files by default.
- Reduce the production bundle warning with route-level lazy imports rather
  than broad UI rewrites.
- Generate project screenshots into docs assets and reference them from the
  README.

## Safety Boundaries

- Only delete certificate files that are inside `GATELITE_CERT_DIR` and belong
  to GateLite-managed sources (`self-signed`, `upload`, or `sync`).
- Never delete files referenced by `path` certificates through the cleanup
  option.
- Keep bound-certificate protection unchanged.
- Do not alter or regenerate the user's logo files except by copying them into
  the release/package naturally through `public/`.

## Verification

- `npm run verify:release`
- targeted certificate deletion tests
- production build with no Rollup chunk warning
- GitHub CI on `main`
- release workflow with GHCR image and artifact
