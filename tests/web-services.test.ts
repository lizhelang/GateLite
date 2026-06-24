import { describe, expect, it } from "vitest";
import type { CertificateItem, GateLiteState, WebService } from "../shared/types";
import { validateWebService, webServiceLabel } from "../server/web-services";
import { BadRequestError } from "../server/errors";

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
});
