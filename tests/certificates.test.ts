import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

const certDir = fs.mkdtempSync(path.join(os.tmpdir(), "gatelite-certs-"));
process.env.GATELITE_CERT_DIR = certDir;

const { createCertificateFromInput, receiveSyncedCertificate, refreshCertificateFromAction } = await import("../server/certificates");

afterAll(() => {
  fs.rmSync(certDir, { recursive: true, force: true });
});

describe("createCertificateFromInput", () => {
  it("preserves the enabled flag for self-signed certificates", () => {
    const certificate = createCertificateFromInput({
      name: "Disabled local cert",
      enabled: false,
      source: "self-signed",
      domains: ["disabled.localhost"],
      days: 1
    });

    expect(certificate.enabled).toBe(false);
    expect(certificate.source).toBe("self-signed");
    expect(certificate.domains).toContain("disabled.localhost");
  });

  it("treats sync certificates as pending and records refresh time", () => {
    const certificate = createCertificateFromInput({
      name: "Sync target",
      enabled: true,
      source: "sync",
      domains: ["sync.localhost"],
      sync: { target: "https://peer.example.com/api/ssl/sync" }
    });

    expect(certificate.status).toBe("pending");
    expect(certificate.statusMessage).toContain("sync target");

    const refreshed = refreshCertificateFromAction(certificate);

    expect(refreshed.status).toBe("pending");
    expect(refreshed.sync?.lastSyncTime).toBeTruthy();
  });

  it("receives synced PEM bundles into the mounted certificate directory", () => {
    const certificate = createCertificateFromInput({
      name: "Sync target",
      enabled: true,
      source: "sync",
      domains: ["sync-received.localhost"],
      sync: { target: "https://peer.example.com/api/ssl/sync" }
    });
    const { certPem, keyPem } = createTemporaryPemBundle("sync-received.localhost");

    const received = receiveSyncedCertificate(certificate, {
      certPem,
      keyPem,
      domains: ["sync-received.localhost"]
    });

    expect(received.source).toBe("sync");
    expect(received.status).toBe("valid");
    expect(received.domains).toContain("sync-received.localhost");
    expect(received.certPath?.startsWith(certDir)).toBe(true);
    expect(received.keyPath?.startsWith(certDir)).toBe(true);
    expect(received.sync?.lastSyncTime).toBeTruthy();
    expect(received.notAfter).toBeTruthy();
  });

  it("accepts existing path certificates only from the mounted certificate directory", () => {
    const certPath = path.join(certDir, "path-valid.crt");
    const keyPath = path.join(certDir, "path-valid.key");
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
        "90",
        "-subj",
        "/CN=path.localhost",
        "-addext",
        "subjectAltName=DNS:path.localhost",
        "-keyout",
        keyPath,
        "-out",
        certPath
      ],
      { stdio: "ignore" }
    );

    const certificate = createCertificateFromInput({
      name: "Path cert",
      enabled: true,
      source: "path",
      domains: ["path.localhost"],
      certPath,
      keyPath
    });

    expect(certificate.status).toBe("valid");
    expect(certificate.certPath).toBe(certPath);
    expect(certificate.keyPath).toBe(keyPath);
    expect(certificate.domains).toContain("path.localhost");
  });

  it("rejects existing path certificates outside the mounted certificate directory", () => {
    const outsidePath = path.join(os.tmpdir(), `outside-${Date.now()}.crt`);
    fs.writeFileSync(outsidePath, "");

    try {
      expect(() =>
        createCertificateFromInput({
          name: "Outside path",
          enabled: true,
          source: "path",
          domains: ["outside.localhost"],
          certPath: outsidePath,
          keyPath: outsidePath
        })
      ).toThrow(/must be inside/);
    } finally {
      fs.rmSync(outsidePath, { force: true });
    }
  });
});

function createTemporaryPemBundle(host: string): { certPem: string; keyPem: string } {
  const certPath = path.join(certDir, `${host}.crt`);
  const keyPath = path.join(certDir, `${host}.key`);
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
      "90",
      "-subj",
      `/CN=${host}`,
      "-addext",
      `subjectAltName=DNS:${host}`,
      "-keyout",
      keyPath,
      "-out",
      certPath
    ],
    { stdio: "ignore" }
  );
  return {
    certPem: fs.readFileSync(certPath, "utf8"),
    keyPem: fs.readFileSync(keyPath, "utf8")
  };
}
