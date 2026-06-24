import type { DomainTrafficSeries, TrafficOverview, WebService, WebServiceTrafficStats } from "../shared/types";
import { config } from "./config";
import { traefikName } from "./ids";

type TrafficSample = {
  at: string;
  total: number;
};

type RouterByteSample = {
  atMs: number;
  requestBytes: number;
  responseBytes: number;
};

type ParsedMetric = {
  name: string;
  labels: Record<string, string>;
  value: number;
};

const maxSamples = 12;
const samplesByDomain = new Map<string, TrafficSample[]>();
const byteSamplesByRouter = new Map<string, RouterByteSample>();

type RouterTrafficStats = {
  totalRequests: number;
  requestBytes: number;
  responseBytes: number;
};

export type TrafficSnapshot = {
  overview: TrafficOverview;
  statsByServiceId: Map<string, WebServiceTrafficStats>;
};

export async function getTrafficOverview(services: WebService[]): Promise<TrafficOverview> {
  return (await getTrafficSnapshot(services)).overview;
}

export async function getTrafficSnapshot(services: WebService[]): Promise<TrafficSnapshot> {
  const updatedAt = new Date().toISOString();

  try {
    const text = await fetchTraefikMetrics();
    const routerStats = readRouterTrafficStats(text);
    const routerTotals = new Map(Array.from(routerStats.entries()).map(([router, stats]) => [router, stats.totalRequests]));
    const serviceOpenConnections = readServiceOpenConnections(text);
    const openConnectionsByEntrypoint = readEntrypointOpenConnections(text);
    const series = buildDomainSeries(services, routerTotals, updatedAt);

    return {
      overview: {
        connected: true,
        source: "prometheus",
        updatedAt,
        series
      },
      statsByServiceId: buildServiceTrafficStats(services, routerStats, serviceOpenConnections, openConnectionsByEntrypoint, updatedAt, "prometheus")
    };
  } catch (error) {
    return {
      overview: {
        connected: false,
        source: "unavailable",
        updatedAt,
        series: [],
        error: error instanceof Error ? error.message : "Unable to load Traefik metrics."
      },
      statsByServiceId: buildServiceTrafficStats(services, new Map(), new Map(), new Map(), updatedAt, "unavailable")
    };
  }
}

export function readRouterRequestTotals(text: string): Map<string, number> {
  const totals = new Map<string, number>();

  for (const metric of parsePrometheusMetrics(text)) {
    if (metric.name !== "traefik_router_requests_total") continue;
    const router = metric.labels.router;
    if (!router || !Number.isFinite(metric.value)) continue;
    totals.set(router, (totals.get(router) || 0) + metric.value);
  }

  return totals;
}

export function readRouterTrafficStats(text: string): Map<string, RouterTrafficStats> {
  const stats = new Map<string, RouterTrafficStats>();

  for (const metric of parsePrometheusMetrics(text)) {
    const router = metric.labels.router;
    if (!router || !Number.isFinite(metric.value)) continue;
    if (!["traefik_router_requests_total", "traefik_router_requests_bytes_total", "traefik_router_responses_bytes_total"].includes(metric.name)) continue;

    const current = stats.get(router) || {
      totalRequests: 0,
      requestBytes: 0,
      responseBytes: 0
    };

    if (metric.name === "traefik_router_requests_total") current.totalRequests += metric.value;
    if (metric.name === "traefik_router_requests_bytes_total") current.requestBytes += metric.value;
    if (metric.name === "traefik_router_responses_bytes_total") current.responseBytes += metric.value;
    stats.set(router, current);
  }

  return stats;
}

export function readEntrypointOpenConnections(text: string): Map<string, number> {
  const connections = new Map<string, number>();

  for (const metric of parsePrometheusMetrics(text)) {
    if (metric.name !== "traefik_open_connections") continue;
    const entrypoint = metric.labels.entrypoint;
    if (!entrypoint || !Number.isFinite(metric.value)) continue;
    connections.set(entrypoint, (connections.get(entrypoint) || 0) + metric.value);
  }

  return connections;
}

export function readServiceOpenConnections(text: string): Map<string, number> {
  const connections = new Map<string, number>();

  for (const metric of parsePrometheusMetrics(text)) {
    if (metric.name !== "traefik_service_open_connections") continue;
    const service = metric.labels.service;
    if (!service || !Number.isFinite(metric.value)) continue;
    connections.set(service, (connections.get(service) || 0) + metric.value);
  }

  return connections;
}

export function counterRatePerSecond(previousTotal: number, currentTotal: number, elapsedMs: number): number {
  if (!Number.isFinite(previousTotal) || !Number.isFinite(currentTotal) || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  if (currentTotal < previousTotal) return 0;
  return (currentTotal - previousTotal) / (elapsedMs / 1000);
}

export function parsePrometheusMetrics(text: string): ParsedMetric[] {
  const metrics: ParsedMetric[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|NaN|Inf|\+Inf|-Inf)$/i);
    if (!match) continue;
    const value = Number(match[3]);
    metrics.push({
      name: match[1],
      labels: match[2] ? parsePrometheusLabels(match[2]) : {},
      value
    });
  }

  return metrics;
}

