import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const certDir = fs.mkdtempSync(path.join(os.tmpdir(), "gatelite-certs-"));
process.env.GATELITE_CERT_DIR = certDir;

const { createCertificateFromInput } = await import("../server/certificates");

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
});
