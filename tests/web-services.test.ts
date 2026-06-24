import { describe, expect, it } from "vitest";
import type { CertificateItem, GateLiteState, WebService } from "../shared/types";
import { validateWebService, webServiceLabel } from "../server/web-services";
import { BadRequestError } from "../server/errors";
import { normalizeBackendTargetUrl, webServiceInputSchema } from "../server/schemas";

const now = new Date().toISOString();

function certificate(overrides: Partial<CertificateItem> = {}): CertificateItem {
  return {
    id: "cert-valid",
    name: "Valid certificate",
    enabled: true,
    source: "self-signed",
    domains: ["secure.localhost"],
    certPath: "/repo/runtime/certs/valid.crt",
    keyPath: "/repo/runtime/certs/valid.key",
    status: "valid",
    order: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function webService(overrides: Partial<WebService> = {}): WebService {
  return {
    id: "svc-web",
    name: "Secure rule",
    enabled: true,
    matchMode: "host",
    groupId: "local",
    domains: ["secure.localhost"],
    listenPort: 18443,
    entryPoints: ["websecure"],
    targetUrl: "http://whoami:80",
    passHostHeader: true,
    middlewares: [],
    tls: { mode: "file-certificate", certificateId: "cert-valid" },
    order: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function state(overrides: Partial<GateLiteState> = {}): GateLiteState {
  return {
    version: 1,
    groups: [{ id: "local", name: "Local Docker", order: 1 }],
    certificates: [certificate()],
    webServices: [],
    history: [],
    ...overrides
  };
}

describe("validateWebService", () => {
  it("accepts a valid file-certificate Web service in an existing group", () => {
    expect(() => validateWebService(webService(), state())).not.toThrow();
  });

  it("rejects a missing group reference", () => {
    expect(() => validateWebService(webService({ groupId: "missing" }), state())).toThrow(BadRequestError);
  });

  it("rejects a missing file certificate reference", () => {
    expect(() => validateWebService(webService({ tls: { mode: "file-certificate", certificateId: "missing" } }), state())).toThrow(/Certificate does not exist/);
  });

  it("rejects disabled file certificates", () => {
    expect(() =>
      validateWebService(webService(), state({ certificates: [certificate({ enabled: false })] }))
    ).toThrow(/disabled/);
  });

  it("rejects ACME certificates in file-certificate mode", () => {
    expect(() =>
      validateWebService(
        webService({ tls: { mode: "file-certificate", certificateId: "cert-acme" } }),
        state({ certificates: [certificate({ id: "cert-acme", source: "acme", status: "pending", certPath: undefined, keyPath: undefined })] })
      )
    ).toThrow(/cannot be used/);
  });

  it("accepts synced certificates after a local PEM bundle has been received", () => {
    expect(() =>
      validateWebService(
        webService({ tls: { mode: "file-certificate", certificateId: "cert-sync" } }),
        state({ certificates: [certificate({ id: "cert-sync", source: "sync", status: "valid" })] })
      )
    ).not.toThrow();
  });

  it("rejects pending sync certificates before local PEM material is available", () => {
    expect(() =>
      validateWebService(
        webService({ tls: { mode: "file-certificate", certificateId: "cert-sync" } }),
        state({ certificates: [certificate({ id: "cert-sync", source: "sync", status: "pending", certPath: undefined, keyPath: undefined })] })
      )
    ).toThrow(/readable certificate/);
  });

  it("rejects invalid, pending, and expired file certificates", () => {
    for (const status of ["invalid", "pending", "expired"] as const) {
      expect(() =>
        validateWebService(webService(), state({ certificates: [certificate({ status })] }))
      ).toThrow(new RegExp(status));
    }
  });

  it("keeps blank rule names displayable by domain", () => {
    expect(webServiceLabel(webService({ name: "" }))).toBe("secure.localhost");
  });

  it("rejects duplicate enabled frontend domains on the same entrypoint", () => {
    const existing = webService({ id: "svc-existing", domains: ["app.localhost"], entryPoints: ["web"] });
    const duplicate = webService({ id: "svc-duplicate", domains: ["app.localhost"], entryPoints: ["web"], tls: { mode: "none" } });

    expect(() => validateWebService(duplicate, state({ webServices: [existing] }))).toThrow(/already used/);
  });

  it("allows the same frontend domain on different entrypoints", () => {
    const existing = webService({ id: "svc-existing", domains: ["app.localhost"], entryPoints: ["web"], tls: { mode: "none" } });
    const secure = webService({ id: "svc-secure", domains: ["app.localhost"], entryPoints: ["websecure"] });

    expect(() => validateWebService(secure, state({ webServices: [existing] }))).not.toThrow();
  });

  it("allows editing the same service without treating its own domain as a conflict", () => {
    const existing = webService({ id: "svc-existing", domains: ["app.localhost"], entryPoints: ["websecure"] });
    const edited = webService({ id: "svc-existing", name: "Renamed", domains: ["app.localhost"], entryPoints: ["websecure"] });

    expect(() => validateWebService(edited, state({ webServices: [existing] }))).not.toThrow();
  });

  it("rejects duplicate enabled default fallback rules on the same entrypoint", () => {
    const existing = webService({ id: "svc-default-a", matchMode: "default", domains: [], entryPoints: ["web"], tls: { mode: "none" } });
    const duplicate = webService({ id: "svc-default-b", matchMode: "default", domains: [], entryPoints: ["web"], tls: { mode: "none" } });

    expect(() => validateWebService(duplicate, state({ webServices: [existing] }))).toThrow(/Default fallback already exists/);
  });
});

describe("webServiceInputSchema", () => {
  it("accepts Lucky-style bare backend IP:port values and normalizes them for Traefik", () => {
    const parsed = webServiceInputSchema.parse({
      name: "",
      enabled: true,
      groupId: "local",
      domains: ["plain.localhost"],
      listenPort: 18080,
      entryPoints: ["web"],
      targetUrl: "192.168.31.26:8081",
      middlewares: [],
      tls: { mode: "none" }
    });

    expect(parsed.targetUrl).toBe("http://192.168.31.26:8081");
    expect(normalizeBackendTargetUrl("whoami:80")).toBe("http://whoami:80");
  });

  it("preserves explicit HTTPS backend targets", () => {
    const parsed = webServiceInputSchema.parse({
      name: "",
      enabled: true,
      groupId: "local",
      domains: ["secure-backend.localhost"],
      listenPort: 18443,
      entryPoints: ["websecure"],
      targetUrl: "https://192.168.31.2:8006",
      middlewares: [],
      tls: { mode: "none" }
    });

    expect(parsed.targetUrl).toBe("https://192.168.31.2:8006");
  });
});
