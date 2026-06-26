import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CertificateWithBindings, GateLiteState, TraefikRuntime } from "../shared/types";

let tmpDir = "";

beforeEach(() => {
  vi.resetModules();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gatelite-acme-"));
});

afterEach(() => {
  delete process.env.GATELITE_TRAEFIK_STATIC_CONFIG_FILE;
  delete process.env.GATELITE_ACME_STORAGE_FILE;
  vi.useRealTimers();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("ACME runtime status", () => {
  it("reads resolver definitions and ACME storage certificates without exposing provider secrets", async () => {
    const acmeStoragePath = path.join(tmpDir, "acme.json");
    const staticConfigPath = path.join(tmpDir, "traefik.yml");
    writeAcmeStorage(acmeStoragePath, "cloudflare", "secure.example.com", ["*.example.com"]);
    fs.writeFileSync(
      staticConfigPath,
      [
        "certificatesResolvers:",
        "  cloudflare:",
        "    acme:",
        "      email: ops@example.com",
        `      storage: ${acmeStoragePath}`,
        "      dnsChallenge:",
        "        provider: cloudflare",
        "        resolvers:",
        "          - 1.1.1.1:53"
      ].join("\n"),
      "utf8"
    );
    process.env.GATELITE_TRAEFIK_STATIC_CONFIG_FILE = staticConfigPath;

    const { getAcmeStatus } = await import("../server/acme");
    const status = getAcmeStatus(runtimeWithResolver("cloudflare"), emptyState());

    expect(status.staticConfigReadable).toBe(true);
    expect(status.storageFiles[0]).toMatchObject({ path: acmeStoragePath, readable: true, resolverNames: ["cloudflare"] });
    expect(status.resolvers[0]).toMatchObject({
      name: "cloudflare",
      status: "online",
      email: "ops@example.com",
      challenge: { type: "dns-01", provider: "cloudflare" },
      certificateCount: 1,
      renewalState: "ok"
    });
    expect(JSON.stringify(status)).not.toContain("CF_DNS_API_TOKEN");
    expect(status.certificates[0]).toMatchObject({
      resolver: "cloudflare",
      status: "valid",
      renewalState: "ok"
    });
    expect(status.certificates[0].domains).toContain("secure.example.com");
  });

  it("enriches GateLite ACME certificate references from matching storage certificates", async () => {
    const acmeStoragePath = path.join(tmpDir, "acme.json");
    writeAcmeStorage(acmeStoragePath, "letsencrypt", "app.example.com", ["www.example.com"]);
    process.env.GATELITE_ACME_STORAGE_FILE = acmeStoragePath;

    const { enrichCertificatesWithAcmeRuntime, getAcmeStatus } = await import("../server/acme");
    const state = emptyState();
    const acme = getAcmeStatus(runtimeWithResolver("letsencrypt"), state);
    const [certificate] = enrichCertificatesWithAcmeRuntime(
      [
        {
          id: "cert-acme",
          name: "App ACME",
          enabled: true,
          source: "acme",
          domains: ["app.example.com"],
          status: "pending",
          order: 1,
          acme: { resolver: "letsencrypt", dnsProvider: "cloudflare" },
          createdAt: "2026-06-26T00:00:00.000Z",
          updatedAt: "2026-06-26T00:00:00.000Z",
          boundServices: []
        }
      ],
      acme
    );

    expect(certificate.acmeRuntime).toMatchObject({
      resolver: "letsencrypt",
      resolverStatus: "online",
      status: "valid",
      renewalState: "ok"
    });
    expect(certificate.acmeRuntime?.matches[0].domains).toContain("app.example.com");
  });

  it("lets the explicit GateLite ACME storage file override Traefik container storage paths", async () => {
    const acmeStoragePath = path.join(tmpDir, "mounted-acme.json");
    const staticConfigPath = path.join(tmpDir, "traefik.yml");
    writeAcmeStorage(acmeStoragePath, "letsencrypt", "mounted.example.com", []);
    fs.writeFileSync(
      staticConfigPath,
      [
        "certificatesResolvers:",
        "  letsencrypt:",
        "    acme:",
        "      email: ops@example.com",
        "      storage: /letsencrypt/acme.json",
        "      httpChallenge:",
        "        entryPoint: web"
      ].join("\n"),
      "utf8"
    );
    process.env.GATELITE_TRAEFIK_STATIC_CONFIG_FILE = staticConfigPath;
    process.env.GATELITE_ACME_STORAGE_FILE = acmeStoragePath;

    const { getAcmeStatus } = await import("../server/acme");
    const status = getAcmeStatus(runtimeWithResolver("letsencrypt"), emptyState());

    expect(status.storageFiles).toHaveLength(1);
    expect(status.storageFiles[0]).toMatchObject({ path: acmeStoragePath, source: "env", readable: true });
    expect(status.warnings.some((warning) => warning.includes("/letsencrypt/acme.json"))).toBe(false);
  });

  it("marks static resolvers missing when the mapped storage has no resolver entry", async () => {
    const acmeStoragePath = path.join(tmpDir, "mounted-acme.json");
    const staticConfigPath = path.join(tmpDir, "traefik.yml");
    writeAcmeStorage(acmeStoragePath, "letsencrypt", "mounted.example.com", []);
    fs.writeFileSync(
      staticConfigPath,
      [
        "certificatesResolvers:",
        "  letsencrypt:",
        "    acme:",
        "      storage: /letsencrypt/acme.json",
        "      httpChallenge:",
        "        entryPoint: web",
        "  cloudflare:",
        "    acme:",
        "      storage: /cloudflare/acme.json",
        "      dnsChallenge:",
        "        provider: cloudflare"
      ].join("\n"),
      "utf8"
    );
    process.env.GATELITE_TRAEFIK_STATIC_CONFIG_FILE = staticConfigPath;
    process.env.GATELITE_ACME_STORAGE_FILE = acmeStoragePath;

    const { getAcmeStatus } = await import("../server/acme");
    const status = getAcmeStatus(runtimeWithResolver("letsencrypt"), emptyState());
    const cloudflare = status.resolvers.find((resolver) => resolver.name === "cloudflare");

    expect(cloudflare).toMatchObject({
      status: "warning",
      renewalState: "missing",
      certificateCount: 0,
      statusMessage: "ACME storage is readable, but no entry for this resolver was found."
    });
  });

  it("reports expiring and expired ACME certificates as renewal attention states", async () => {
    const acmeStoragePath = path.join(tmpDir, "acme.json");
    fs.writeFileSync(
      acmeStoragePath,
      JSON.stringify(
        {
          expiring: acmeStorageResolver("soon.example.com", [], 10),
          expired: acmeStorageResolver("old.example.com", [], 1)
        },
        null,
        2
      ),
      "utf8"
    );
    process.env.GATELITE_ACME_STORAGE_FILE = acmeStoragePath;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));

    const { getAcmeStatus } = await import("../server/acme");
    const status = getAcmeStatus(runtimeWithResolver("expiring"), emptyState());
    const expiring = status.certificates.find((certificate) => certificate.resolver === "expiring");
    const expired = status.certificates.find((certificate) => certificate.resolver === "expired");

    expect(expiring).toMatchObject({ status: "expiring", renewalState: "due-soon" });
    expect(expired).toMatchObject({ status: "expired", renewalState: "expired" });
    expect(status.resolvers.find((resolver) => resolver.name === "expired")).toMatchObject({ status: "warning", renewalState: "expired" });
  });

  it("keeps missing ACME storage visible instead of inventing a healthy state", async () => {
    process.env.GATELITE_ACME_STORAGE_FILE = path.join(tmpDir, "missing-acme.json");

    const { getAcmeStatus } = await import("../server/acme");
    const state = emptyState();
    state.certificates.push({
      id: "cert-acme",
      name: "Missing ACME",
      enabled: true,
      source: "acme",
      domains: ["missing.example.com"],
      status: "pending",
      order: 1,
      acme: { resolver: "letsencrypt" },
      createdAt: "2026-06-26T00:00:00.000Z",
      updatedAt: "2026-06-26T00:00:00.000Z"
    });

    const status = getAcmeStatus(runtimeWithResolver("letsencrypt"), state);

    expect(status.storageFiles[0]).toMatchObject({ readable: false });
    expect(status.resolvers[0]).toMatchObject({
      name: "letsencrypt",
      status: "warning",
      renewalState: "unreadable"
    });
    expect(status.warnings.some((warning) => warning.includes("does not exist"))).toBe(true);
  });
});

