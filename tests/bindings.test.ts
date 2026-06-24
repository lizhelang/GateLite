import { describe, expect, it } from "vitest";
import type { CertificateItem, WebService } from "../shared/types";
import { isWebServiceBoundToCertificate, webServicesBoundToCertificate } from "../server/bindings";

const now = new Date().toISOString();

function certificate(overrides: Partial<CertificateItem>): CertificateItem {
  return {
    id: "cert-local",
    name: "Local certificate",
    enabled: true,
    source: "self-signed",
    domains: ["secure.localhost"],
    status: "valid",
    order: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function webService(overrides: Partial<WebService>): WebService {
  return {
    id: "svc-web",
    name: "Web rule",
    enabled: true,
    matchMode: "host",
    groupId: "local",
    domains: ["secure.localhost"],
    listenPort: 18443,
    entryPoints: ["websecure"],
    targetUrl: "http://whoami:80",
    passHostHeader: true,
    middlewares: [],
    tls: { mode: "none" },
    order: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe("certificate bindings", () => {
  it("matches file certificates by certificate id", () => {
    const item = certificate({ id: "cert-a" });
    const service = webService({ tls: { mode: "file-certificate", certificateId: "cert-a" } });

    expect(isWebServiceBoundToCertificate(item, service)).toBe(true);
  });

  it("matches ACME certificates by resolver name", () => {
    const item = certificate({ id: "cert-acme", source: "acme", acme: { resolver: "Cloudflare" }, status: "pending" });
    const service = webService({ tls: { mode: "resolver", resolver: "cloudflare" } });

    expect(isWebServiceBoundToCertificate(item, service)).toBe(true);
  });

  it("uses the Traefik resolver default when resolver names are omitted", () => {
    const item = certificate({ id: "cert-acme", source: "acme", acme: {}, status: "pending" });
    const service = webService({ tls: { mode: "resolver" } });

    expect(isWebServiceBoundToCertificate(item, service)).toBe(true);
  });

  it("does not bind resolver services to unrelated certificates", () => {
    const fileCertificate = certificate({ id: "cert-file" });
    const acmeCertificate = certificate({ id: "cert-acme", source: "acme", acme: { resolver: "letsencrypt" }, status: "pending" });
    const service = webService({ tls: { mode: "resolver", resolver: "step-ca" } });

    expect(isWebServiceBoundToCertificate(fileCertificate, service)).toBe(false);
    expect(isWebServiceBoundToCertificate(acmeCertificate, service)).toBe(false);
  });

  it("returns every Web rule bound to a certificate", () => {
    const item = certificate({ id: "cert-acme", source: "acme", acme: { resolver: "letsencrypt" }, status: "pending" });
    const bound = webService({ id: "svc-bound", tls: { mode: "resolver", resolver: "letsencrypt" } });
    const unbound = webService({ id: "svc-unbound", tls: { mode: "resolver", resolver: "cloudflare" } });

    expect(webServicesBoundToCertificate(item, [bound, unbound]).map((service) => service.id)).toEqual(["svc-bound"]);
  });
});
