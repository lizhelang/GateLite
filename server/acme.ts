import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type {
  AcmeCertificateMatch,
  AcmeCertificateRuntime,
  AcmeChallengeType,
  AcmeRenewalState,
  AcmeResolverChallenge,
  AcmeResolverState,
  AcmeStatus,
  AcmeStorageFileStatus,
  CertificateStatus,
  CertificateWithBindings,
  GateLiteState,
  RuntimeStatus,
  TraefikRuntime
} from "../shared/types";
import { resolverName } from "./bindings";
import { config } from "./config";

interface StaticResolver {
  name: string;
  email?: string;
  caServer?: string;
  storagePath?: string;
  challenge?: AcmeResolverChallenge;
}

interface ParsedStorage {
  status: AcmeStorageFileStatus;
  certificates: AcmeCertificateRuntime[];
}

export function getAcmeStatus(runtime: TraefikRuntime, state: GateLiteState): AcmeStatus {
  const staticResult = readStaticResolvers();
  const storageResults = readAcmeStorages(staticResult.resolvers);
  const certificates = storageResults.flatMap((result) => result.certificates);
  const warnings: string[] = [];

  if (staticResult.warning) warnings.push(staticResult.warning);
  for (const result of storageResults) {
    if (result.status.error) warnings.push(`ACME storage ${result.status.path}: ${result.status.error}`);
  }
  if (!config.acmeStorageFile && storageResults.length === 0) {
    warnings.push("Set GATELITE_ACME_STORAGE_FILE or mount the Traefik static config to let GateLite read ACME certificate state.");
  }

  const resolvers = buildResolverStates(runtime, state, staticResult.resolvers, storageResults);

  return {
    available: resolvers.length > 0 || certificates.length > 0 || storageResults.some((result) => result.status.readable),
    updatedAt: new Date().toISOString(),
    staticConfigPath: config.traefikStaticConfigFile,
    staticConfigReadable: staticResult.readable,
    staticConfigError: staticResult.error,
    storageFiles: storageResults.map((result) => result.status),
    resolvers,
    certificates,
    warnings
  };
}

export function enrichCertificatesWithAcmeRuntime(certificates: CertificateWithBindings[], acme: AcmeStatus): CertificateWithBindings[] {
  return certificates.map((certificate) => {
    if (certificate.source !== "acme") return certificate;
    const resolver = resolverName(certificate.acme?.resolver);
    const resolverState = acme.resolvers.find((item) => resolverName(item.name) === resolver);
    const matches = acme.certificates.filter((item) => resolverName(item.resolver) === resolver && certificateMatchesDomains(item, certificate.domains));
    const best = bestCertificateMatch(matches);
    return {
      ...certificate,
      acmeRuntime: {
        resolver: certificate.acme?.resolver || "letsencrypt",
        resolverStatus: resolverState?.status || "unknown",
        storageReadable: resolverState?.storageReadable,
        matches: matches.map(toCertificateMatch),
        status: best?.status || (resolverState?.storageReadable === false ? "pending" : certificate.status),
        renewalState: best?.renewalState || (resolverState?.storageReadable === false ? "unreadable" : "unknown"),
        statusMessage:
          best?.statusMessage ||
          resolverState?.statusMessage ||
          (matches.length === 0 ? "No matching ACME storage certificate was found for this resolver and domain set." : undefined)
      }
    };
  });
}

function readStaticResolvers(): { readable: boolean; resolvers: StaticResolver[]; error?: string; warning?: string } {
  const filePath = config.traefikStaticConfigFile;
  if (!filePath) {
    return {
      readable: false,
      resolvers: [],
      warning: "Traefik static config is not mounted into GateLite, so resolver definitions are inferred from runtime references and ACME storage only."
    };
  }
  if (!fs.existsSync(filePath)) {
    return {
      readable: false,
      resolvers: [],
      error: "Configured static config file does not exist.",
      warning: "Configured Traefik static config file is not readable."
    };
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = YAML.parse(raw);
    return {
      readable: true,
      resolvers: parseStaticResolvers(asRecord(parsed))
    };
  } catch (error) {
    return {
      readable: false,
      resolvers: [],
      error: error instanceof Error ? error.message : "Unable to parse Traefik static config.",
      warning: "Traefik static config could not be parsed."
    };
  }
}

function parseStaticResolvers(root: Record<string, unknown>): StaticResolver[] {
  const candidates = root.certificatesResolvers || root.certificateResolvers;
  const record = asRecord(candidates);
  return Object.entries(record)
    .map(([name, value]) => {
      const resolver = asRecord(value);
      const acme = asRecord(resolver.acme || resolver.ACME);
      return {
        name,
        email: readString(acme.email),
        caServer: readString(acme.caServer),
        storagePath: readString(acme.storage),
        challenge: readChallenge(acme)
      };
    })
    .filter((resolver) => resolver.name.trim());
}

