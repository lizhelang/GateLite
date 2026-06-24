import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CertificateItem, CertificateStatus } from "../shared/types";
import { config } from "./config";
import { createId } from "./ids";

interface ParsedCertificate {
  notBefore?: string;
  notAfter?: string;
  issuer?: string;
  subject?: string;
  domains: string[];
  status: CertificateStatus;
  statusMessage?: string;
}

export interface CertificateInput {
  name: string;
  enabled?: boolean;
  source: "self-signed" | "upload" | "path" | "acme" | "sync";
  domains: string[];
  certPem?: string;
  keyPem?: string;
  certPath?: string;
  keyPath?: string;
  days?: number;
  acme?: CertificateItem["acme"];
  sync?: CertificateItem["sync"];
}

export function normalizeDomains(domains: string[] | string | undefined): string[] {
  if (!domains) return [];
  const values = Array.isArray(domains) ? domains : domains.split(/[,\n]/);
  return Array.from(
    new Set(
      values
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export function createSelfSignedCertificate(name: string, domains: string[], days = 365): CertificateItem {
  fs.mkdirSync(config.certDir, { recursive: true });
  const id = createId("cert");
  const safeName = id.replace(/[^a-zA-Z0-9-]/g, "-");
  const certPath = path.join(config.certDir, `${safeName}.crt`);
  const keyPath = path.join(config.certDir, `${safeName}.key`);
  const commonName = domains[0] || "localhost";
  const subjectAltName = domains.length > 0 ? domains.map((domain) => `DNS:${domain}`).join(",") : "DNS:localhost";

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
      `/CN=${commonName}`,
      "-addext",
      `subjectAltName=${subjectAltName}`,
      "-keyout",
      keyPath,
      "-out",
      certPath
    ],
    { stdio: "ignore" }
  );

  const parsed = parseCertificate(certPath, domains);
  const now = new Date().toISOString();

  return {
    id,
    name,
    enabled: true,
    source: "self-signed",
    domains: parsed.domains.length ? parsed.domains : domains,
    certPath,
    keyPath,
    status: parsed.status,
    statusMessage: parsed.statusMessage,
    notBefore: parsed.notBefore,
    notAfter: parsed.notAfter,
    issuer: parsed.issuer,
    subject: parsed.subject,
    order: 0,
    createdAt: now,
    updatedAt: now
  };
}

export function createCertificateFromInput(input: CertificateInput): CertificateItem {
  const domains = normalizeDomains(input.domains);
  const now = new Date().toISOString();

  if (input.source === "self-signed") {
    const certificate = createSelfSignedCertificate(input.name, domains, input.days);
    return {
      ...certificate,
      enabled: input.enabled ?? true
    };
  }

  const id = createId("cert");
  let certPath = input.certPath;
  let keyPath = input.keyPath;

  if (input.source === "upload") {
    if (!input.certPem || !input.keyPem) {
      throw new Error("Certificate and private key PEM are required for upload mode.");
    }
    fs.mkdirSync(config.certDir, { recursive: true });
    certPath = path.join(config.certDir, `${id}.crt`);
    keyPath = path.join(config.certDir, `${id}.key`);
    fs.writeFileSync(certPath, input.certPem.trim() + "\n", "utf8");
    fs.writeFileSync(keyPath, input.keyPem.trim() + "\n", { encoding: "utf8", mode: 0o600 });
  }

  const parsed = certPath && fs.existsSync(certPath) ? parseCertificate(certPath, domains) : undefined;

  return {
    id,
    name: input.name,
    enabled: input.enabled ?? true,
    source: input.source,
    domains: parsed?.domains.length ? parsed.domains : domains,
    certPath,
    keyPath,
    status: parsed?.status ?? pendingStatusForSource(input.source),
    statusMessage: parsed?.statusMessage ?? statusMessageForUnreadableSource(input.source),
    notBefore: parsed?.notBefore,
    notAfter: parsed?.notAfter,
    issuer: parsed?.issuer,
    subject: parsed?.subject,
    order: 0,
    acme: input.acme,
    sync: input.sync,
    createdAt: now,
    updatedAt: now
  };
}

export function updateCertificateFromInput(current: CertificateItem, input: Partial<CertificateInput>): CertificateItem {
  const source = input.source ?? current.source;
  const domains = input.domains !== undefined ? normalizeDomains(input.domains) : current.domains;
  const name = input.name ?? current.name;
  const enabled = input.enabled ?? current.enabled;
  const now = new Date().toISOString();
  const base = {
    id: current.id,
    name,
    enabled,
    source,
    order: current.order,
    createdAt: current.createdAt,
    updatedAt: now
  };

  if (source === "self-signed") {
    const shouldRegenerate = current.source !== "self-signed" || input.domains !== undefined || input.days !== undefined;
    const certificate = shouldRegenerate ? createSelfSignedCertificate(name, domains, input.days ?? 365) : current;
    return {
      ...certificate,
      ...base,
      source: "self-signed",
      acme: undefined,
      sync: undefined
    };
  }

  let certPath = input.certPath ?? (source === current.source ? current.certPath : undefined);
  let keyPath = input.keyPath ?? (source === current.source ? current.keyPath : undefined);

  if (source === "upload") {
    const shouldWritePem = input.certPem !== undefined || input.keyPem !== undefined || (!certPath && !keyPath);
    if (shouldWritePem) {
      if (!input.certPem || !input.keyPem) {
        throw new Error("Certificate and private key PEM are required when replacing an uploaded certificate.");
      }
      fs.mkdirSync(config.certDir, { recursive: true });
      certPath = path.join(config.certDir, `${current.id}.crt`);
      keyPath = path.join(config.certDir, `${current.id}.key`);
      fs.writeFileSync(certPath, input.certPem.trim() + "\n", "utf8");
      fs.writeFileSync(keyPath, input.keyPem.trim() + "\n", { encoding: "utf8", mode: 0o600 });
    }
  }

  const readableCertPath = source === "acme" || source === "sync" ? undefined : certPath;
  const readableKeyPath = source === "acme" || source === "sync" ? undefined : keyPath;
  const parsed = readableCertPath && fs.existsSync(readableCertPath) ? parseCertificate(readableCertPath, domains) : undefined;

  return {
    ...base,
    domains: parsed?.domains.length ? parsed.domains : domains,
    certPath: readableCertPath,
    keyPath: readableKeyPath,
    status: parsed?.status ?? pendingStatusForSource(source),
    statusMessage: parsed?.statusMessage ?? statusMessageForUnreadableSource(source),
    notBefore: parsed?.notBefore,
    notAfter: parsed?.notAfter,
    issuer: parsed?.issuer,
    subject: parsed?.subject,
    acme: source === "acme" ? input.acme ?? current.acme : undefined,
    sync: source === "sync" ? input.sync ?? current.sync : undefined
  };
}

export function refreshCertificateMetadata(certificate: CertificateItem): CertificateItem {
  if (!certificate.certPath || !fs.existsSync(certificate.certPath)) {
    return {
      ...certificate,
      status: pendingStatusForSource(certificate.source),
      statusMessage: statusMessageForUnreadableSource(certificate.source)
    };
  }

  const parsed = parseCertificate(certificate.certPath, certificate.domains);
  return {
    ...certificate,
    domains: parsed.domains.length ? parsed.domains : certificate.domains,
    notBefore: parsed.notBefore,
    notAfter: parsed.notAfter,
    issuer: parsed.issuer,
    subject: parsed.subject,
    status: parsed.status,
    statusMessage: parsed.statusMessage
  };
}

export function parseCertificate(certPath: string, fallbackDomains: string[] = []): ParsedCertificate {
  try {
    const output = execFileSync("openssl", ["x509", "-in", certPath, "-noout", "-dates", "-issuer", "-subject", "-ext", "subjectAltName"], {
      encoding: "utf8"
    });
    const notBefore = readLineValue(output, "notBefore=");
    const notAfter = readLineValue(output, "notAfter=");
    const issuer = readLineValue(output, "issuer=");
    const subject = readLineValue(output, "subject=");
    const domains = extractDomains(output);
    const status = certificateStatus(notAfter);

    return {
      notBefore: notBefore ? new Date(notBefore).toISOString() : undefined,
      notAfter: notAfter ? new Date(notAfter).toISOString() : undefined,
      issuer,
      subject,
      domains: domains.length ? domains : fallbackDomains,
      status,
      statusMessage: status === "expired" ? "Certificate has expired." : status === "expiring" ? "Certificate expires within 30 days." : undefined
    };
  } catch (error) {
    return {
      domains: fallbackDomains,
      status: "invalid",
      statusMessage: error instanceof Error ? error.message : "Unable to parse certificate."
    };
  }
}

export function refreshCertificateFromAction(certificate: CertificateItem): CertificateItem {
  const now = new Date().toISOString();
  const next = refreshCertificateMetadata({
    ...certificate,
    updatedAt: now,
    sync: certificate.source === "sync" ? { ...(certificate.sync || {}), lastSyncTime: now } : certificate.sync
  });
  return {
    ...next,
    updatedAt: now
  };
}

function pendingStatusForSource(source: CertificateInput["source"]): CertificateStatus {
  return source === "acme" || source === "sync" ? "pending" : "invalid";
}

function statusMessageForUnreadableSource(source: CertificateInput["source"]): string {
  if (source === "acme") return "ACME resolver certificates are issued by Traefik at runtime.";
  if (source === "sync") return "Certificate sync target is registered; no local certificate bundle has been received yet.";
  return "Certificate file is missing.";
}

function readLineValue(output: string, prefix: string): string | undefined {
  const line = output
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix));
  return line?.slice(prefix.length).trim();
}

function extractDomains(output: string): string[] {
  const domains = new Set<string>();
  for (const match of output.matchAll(/DNS:([^,\s]+)/g)) {
    domains.add(match[1].toLowerCase());
  }
  return Array.from(domains);
}

function certificateStatus(notAfter?: string): CertificateStatus {
  if (!notAfter) return "invalid";
  const expiresAt = new Date(notAfter).getTime();
  const now = Date.now();
  if (Number.isNaN(expiresAt)) return "invalid";
  if (expiresAt < now) return "expired";
  if (expiresAt - now <= 30 * 24 * 60 * 60 * 1000) return "expiring";
  return "valid";
}
