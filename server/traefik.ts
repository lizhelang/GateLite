import type { RuntimeMiddleware, RuntimeProtocol, RuntimeRouter, RuntimeService, RuntimeStatus, RuntimeTlsItem, RuntimeTlsSummary, TraefikRuntime } from "../shared/types";
import { config } from "./config";

interface TraefikRouterLike {
  name?: string;
  provider?: string;
  rule?: string;
  service?: string;
  entryPoints?: string[];
  middlewares?: string[];
  status?: string;
  error?: string;
  tls?: unknown;
}

interface TraefikServiceLike {
  name?: string;
  provider?: string;
  status?: string;
  error?: string;
  loadBalancer?: {
    servers?: Array<{ url?: string; address?: string }>;
  };
}

interface TraefikMiddlewareLike {
  name?: string;
  provider?: string;
  type?: string;
  status?: string;
  error?: string;
  usedBy?: string[];
}

export async function getTraefikRuntime(): Promise<TraefikRuntime> {
  try {
    const [version, overview, entryPoints, httpRouters, httpServices, httpMiddlewares, tcpRouters, tcpServices, tcpMiddlewares, udpRouters, udpServices, rawData] =
      await Promise.all([
        fetchJson("/api/version"),
        fetchJson("/api/overview"),
        fetchJson("/api/entrypoints"),
        fetchJson("/api/http/routers"),
        fetchJson("/api/http/services"),
        fetchJson("/api/http/middlewares"),
        fetchJson("/api/tcp/routers"),
        fetchJson("/api/tcp/services"),
        fetchOptionalJson("/api/tcp/middlewares", []),
        fetchJson("/api/udp/routers"),
        fetchJson("/api/udp/services"),
        fetchJson("/api/rawdata")
      ]);
    const routers = [
      ...normalizeRouters(httpRouters, "http"),
      ...normalizeRouters(tcpRouters, "tcp"),
      ...normalizeRouters(udpRouters, "udp")
    ];

    return {
      connected: true,
      apiUrl: config.traefikApiUrl,
      version: readVersion(version),
      overview,
      entryPoints: Array.isArray(entryPoints) ? entryPoints : [],
      routers,
      services: [...normalizeServices(httpServices, "http"), ...normalizeServices(tcpServices, "tcp"), ...normalizeServices(udpServices, "udp")],
      middlewares: [...normalizeMiddlewares(httpMiddlewares, "http"), ...normalizeMiddlewares(tcpMiddlewares, "tcp")],
      tls: normalizeTlsSummary(rawData, routers),
      rawData
    };
  } catch (error) {
    return {
      connected: false,
      apiUrl: config.traefikApiUrl,
      entryPoints: [],
      routers: [],
      services: [],
      middlewares: [],
      tls: emptyTlsSummary(),
      error: error instanceof Error ? error.message : "Unable to connect to Traefik."
    };
  }
}

