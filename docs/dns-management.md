# DNS Management

GateLite can optionally manage a small Cloudflare DNS/DDNS allowlist. This is
intended for home-ingress records that should follow the current public IPv4
address.

DNS management is disabled by default. Enabling it requires GateLite auth:

```env
GATELITE_AUTH_ENABLED=true
GATELITE_AUTH_USERNAME=admin
GATELITE_AUTH_PASSWORD=<strong-password>
GATELITE_DNS_ENABLED=true
```

## Configuration

Cloudflare zone tokens are configured as `zone=token` pairs separated by
semicolons:

```env
GATELITE_CLOUDFLARE_ZONE_TOKENS=example.com=<token>;example.net=<token>
```

Managed records are configured as semicolon-separated entries:

```text
zone|type|name|content|proxied|ttl|comment
```

Use `@ipv4` as the content for records that should point at the discovered
public IPv4 address.

```env
GATELITE_DNS_RECORDS=example.com|A|example.com|@ipv4|true|1|Managed by GateLite;example.com|A|*.example.com|@ipv4|true|1|Managed by GateLite
```

GateLite discovers the current IPv4 from `GATELITE_DNS_PUBLIC_IPV4_URLS`, or
uses `GATELITE_DNS_TARGET_IPV4` when set.

## Safety Rules

- GateLite only touches records declared in `GATELITE_DNS_RECORDS`.
- GateLite does not delete records.
- GateLite reports A/CNAME conflicts as blocked.
- Cloudflare token values are never returned through API responses or the UI.
- `POST /api/dns/sync` is an admin operation.

## Current Zooe / 1804 Shape

The intended migration shape is:

```env
GATELITE_CLOUDFLARE_ZONE_TOKENS=zooe.cc=<zooe-token>;surfacer.cc=<surfacer-token>
GATELITE_DNS_RECORDS=zooe.cc|A|zooe.cc|@ipv4|true|1|Managed by GateLite;zooe.cc|A|*.zooe.cc|@ipv4|true|1|Managed by GateLite;zooe.cc|A|*.erp.zooe.cc|@ipv4|true|1|Managed by GateLite;zooe.cc|A|jberp.zooe.cc|@ipv4|true|1|Managed by GateLite;surfacer.cc|A|1804.surfacer.cc|@ipv4|false|300|Managed by GateLite;surfacer.cc|CNAME|*.1804.surfacer.cc|1804.surfacer.cc|false|1|1804 wildcard;surfacer.cc|CNAME|_acme-challenge.1804.surfacer.cc|_acme-challenge.1804-surfacer-acme.zooe.cc|false|120|ACME DNS-01 CNAME delegation to zooe primary
```

This keeps `*.1804.surfacer.cc` as a CNAME to `1804.surfacer.cc`, and keeps
`_acme-challenge.1804.surfacer.cc` delegated to the zooe ACME target. GateLite
updates only the A records that should follow the public IPv4.
