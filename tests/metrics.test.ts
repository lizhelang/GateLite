import { describe, expect, it } from "vitest";
import { parsePrometheusMetrics, readRouterRequestTotals } from "../server/metrics";

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
});
