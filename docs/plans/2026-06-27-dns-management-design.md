# GateLite DNS Management Migration Design

## Goal

Move the home-ingress DNS update loop from DDNS-Go into GateLite while keeping
the current Cloudflare and Traefik certificate boundaries intact.

GateLite should manage the Cloudflare DNS records that point public hostnames at
the current home ingress IP. It should not become a DNS registrar, a full
Cloudflare dashboard, or an ACME issuer.

## Current Production Shape

DDNS-Go currently has two Cloudflare-backed tasks:

- `zooe.cc`: `zooe.cc`, `*.zooe.cc`, `*.erp.zooe.cc`, `jberp.zooe.cc`
- `surfacer.cc`: `1804.surfacer.cc`, `*.1804.surfacer.cc`

The desired migration keeps the existing 1804 delegation shape:

- `1804.surfacer.cc` is the only 1804 A record GateLite updates.
- `*.1804.surfacer.cc` remains a CNAME to `1804.surfacer.cc`.
- `_acme-challenge.1804.surfacer.cc` remains a CNAME to
  `_acme-challenge.1804-surfacer-acme.zooe.cc`.

## Design

GateLite gets an optional DNS subsystem controlled by environment variables.
When enabled, it reads Cloudflare zone tokens, discovers the current public IPv4
address, compares declared DNS records with Cloudflare, and can either show the
plan or apply it.

The subsystem is deliberately allowlist-based: GateLite only touches records
listed in `GATELITE_DNS_RECORDS`. It does not enumerate all records and decide
what to delete. If a desired record conflicts with an existing CNAME/A shape, it
reports a blocked conflict instead of deleting the other record.

## Security

DNS management requires GateLite auth to be enabled. This prevents a public
GateLite instance from exposing a Cloudflare mutation endpoint without
credentials. Token values are read from environment variables and never returned
through the API or UI.

## API

- `GET /api/dns/status` returns current IP, declared records, Cloudflare state,
  pending actions, last sync, and warnings.
- `POST /api/dns/sync` applies the same plan and records the in-memory last sync
  result.

## UI

The DNS page is an operations surface, not a general DNS editor. It shows:

- whether DNS management is enabled
- current public IPv4 source
- zone/token readiness without token values
- each managed record's current state and desired state
- a manual sync button

## Deployment Plan

1. Ship code and tests.
2. Configure GateLite with both Cloudflare zone tokens and the allowlisted
   record set.
3. Enable GateLite auth.
4. Run a manual GateLite DNS sync and verify Cloudflare records.
5. Stop DDNS-Go so only GateLite owns the update loop.
6. Verify `gl.zooe.cc` and `gl.1804.surfacer.cc:16666`.
