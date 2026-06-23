import type { RuntimeRouter, RuntimeService, RuntimeStatus, TraefikRuntime } from "../shared/types";
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

export async function getTraefikRuntime(): Promise<TraefikRuntime> {
  try {
    const [version, overview, entryPoints, httpRouters, httpServices, httpMiddlewares, tcpRouters, tcpServices, udpRouters, udpServices, rawData] =
      await Promise.all([
        fetchJson("/api/version"),
        fetchJson("/api/overview"),
        fetchJson("/api/entrypoints"),
        fetchJson("/api/http/routers"),
        fetchJson("/api/http/services"),
        fetchJson("/api/http/middlewares"),
        fetchJson("/api/tcp/routers"),
        fetchJson("/api/tcp/services"),
        fetchJson("/api/udp/routers"),
        fetchJson("/api/udp/services"),
        fetchJson("/api/rawdata")
      ]);

    return {
      connected: true,
      apiUrl: config.traefikApiUrl,
      version: readVersion(version),
      overview,
      entryPoints: Array.isArray(entryPoints) ? entryPoints : [],
      routers: [
        ...normalizeRouters(httpRouters, "http"),
        ...normalizeRouters(tcpRouters, "tcp"),
        ...normalizeRouters(udpRouters, "udp")
      ],
      services: [...normalizeServices(httpServices, "http"), ...normalizeServices(tcpServices, "tcp"), ...normalizeServices(udpServices, "udp")],
      middlewares: Array.isArray(httpMiddlewares) ? httpMiddlewares : [],
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

function normalizeRouters(value: unknown, protocol: "http" | "tcp" | "udp"): RuntimeRouter[] {
  if (!Array.isArray(value)) return [];
  return value.map((router: TraefikRouterLike) => ({
    name: router.name || `${protocol}-router`,
    provider: router.provider,
    rule: router.rule,
    service: router.service,
    entryPoints: router.entryPoints || [],
    middlewares: router.middlewares || [],
    domains: extractDomains(router.rule || ""),
    tls: Boolean(router.tls),
    status: normalizeStatus(router.status),
    error: router.error
  }));
}

function normalizeServices(value: unknown, protocol: "http" | "tcp" | "udp"): RuntimeService[] {
  if (!Array.isArray(value)) return [];
  return value.map((service: TraefikServiceLike) => ({
    name: service.name || `${protocol}-service`,
    provider: service.provider,
    status: normalizeStatus(service.status),
    error: service.error,
    servers: (service.loadBalancer?.servers || []).map((server) => server.url || server.address || "").filter(Boolean)
  }));
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
  for (const match of rule.matchAll(/Host\(`([^`]+)`\)/g)) {
    domains.add(match[1].toLowerCase());
  }
  for (const match of rule.matchAll(/Host\("([^"]+)"\)/g)) {
    domains.add(match[1].toLowerCase());
  }
  return Array.from(domains);
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