async function fetchJson(path: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${config.traefikApiUrl}${path}`, {
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Traefik ${path} returned ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOptionalJson(path: string, fallback: unknown): Promise<unknown> {
  try {
    return await fetchJson(path);
  } catch {
    return fallback;
  }
}

export function normalizeRouters(value: unknown, protocol: RuntimeProtocol): RuntimeRouter[] {
  if (!Array.isArray(value)) return [];
  return value.map((router: TraefikRouterLike) => ({
    name: router.name || `${protocol}-router`,
    protocol,
    provider: router.provider,
    rule: router.rule,
    service: router.service,
    entryPoints: router.entryPoints || [],
    middlewares: router.middlewares || [],
    domains: extractDomains(router.rule || ""),
    tls: Boolean(router.tls),
    ...readRouterTls(router.tls),
    status: normalizeStatus(router.status),
    error: router.error
  }));
}

export function normalizeServices(value: unknown, protocol: RuntimeProtocol): RuntimeService[] {
  if (!Array.isArray(value)) return [];
  return value.map((service: TraefikServiceLike) => ({
    name: service.name || `${protocol}-service`,
    protocol,
    provider: service.provider,
    status: normalizeStatus(service.status),
    error: service.error,
    servers: (service.loadBalancer?.servers || []).map((server) => server.url || server.address || "").filter(Boolean)
  }));
}

export function normalizeMiddlewares(value: unknown, protocol: RuntimeMiddleware["protocol"]): RuntimeMiddleware[] {
  if (!Array.isArray(value)) return [];
  return value.map((middleware: TraefikMiddlewareLike) => ({
    name: middleware.name || `${protocol}-middleware`,
    protocol,
    provider: middleware.provider,
    type: middleware.type,
    status: normalizeStatus(middleware.status),
    usedBy: Array.isArray(middleware.usedBy) ? middleware.usedBy : [],
    error: middleware.error
  }));
}

function readRouterTls(tls: unknown): Pick<RuntimeRouter, "tlsResolver" | "tlsOptions" | "tlsPassthrough"> {
  const record = asRecord(tls);
  return {
    tlsResolver: readString(record.certResolver),
    tlsOptions: readString(record.options),
    tlsPassthrough: typeof record.passthrough === "boolean" ? record.passthrough : undefined
  };
}

export function normalizeTlsSummary(rawData: unknown, routers: RuntimeRouter[]): RuntimeTlsSummary {
  const raw = asRecord(rawData);
  const tls = asRecord(raw.tls);
  const tlsRouters = routers.filter((router) => router.tls);
  const resolverNames = Array.from(new Set(tlsRouters.map((router) => router.tlsResolver).filter(Boolean) as string[]));
  const apiResolvers = normalizeTlsItems(tls.resolvers || raw.certificatesResolvers || raw.certificateResolvers, "resolver");
  const apiResolverNames = new Set(apiResolvers.map((resolver) => resolver.name));
  const resolvers = [
    ...apiResolvers,
    ...resolverNames
      .filter((name) => !apiResolverNames.has(name))
      .map((name) => ({
        name,
        domains: [],
        detail: "Referenced by TLS router",
        source: "router" as const,
        status: "online" as const
      }))
  ];

  return {
    routers: tlsRouters,
    certificates: normalizeTlsItems(tls.certificates, "certificate"),
    options: normalizeTlsItems(tls.options, "option"),
    stores: normalizeTlsItems(tls.stores, "store"),
    resolvers,
    available: tlsRouters.length > 0 || Object.keys(tls).length > 0 || resolvers.length > 0
  };
}

function normalizeTlsItems(value: unknown, fallbackName: string): RuntimeTlsItem[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => tlsItemFromRecord(asRecord(item), `${fallbackName}-${index + 1}`));
  }
  const record = asRecord(value);
  return Object.entries(record).map(([name, item]) => tlsItemFromRecord(asRecord(item), name));
}

function tlsItemFromRecord(record: Record<string, unknown>, name: string): RuntimeTlsItem {
  return {
    name: readString(record.name) || name,
    provider: readString(record.provider),
    domains: readDomains(record),
    detail: readTlsDetail(record),
    source: "traefik-api",
    status: normalizeStatus(readString(record.status) || "enabled")
  };
}

function readDomains(record: Record<string, unknown>): string[] {
  const domains = record.domains || record.domain || record.sans || record.SANs;
  if (Array.isArray(domains)) return domains.map(String).filter(Boolean);
  if (typeof domains === "string") return [domains].filter(Boolean);
  const certificate = asRecord(record.certificate);
  const stores = certificate.domains || certificate.sans;
  return Array.isArray(stores) ? stores.map(String).filter(Boolean) : [];
}

function readTlsDetail(record: Record<string, unknown>): string | undefined {
  const preferred = ["certFile", "keyFile", "minVersion", "sniStrict", "defaultCertificate", "acme", "caServer"];
  for (const key of preferred) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return `${key}: ${String(value)}`;
    }
  }
  const keys = Object.keys(record).filter((key) => !["name", "provider", "status", "domains"].includes(key));
  return keys.length ? keys.slice(0, 3).join(", ") : undefined;
}

function emptyTlsSummary(): RuntimeTlsSummary {
  return {
    routers: [],
    certificates: [],
    options: [],
    stores: [],
    resolvers: [],
    available: false
  };
}

function normalizeStatus(status: string | undefined): RuntimeStatus {
  if (!status) return "unknown";
  if (status.toLowerCase() === "enabled") return "online";
  if (status.toLowerCase() === "disabled") return "offline";
  if (status.toLowerCase() === "warning") return "warning";
  return "unknown";
}

function extractDomains(rule: string): string[] {
  const domains = new Set<string>();
  for (const match of rule.matchAll(/Host(?:SNI)?\(`([^`]+)`\)/g)) {
    domains.add(match[1].toLowerCase());
  }
  for (const match of rule.matchAll(/Host(?:SNI)?\("([^"]+)"\)/g)) {
    domains.add(match[1].toLowerCase());
  }
  return Array.from(domains);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readVersion(version: unknown): string | undefined {
  if (version && typeof version === "object" && "Version" in version) {
    return String((version as { Version: unknown }).Version);
  }
  if (version && typeof version === "object" && "version" in version) {
    return String((version as { version: unknown }).version);
  }
  return undefined;
}
