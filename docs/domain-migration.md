# GateLite Deployment Domain Migration

This checklist is for operators moving their own GateLite deployment from one
public hostname to another. Released GateLite artifacts do not ship with a
maintainer-owned public domain as the default target.

## Checklist

1. DNS points the new hostname to the active Traefik ingress.
2. Cloudflare or upstream CDN proxying matches the desired TLS mode.
3. The Portainer GateLite stack uses the current compose template and
   `GATELITE_SEED_DEMO=false`.
4. The Traefik router rule includes the intended host, for example:

   ```text
   Host(`gatelite.example.com`)
   ```

5. `/api/health` returns `ok=true` on the new host.
6. The browser shell loads from the new host.
7. Any old links are either updated, redirected, or intentionally documented as
   legacy.

Run:

```bash
GATELITE_PUBLIC_URLS=https://gatelite.example.com npm run verify:domains
```

If the new host fails while a legacy host still works, treat the problem as a
deployment domain migration issue rather than an application release failure.
Check DNS, CDN, Traefik router labels, and the live Portainer stack definition
separately.
