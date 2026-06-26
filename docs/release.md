# GateLite Release Process

## Version Strategy

GateLite uses semantic versions:

- `0.1.0` starts the private beta line.
- `0.1.1` starts the easier self-hosted install line with GHCR images.
- Patch releases, such as `0.1.1`, are bug fixes and deployment fixes.
- Minor releases, such as `0.2.0`, add user-visible capabilities.
- Major releases are reserved for incompatible state, API, or deployment
  changes.

Docker image tags should match the version tag, for example:

```bash
ghcr.io/lizhelang/gatelite:0.1.1
ghcr.io/lizhelang/gatelite:latest
```

The release workflow also uploads `gatelite-<version>.tar.gz` for offline
installs where pulling from GHCR is not practical.

## Local Release Gate

Run:

```bash
npm run verify:release
```

This runs typecheck, unit tests, production build, and production dependency
audit. For a specific production deployment, also run:

```bash
npm run backup
npm run verify:domains
```

`verify:domains` checks the URLs in `GATELITE_PUBLIC_URLS`. It has no project
default because released GateLite artifacts must not point at any maintainer's
private domains:

```bash
GATELITE_PUBLIC_URLS=https://gatelite.example.com npm run verify:domains
```

## CI Gate

GitHub Actions runs the same core checks on pushes and pull requests:

- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run audit:prod`
- Docker image build

Tag pushes matching `v*` run the release workflow and upload a compressed Docker
image artifact.

## Rollback

Keep the previously running Docker image tag and a fresh GateLite backup before
deploying. If the release fails:

1. Restore the previous image tag in Portainer.
2. Restore GateLite state if the failed release wrote bad state.
3. Verify `/api/health`, `/api/dashboard`, and your deployment domains.