function readChallenge(acme: Record<string, unknown>): AcmeResolverChallenge | undefined {
  const dnsChallenge = asRecord(acme.dnsChallenge);
  if (Object.keys(dnsChallenge).length) {
    return {
      type: "dns-01",
      provider: readString(dnsChallenge.provider),
      delayBeforeCheck: readString(dnsChallenge.delayBeforeCheck),
      resolvers: readStringList(dnsChallenge.resolvers)
    };
  }

  const httpChallenge = asRecord(acme.httpChallenge);
  if (Object.keys(httpChallenge).length) {
    return {
      type: "http-01",
      entryPoint: readString(httpChallenge.entryPoint)
    };
  }

  const tlsChallenge = asRecord(acme.tlsChallenge);
  if (Object.keys(tlsChallenge).length) {
    return {
      type: "tls-alpn-01"
    };
  }

  return undefined;
}

function readAcmeStorages(staticResolvers: StaticResolver[]): ParsedStorage[] {
  if (config.acmeStorageFile) {
    return [readAcmeStorage(config.acmeStorageFile, "env")];
  }

  const storagePaths = new Map<string, "env" | "static-config">();
  for (const resolver of staticResolvers) {
    if (resolver.storagePath) storagePaths.set(resolveRuntimePath(resolver.storagePath), "static-config");
  }
  return Array.from(storagePaths.entries()).map(([filePath, source]) => readAcmeStorage(filePath, source));
}

function readAcmeStorage(filePath: string, source: "env" | "static-config"): ParsedStorage {
  const status: AcmeStorageFileStatus = {
    path: filePath,
    source,
    readable: false,
    resolverNames: []
  };

  if (!fs.existsSync(filePath)) {
    return {
      status: {
        ...status,
        error: "Storage file does not exist in the GateLite container."
      },
      certificates: []
    };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const root = asRecord(raw);
    const resolverNames = Object.keys(root).filter((name) => name.trim());
    const certificates = resolverNames.flatMap((resolver) => readStorageCertificates(resolver, root[resolver]));

    return {
      status: {
        ...status,
        readable: true,
        resolverNames
      },
      certificates
    };
  } catch (error) {
    return {
      status: {
        ...status,
        error: error instanceof Error ? error.message : "Unable to parse ACME storage."
      },
      certificates: []
    };
  }
}

function readStorageCertificates(resolver: string, value: unknown): AcmeCertificateRuntime[] {
  const record = asRecord(value);
  const certificates = Array.isArray(record.Certificates) ? record.Certificates : Array.isArray(record.certificates) ? record.certificates : [];
  return certificates.map((item) => readStorageCertificate(resolver, item));
}

function readStorageCertificate(resolver: string, value: unknown): AcmeCertificateRuntime {
  const record = asRecord(value);
  const domain = asRecord(record.domain || record.Domain);
  const mainDomain = readString(domain.main || domain.Main);
  const sans = readStringList(domain.sans || domain.SANs);
  const fallbackDomains = normalizeDomains([mainDomain, ...sans]);
  const encodedCertificate = readString(record.certificate || record.Certificate);
  const parsed = encodedCertificate ? parseStoredCertificate(encodedCertificate, fallbackDomains) : undefined;
  const status: CertificateStatus = parsed?.status || "invalid";
  const statusMessage = parsed?.statusMessage || (encodedCertificate ? undefined : "ACME storage entry does not contain certificate material.");

  return {
    resolver,
    mainDomain,
    sans,
    domains: parsed?.domains.length ? parsed.domains : fallbackDomains,
    store: readString(record.Store || record.store),
    notBefore: parsed?.notBefore,
    notAfter: parsed?.notAfter,
    issuer: parsed?.issuer,
    subject: parsed?.subject,
    status,
    renewalState: renewalStateForStatus(status),
    statusMessage
  };
}

function parseStoredCertificate(encoded: string, fallbackDomains: string[]): Omit<AcmeCertificateRuntime, "resolver" | "sans" | "mainDomain" | "store" | "renewalState"> | undefined {
  const candidates: Array<string | Buffer> = [Buffer.from(encoded, "base64"), encoded];
  for (const candidate of candidates) {
    try {
      const certificate = new X509Certificate(candidate);
      const notBefore = new Date(certificate.validFrom).toISOString();
      const notAfter = new Date(certificate.validTo).toISOString();
      const status = certificateStatus(notAfter);
      return {
        domains: domainsFromCertificate(certificate, fallbackDomains),
        notBefore,
        notAfter,
        issuer: certificate.issuer,
        subject: certificate.subject,
        status,
        statusMessage: statusMessageForStatus(status)
      };
    } catch {
      // Try the next representation. Traefik stores base64 certificate data,
      // but accepting raw PEM keeps fixture and migration parsing forgiving.
    }
  }
  return {
    domains: fallbackDomains,
    status: "invalid",
    statusMessage: "Unable to parse the certificate stored in ACME storage."
  };
}

