import { describe, expect, it } from "vitest";
import { normalizeMiddlewares, normalizeRouters, normalizeServices, normalizeTlsSummary } from "../server/traefik";

describe("Traefik runtime normalization", () => {
  it("keeps protocol and TLS settings for TCP routers", () => {
    const [router] = normalizeRouters(
      [
        {
          name: "db@file",
          provider: "file",
          rule: "HostSNI(`db.localhost`)",
          service: "db-svc@file",
          entryPoints: ["db"],
          tls: {
            certResolver: "letsencrypt",
            options: "strict@file",
            passthrough: true
          },
          status: "enabled"
        }
      ],
      "tcp"
    );

    expect(router.protocol).toBe("tcp");
    expect(router.domains).toEqual(["db.localhost"]);
    expect(router.tls).toBe(true);
    expect(router.tlsResolver).toBe("letsencrypt");
    expect(router.tlsOptions).toBe("strict@file");
    expect(router.tlsPassthrough).toBe(true);
  });

  it("normalizes TCP middlewares and UDP services without losing protocol", () => {
    const [middleware] = normalizeMiddlewares(
      [{ name: "allow-lan@file", provider: "file", type: "ipallowlist", usedBy: ["db@file"], status: "enabled" }],
      "tcp"
    );
    const [service] = normalizeServices([{ name: "dns@file", status: "enabled", loadBalancer: { servers: [{ address: "192.168.1.2:53" }] } }], "udp");

    expect(middleware.protocol).toBe("tcp");
    expect(middleware.usedBy).toEqual(["db@file"]);
    expect(service.protocol).toBe("udp");
    expect(service.servers).toEqual(["192.168.1.2:53"]);
  });

  it("extracts TLS inventory and resolver references where Traefik exposes them", () => {
    const routers = normalizeRouters(
      [{ name: "secure@file", rule: "Host(`secure.localhost`)", tls: { certResolver: "letsencrypt" }, status: "enabled" }],
      "http"
    );
    const tls = normalizeTlsSummary(
      {
        tls: {
          certificates: [{ name: "local-dev", domains: ["secure.localhost"], certFile: "/certs/dev.crt", status: "enabled" }],
          options: { "strict@file": { minVersion: "VersionTLS13", status: "enabled" } },
          stores: { default: { defaultCertificate: "local-dev", status: "enabled" } }
        }
      },
      routers
    );

    expect(tls.available).toBe(true);
    expect(tls.routers).toHaveLength(1);
    expect(tls.certificates[0]).toMatchObject({ name: "local-dev", domains: ["secure.localhost"], status: "online" });
    expect(tls.options[0]).toMatchObject({ name: "strict@file", detail: "minVersion: VersionTLS13" });
    expect(tls.stores[0]).toMatchObject({ name: "default", detail: "defaultCertificate: local-dev" });
    expect(tls.resolvers[0]).toMatchObject({ name: "letsencrypt", source: "router", status: "online" });
  });
});