function buildServiceTrafficStats(
  services: WebService[],
  routerStats: Map<string, RouterTrafficStats>,
  serviceOpenConnections: Map<string, number>,
  openConnectionsByEntrypoint: Map<string, number>,
  updatedAt: string,
  source: WebServiceTrafficStats["source"]
): Map<string, WebServiceTrafficStats> {
  const statsByServiceId = new Map<string, WebServiceTrafficStats>();

  for (const service of services) {
    const routerName = traefikName("gatelite", service.id);
    const routerKey = routerStats.has(`${routerName}@file`) ? `${routerName}@file` : routerName;
    const traefikServiceName = traefikName("gatelite-service", service.id);
    const traefikServiceKey = serviceOpenConnections.has(`${traefikServiceName}@file`) ? `${traefikServiceName}@file` : traefikServiceName;
    const stats = routerStats.get(routerKey) || {
      totalRequests: 0,
      requestBytes: 0,
      responseBytes: 0
    };
    const previous = byteSamplesByRouter.get(routerKey);
    const currentAtMs = new Date(updatedAt).getTime();
    const requestBytesPerSecond = source === "prometheus" && previous ? counterRatePerSecond(previous.requestBytes, stats.requestBytes, currentAtMs - previous.atMs) : 0;
    const responseBytesPerSecond = source === "prometheus" && previous ? counterRatePerSecond(previous.responseBytes, stats.responseBytes, currentAtMs - previous.atMs) : 0;
    const hasServiceOpenConnections = source === "prometheus" && serviceOpenConnections.has(traefikServiceKey);
    const entrypointOpenConnections = service.entryPoints.reduce((total, entrypoint) => total + (openConnectionsByEntrypoint.get(entrypoint) || 0), 0);
    const openConnections = hasServiceOpenConnections ? serviceOpenConnections.get(traefikServiceKey) || 0 : entrypointOpenConnections;

    statsByServiceId.set(service.id, {
      source,
      updatedAt,
      totalRequests: stats.totalRequests,
      requestBytes: stats.requestBytes,
      responseBytes: stats.responseBytes,
      requestBytesPerSecond,
      responseBytesPerSecond,
      openConnections,
      openConnectionsScope: source === "unavailable" ? "unavailable" : hasServiceOpenConnections ? "service" : "entrypoint"
    });

    if (source === "prometheus") {
      byteSamplesByRouter.set(routerKey, {
        atMs: currentAtMs,
        requestBytes: stats.requestBytes,
        responseBytes: stats.responseBytes
      });
    }
  }

  return statsByServiceId;
}

function buildDomainSeries(services: WebService[], routerTotals: Map<string, number>, at: string): DomainTrafficSeries[] {
  const series: DomainTrafficSeries[] = [];

  for (const service of services.filter((item) => item.enabled)) {
    const router = `${traefikName("gatelite", service.id)}@file`;
    const total = routerTotals.get(router) ?? routerTotals.get(traefikName("gatelite", service.id)) ?? 0;
    for (const domain of service.domains) {
      const samples = recordSample(domain, total, at);
      series.push({
        domain,
        router,
        provider: "file",
        source: "prometheus",
        totalRequests: total,
        points: samplesToDeltas(samples)
      });
    }
  }

  return series.sort((a, b) => b.totalRequests - a.totalRequests || a.domain.localeCompare(b.domain)).slice(0, 8);
}

function recordSample(domain: string, total: number, at: string): TrafficSample[] {
  const samples = samplesByDomain.get(domain) || [];
  const last = samples[samples.length - 1];
  if (!last || last.total !== total) {
    samples.push({ at, total });
  } else {
    samples[samples.length - 1] = { ...last, at };
  }
  const next = samples.slice(-maxSamples);
  samplesByDomain.set(domain, next);
  return next;
}

function samplesToDeltas(samples: TrafficSample[]): DomainTrafficSeries["points"] {
  return samples.map((sample, index) => {
    const previous = samples[index - 1];
    return {
      at: sample.at,
      value: Math.max(0, sample.total - (previous?.total || 0))
    };
  });
}

async function fetchTraefikMetrics(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${config.traefikApiUrl}/metrics`, {
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Traefik /metrics returned ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parsePrometheusLabels(text: string): Record<string, string> {
  const labels: Record<string, string> = {};
  const matcher = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"\\])*)"/g;
  for (const match of text.matchAll(matcher)) {
    labels[match[1]] = unescapePrometheusLabel(match[2]);
  }
  return labels;
}

function unescapePrometheusLabel(value: string): string {
  return value.replace(/\\([\\n"])/g, (_match, character: string) => {
    if (character === "n") return "\n";
    return character;
  });
}