function buildResolverStates(runtime: TraefikRuntime, state: GateLiteState, staticResolvers: StaticResolver[], storageResults: ParsedStorage[]): AcmeResolverState[] {
  const resolverMap = new Map<string, AcmeResolverState>();
  const staticByResolver = new Map(staticResolvers.map((resolver) => [resolverName(resolver.name), resolver]));
  const storageByResolver = new Map<string, ParsedStorage>();
  const unreadableStorage = storageResults.find((result) => !result.status.readable);
  const hasReadableStorage = storageResults.some((result) => result.status.readable);
  const certificates = storageResults.flatMap((result) => {
    for (const resolver of result.status.resolverNames) {
      storageByResolver.set(resolverName(resolver), result);
    }
    return result.certificates;
  });

  const ensure = (name: string): AcmeResolverState => {
    const key = resolverName(name);
    const existing = resolverMap.get(key);
    if (existing) return existing;
    const state: AcmeResolverState = {
      name: name || "letsencrypt",
      status: "unknown",
      sources: [],
      certificateCount: 0,
      renewalState: "unknown"
    };
    resolverMap.set(key, state);
    return state;
  };

  for (const resolver of staticResolvers) {
    const entry = ensure(resolver.name);
    addSource(entry, "static-config");
    entry.email = resolver.email;
    entry.caServer = resolver.caServer;
    entry.storagePath = resolver.storagePath ? resolveRuntimePath(resolver.storagePath) : entry.storagePath;
    entry.challenge = resolver.challenge || entry.challenge;
  }

  for (const item of runtime.tls.resolvers) {
    const entry = ensure(item.name);
    addSource(entry, item.source === "traefik-api" ? "traefik-api" : "router");
  }

  for (const router of runtime.tls.routers) {
    if (router.tlsResolver) addSource(ensure(router.tlsResolver), "router");
  }

  for (const certificate of state.certificates) {
    if (certificate.source === "acme") addSource(ensure(certificate.acme?.resolver || "letsencrypt"), "gatelite-state");
  }

  for (const result of storageResults) {
    for (const resolver of result.status.resolverNames) {
      const entry = ensure(resolver);
      addSource(entry, "acme-storage");
      entry.storagePath = result.status.path;
      entry.storageReadable = result.status.readable;
    }
  }

  for (const entry of resolverMap.values()) {
    const key = resolverName(entry.name);
    const resolverCertificates = certificates.filter((certificate) => resolverName(certificate.resolver) === key);
    const storage = storageByResolver.get(key);
    const staticResolver = staticByResolver.get(key);
    const storageMissing = Boolean((config.acmeStorageFile || staticResolver?.storagePath) && hasReadableStorage && !storage);
    entry.certificateCount = resolverCertificates.length;
    entry.storageReadable = storage?.status.readable ?? entry.storageReadable ?? (unreadableStorage ? false : undefined);
    entry.storagePath = storage?.status.path || entry.storagePath || unreadableStorage?.status.path;
    entry.renewalState = resolverRenewalState(resolverCertificates, entry.storageReadable, storageMissing);
    entry.status = resolverStatus(entry, resolverCertificates, storageMissing);
    entry.statusMessage = resolverStatusMessage(entry, resolverCertificates, storageMissing);
  }

  return Array.from(resolverMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function resolverStatus(entry: AcmeResolverState, certificates: AcmeCertificateRuntime[], storageMissing: boolean): RuntimeStatus {
  if (entry.storageReadable === false) return "warning";
  if (storageMissing) return "warning";
  if (certificates.some((certificate) => certificate.status === "expired" || certificate.status === "invalid")) return "warning";
  if (certificates.length > 0) return "online";
  if (entry.sources.includes("static-config")) return "online";
  if (entry.sources.includes("router") || entry.sources.includes("gatelite-state")) return "unknown";
  return "unknown";
}

function resolverStatusMessage(entry: AcmeResolverState, certificates: AcmeCertificateRuntime[], storageMissing: boolean): string | undefined {
  if (entry.storageReadable === false) return "ACME storage is configured but not readable by GateLite.";
  if (storageMissing) return "ACME storage is readable, but no entry for this resolver was found.";
  if (certificates.some((certificate) => certificate.status === "expired")) return "One or more ACME certificates are expired.";
  if (certificates.some((certificate) => certificate.status === "invalid")) return "One or more ACME certificates could not be parsed.";
  if (certificates.some((certificate) => certificate.status === "expiring")) return "One or more ACME certificates expire within 30 days.";
  if (entry.sources.includes("router") && certificates.length === 0) return "Resolver is referenced by Traefik routers, but no matching ACME storage certificate is visible.";
  return undefined;
}

function resolverRenewalState(certificates: AcmeCertificateRuntime[], storageReadable: boolean | undefined, storageMissing: boolean): AcmeRenewalState {
  if (storageReadable === false) return "unreadable";
  if (storageMissing) return "missing";
  if (certificates.some((certificate) => certificate.renewalState === "expired")) return "expired";
  if (certificates.some((certificate) => certificate.renewalState === "due-soon")) return "due-soon";
  if (certificates.length > 0) return "ok";
  return "unknown";
}

function certificateMatchesDomains(certificate: AcmeCertificateRuntime, wantedDomains: string[]): boolean {
  const wanted = normalizeDomains(wantedDomains);
  if (wanted.length === 0) return true;
  return wanted.every((domain) => certificate.domains.some((candidate) => certificateCoversDomain(candidate, domain)));
}

function certificateCoversDomain(candidate: string, domain: string): boolean {
  const normalizedCandidate = candidate.toLowerCase();
  const normalizedDomain = domain.toLowerCase();
  if (normalizedCandidate === normalizedDomain) return true;
  if (!normalizedCandidate.startsWith("*.")) return false;
  const suffix = normalizedCandidate.slice(1);
  return normalizedDomain.endsWith(suffix) && normalizedDomain.split(".").length === normalizedCandidate.split(".").length;
}

function bestCertificateMatch(matches: AcmeCertificateRuntime[]): AcmeCertificateRuntime | undefined {
  return [...matches].sort((a, b) => statusRank(a.status) - statusRank(b.status) || (Date.parse(b.notAfter || "") || 0) - (Date.parse(a.notAfter || "") || 0))[0];
}

function statusRank(status: CertificateStatus): number {
  const ranks: Record<CertificateStatus, number> = {
    valid: 1,
    expiring: 2,
    pending: 3,
    expired: 4,
    invalid: 5
  };
  return ranks[status];
}

function toCertificateMatch(certificate: AcmeCertificateRuntime): AcmeCertificateMatch {
  return {
    resolver: certificate.resolver,
    status: certificate.status,
    renewalState: certificate.renewalState,
    domains: certificate.domains,
    notAfter: certificate.notAfter,
    statusMessage: certificate.statusMessage
  };
}

function domainsFromCertificate(certificate: X509Certificate, fallbackDomains: string[]): string[] {
  const domains = new Set<string>();
  for (const match of (certificate.subjectAltName || "").matchAll(/DNS:([^,\n]+)/g)) {
    domains.add(match[1].trim().replace(/^"|"$/g, "").toLowerCase());
  }
  for (const domain of fallbackDomains) domains.add(domain);
  return Array.from(domains).filter(Boolean);
}

function certificateStatus(notAfter: string | undefined): CertificateStatus {
  if (!notAfter) return "pending";
  const expiry = new Date(notAfter).getTime();
  if (Number.isNaN(expiry)) return "invalid";
  const now = Date.now();
  if (expiry < now) return "expired";
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  if (expiry - now < thirtyDays) return "expiring";
  return "valid";
}

function renewalStateForStatus(status: CertificateStatus): AcmeRenewalState {
  if (status === "valid") return "ok";
  if (status === "expiring") return "due-soon";
  if (status === "expired") return "expired";
  if (status === "invalid") return "unreadable";
  return "unknown";
}

function statusMessageForStatus(status: CertificateStatus): string | undefined {
  if (status === "expired") return "ACME certificate has expired; check Traefik renewal logs and DNS/API credentials.";
  if (status === "expiring") return "ACME certificate expires within 30 days; renewal should be monitored.";
  if (status === "invalid") return "ACME certificate could not be parsed from storage.";
  return undefined;
}

function normalizeDomains(domains: Array<string | undefined>): string[] {
  return Array.from(new Set(domains.map((domain) => domain?.trim().toLowerCase()).filter(Boolean) as string[]));
}

function resolveRuntimePath(value: string): string {
  if (path.isAbsolute(value)) return value;
  return path.resolve(process.cwd(), value);
}

function addSource(entry: AcmeResolverState, source: AcmeResolverState["sources"][number]): void {
  if (!entry.sources.includes(source)) entry.sources.push(source);
}

function readString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function readStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  const single = readString(value);
  return single ? [single] : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
