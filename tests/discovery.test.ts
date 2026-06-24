import { describe, expect, it } from "vitest";
import type { GateLiteState, TraefikRuntime } from "../shared/types";
import { buildDiscoveredRoutes, buildRuntimeTlsBindings, createMappedWebServiceFromRoute, ensureImportedGroup } from "../server/discovery";
import { generateTraefikDynamicConfig } from "../server/generator";

const emptyState: GateLiteState = {
  version: 1,
  groups: [{ id: "local", name: "Local", order: 1 }],
  webServices: [],
  certificates: [],
  history: []
};

const runtime: TraefikRuntime = {
  connected: true,
  apiUrl: "http://traefik:8080",
  entryPoints: [],
  routers: [
    {
      name: "erp@docker",
      protocol: "http",
      provider: "docker",
      rule: "Host(`gl.erp.tjhtj.com`)",
      service: "erp",
      entryPoints: ["websecure"],
      middlewares: ["compress@docker"],
      domains: ["gl.erp.tjhtj.com"],
      tls: true,
      status: "online"
    }
  ],
  services: [
    {
      name: "erp@docker",
      protocol: "http",
      provider: "docker",
      status: "online",
      servers: ["http://172.20.0.7:8080"]
    }
  ],
  middlewares: [],
  tls: {
    routers: [
      {
        name: "erp@docker",
        protocol: "http",
        provider: "docker",
        rule: "Host(`gl.erp.tjhtj.com`)",
        service: "erp",
        entryPoints: ["websecure"],
        middlewares: ["compress@docker"],
        domains: ["gl.erp.tjhtj.com"],
        tls: true,
        status: "online"
      }
    ],
    certificates: [],
    options: [],
    stores: [],
    resolvers: [],
    available: true
  }
};

describe("Traefik discovery", () => {
  it("projects existing Traefik routers into domain/backend rows", () => {
    const [route] = buildDiscoveredRoutes(runtime, emptyState);

    expect(route).toMatchObject({
      routerName: "erp@docker",
      provider: "docker",
      domains: ["gl.erp.tjhtj.com"],
      entryPoints: ["websecure"],
      managedMode: "unmanaged",
      importable: true,
      backend: {
        serviceName: "erp@docker",
        targetUrl: "http://172.20.0.7:8080"
      }
    });
  });

  it("maps an existing router without emitting duplicate file-provider config", () => {
    const state: GateLiteState = JSON.parse(JSON.stringify(emptyState));
    const [route] = buildDiscoveredRoutes(runtime, state);
    const groupId = ensureImportedGroup(state, undefined);
    const service = createMappedWebServiceFromRoute(route, "svc-imported", groupId, 1, "2026-06-24T00:00:00.000Z");
    state.webServices.push(service);

    const [mappedRoute] = buildDiscoveredRoutes(runtime, state);
    const generated = generateTraefikDynamicConfig(state);

    expect(mappedRoute.managedMode).toBe("mapped");
    expect(mappedRoute.managedServiceId).toBe("svc-imported");
    expect(service.sourceRouterName).toBe("erp@docker");
    expect(service.domainRoot).toBe("erp.tjhtj.com");
    expect(generated.object).toEqual({});
    expect(generated.yaml.trim()).toBe("{}");
  });

  it("shows TLS router bindings even when Traefik does not expose certificate files", () => {
    const [route] = buildDiscoveredRoutes(runtime, emptyState);
    const [binding] = buildRuntimeTlsBindings(runtime, emptyState, [route]);

    expect(binding).toMatchObject({
      routerName: "erp@docker",
      domains: ["gl.erp.tjhtj.com"],
      status: "online",
      importable: false
    });
    expect(binding.importWarnings[0]).toContain("does not expose certificate material");
  });
});