function writeAcmeStorage(filePath: string, resolver: string, mainDomain: string, sans: string[], days = 90) {
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        [resolver]: acmeStorageResolver(mainDomain, sans, days)
      },
      null,
      2
    ),
    "utf8"
  );
}

function acmeStorageResolver(mainDomain: string, sans: string[], days = 90) {
  const certPem = createTemporaryCertificate(mainDomain, sans, days);
  return {
    Account: {
      Email: "ops@example.com"
    },
    Certificates: [
      {
        domain: {
          main: mainDomain,
          sans
        },
        certificate: Buffer.from(certPem, "utf8").toString("base64"),
        key: "redacted",
        Store: "default"
      }
    ]
  };
}

function createTemporaryCertificate(mainDomain: string, sans: string[], days = 90): string {
  const certPath = path.join(tmpDir, `${mainDomain}.crt`);
  const keyPath = path.join(tmpDir, `${mainDomain}.key`);
  const subjectAltName = [mainDomain, ...sans].map((domain) => `DNS:${domain}`).join(",");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-nodes",
      "-days",
      String(days),
      "-subj",
      `/CN=${mainDomain}`,
      "-addext",
      `subjectAltName=${subjectAltName}`,
      "-keyout",
      keyPath,
      "-out",
      certPath
    ],
    { stdio: "ignore" }
  );
  return fs.readFileSync(certPath, "utf8");
}

function emptyState(): GateLiteState {
  return {
    version: 1,
    groups: [{ id: "local", name: "Local", order: 1 }],
    webServices: [],
    certificates: [],
    history: []
  };
}

function runtimeWithResolver(resolver: string): TraefikRuntime {
  return {
    connected: true,
    apiUrl: "http://traefik:8080",
    entryPoints: [],
    routers: [],
    services: [],
    middlewares: [],
    tls: {
      routers: [
        {
          name: "app@file",
          protocol: "http",
          provider: "file",
          rule: "Host(`app.example.com`)",
          service: "app@file",
          entryPoints: ["websecure"],
          middlewares: [],
          domains: ["app.example.com"],
          tls: true,
          tlsResolver: resolver,
          status: "online"
        }
      ],
      certificates: [],
      options: [],
      stores: [],
      resolvers: [
        {
          name: resolver,
          domains: [],
          detail: "Referenced by TLS router",
          source: "router",
          status: "online"
        }
      ],
      available: true
    }
  };
}
