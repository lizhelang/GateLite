import type { DomainTrafficSeries, TrafficOverview, WebService } from "../shared/types";
import { config } from "./config";
import { traefikName } from "./ids";

type TrafficSample = {
  at: string;
  total: number;
};

type ParsedMetric = {
  name: string;
  labels: Record<string, string>;
  value: number;
};

const maxSamples = 12;
const samplesByDomain = new Map<string, TrafficSample[]>();

export async function getTrafficOverview(services: WebService[]): Promise<TrafficOverview> {
  const updatedAt = new Date().toISOString();

  try {
    const text = await fetchTraefikMetrics();
    const routerTotals = readRouterRequestTotals(text);
    const series = buildDomainSeries(services, routerTotals, updatedAt);

    return {
      connected: true,
      source: "prometheus",
      updatedAt,
      series
    };
  } catch (error) {
    return {
      connected: false,
      source: "unavailable",
      updatedAt,
      series: [],
      error: error instanceof Error ? error.message : "Unable to load Traefik metrics."
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
