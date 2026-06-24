import { describe, expect, it } from "vitest";
import { counterRatePerSecond, parsePrometheusMetrics, readEntrypointOpenConnections, readRouterRequestTotals, readRouterTrafficStats, readServiceOpenConnections } from "../server/metrics";

describe("Traefik Prometheus metrics parsing", () => {
  it("sums router request counters across labels", () => {
    const totals = readRouterRequestTotals(`
# HELP traefik_router_requests_total How many HTTP requests are processed on a router, partitioned by status code, protocol, and method.
# TYPE traefik_router_requests_total counter
traefik_router_requests_total{code="200",method="GET",protocol="http",router="gatelite-svc-one@file",service="gatelite-service-svc-one@file"} 3
traefik_router_requests_total{code="404",method="GET",protocol="http",router="gatelite-svc-one@file",service="gatelite-service-svc-one@file"} 2
traefik_router_requests_total{code="200",method="GET",protocol="http",router="gatelite-svc-two@file",service="gatelite-service-svc-two@file"} 7
traefik_entrypoint_requests_total{code="200",entrypoint="web",method="GET",protocol="http"} 99
`);

    expect(totals.get("gatelite-svc-one@file")).toBe(5);
    expect(totals.get("gatelite-svc-two@file")).toBe(7);
    expect(totals.has("web")).toBe(false);
  });

  it("parses escaped Prometheus label values", () => {
    const metrics = parsePrometheusMetrics(String.raw`traefik_router_requests_total{router="router-\"quoted\"@file",service="svc\\name"} 1`);

    expect(metrics).toEqual([
      {
        name: "traefik_router_requests_total",
        labels: {
          router: 'router-"quoted"@file',
          service: "svc\\name"
        },
        value: 1
      }
    ]);
  });

  it("sums router byte counters and open connections", () => {
    const text = `
traefik_router_requests_total{code="200",router="gatelite-svc-one@file",service="gatelite-service-svc-one@file"} 3
traefik_router_requests_total{code="404",router="gatelite-svc-one@file",service="gatelite-service-svc-one@file"} 2
traefik_router_requests_bytes_total{code="200",router="gatelite-svc-one@file",service="gatelite-service-svc-one@file"} 128
traefik_router_responses_bytes_total{code="200",router="gatelite-svc-one@file",service="gatelite-service-svc-one@file"} 2048
traefik_service_open_connections{service="gatelite-service-svc-one@file",protocol="TCP"} 2
traefik_service_open_connections{service="gatelite-service-svc-one@file",protocol="HTTP"} 3
traefik_open_connections{entrypoint="web",protocol="TCP"} 4
traefik_open_connections{entrypoint="websecure",protocol="TCP"} 1
`;

    const stats = readRouterTrafficStats(text);
    expect(stats.get("gatelite-svc-one@file")).toEqual({
      totalRequests: 5,
      requestBytes: 128,
      responseBytes: 2048
    });

    const connections = readEntrypointOpenConnections(text);
    expect(connections.get("web")).toBe(4);
    expect(connections.get("websecure")).toBe(1);

    const serviceConnections = readServiceOpenConnections(text);
    expect(serviceConnections.get("gatelite-service-svc-one@file")).toBe(5);
  });

  it("calculates counter rates while tolerating resets and first samples", () => {
    expect(counterRatePerSecond(100, 220, 2000)).toBe(60);
    expect(counterRatePerSecond(220, 100, 2000)).toBe(0);
    expect(counterRatePerSecond(100, 220, 0)).toBe(0);
  });
});
