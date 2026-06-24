import { describe, expect, it } from "vitest";
import path from "node:path";
import type { GateLiteState } from "../shared/types";
import { generateTraefikDynamicConfig } from "../server/generator";

const mountedCertDir = path.resolve("runtime/certs");

describe("generateTraefikDynamicConfig", () => {
  it("renders an empty object when GateLite has no active dynamic config", () => {
    const state: GateLiteState = {
      version: 1,
      groups: [{ id: "default", name: "Default", order: 1 }],
      webServices: [],
      certificates: [],
      history: []
    };

    const generated = generateTraefikDynamicConfig(state);

    expect(generated.object).toEqual({});
    expect(generated.yaml.trim()).toBe("{}");
  });

  it("renders enabled HTTP and HTTPS services into Traefik dynamic config", () => {
    const state: GateLiteState = {
      version: 1,
      groups: [{ id: "local", name: "Local", order: 1 }],
      certificates: [
        {
          id: "cert-dev",
          name: "Dev cert",
          enabled: true,
          source: "upload",
          domains: ["secure.localhost"],
          certPath: path.join(mountedCertDir, "cert-dev.crt"),
          keyPath: path.join(mountedCertDir, "cert-dev.key"),
          status: "valid",
          order: 1,
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z"
        }
      ],
      webServices: [
        {
          id: "svc-one",
          name: "Plain",
          enabled: true,
          groupId: "local",
          domains: ["plain.localhost"],
          listenPort: 18080,
          entryPoints: ["web"],
          targetUrl: "http://whoami:80",
          passHostHeader: false,
          middlewares: [],
          tls: { mode: "none" },
          observability: { accessLogs: false, metrics: true, tracing: false },
          order: 1,
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z"
        },
        {
          id: "svc-two",
          name: "Secure",
          enabled: true,
          groupId: "local",
          domains: ["secure.localhost"],
          listenPort: 18443,
          entryPoints: ["websecure"],
          targetUrl: "http://whoami:80",
          middlewares: ["compress@file"],
          tls: { mode: "file-certificate", certificateId: "cert-dev" },
          order: 2,
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z"
        }
      ],
      history: []
    };

    const generated = generateTraefikDynamicConfig(state);

    expect(generated.yaml).toContain("Host(`plain.localhost`)");
    expect(generated.yaml).toContain("Host(`secure.localhost`)");
    expect(generated.yaml).toContain("passHostHeader: false");
    expect(generated.yaml).toContain("observability:");
    expect(generated.yaml).toContain("accessLogs: false");
    expect(generated.yaml).toContain("metrics: true");
    expect(generated.yaml).toContain("tracing: false");
    expect(generated.yaml).toContain("websecure");
    expect(generated.yaml).toContain("compress@file");
    expect(generated.yaml).toContain("/certs/cert-dev.crt");
    expect(generated.yaml).toContain("/certs/cert-dev.key");
  });

  it("omits disabled services from the active Traefik config", () => {
    const state: GateLiteState = {
      version: 1,
      groups: [],
      certificates: [],
      webServices: [
        {
          id: "svc-disabled",
          name: "Disabled",
          enabled: false,
          groupId: "local",
          domains: ["disabled.localhost"],
          listenPort: 18080,
          entryPoints: ["web"],
          targetUrl: "http://whoami:80",
          middlewares: [],
          tls: { mode: "none" },
          order: 1,
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z"
        }
      ],
      history: []
    };

    const generated = generateTraefikDynamicConfig(state);

    expect(generated.yaml).not.toContain("disabled.localhost");
    expect(generated.object).toEqual({});
    expect(generated.yaml.trim()).toBe("{}");
  });

  it("renders default fallback services as low-priority catch-all routers", () => {
    const state: GateLiteState = {
      version: 1,
      groups: [],
      certificates: [],
      webServices: [
        {
          id: "svc-default",
          name: "Default",
          enabled: true,
          matchMode: "default",
          groupId: "local",
          domains: [],
          listenPort: 18080,
          entryPoints: ["web"],
          targetUrl: "http://whoami:80",
          middlewares: [],
          tls: { mode: "none" },
          order: 1,
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z"
        }
      ],
      history: []
    };

    const generated = generateTraefikDynamicConfig(state).yaml;

    expect(generated).toContain("PathPrefix(`/`)");
    expect(generated).toContain("priority: 1");
    expect(generated).not.toContain("Host(`");
  });

  it("renders custom Traefik rules without requiring host-only projection", () => {
    const state: GateLiteState = {
      version: 1,
      groups: [],
      certificates: [],
      webServices: [
        {
          id: "svc-custom",
          name: "Custom",
          enabled: true,
          matchMode: "custom",
          customRule: "Host(`custom.localhost`) && PathPrefix(`/api`)",
          groupId: "local",
          domains: ["custom.localhost"],
          listenPort: 18080,
          entryPoints: ["web"],
          targetUrl: "http://whoami:80",
          middlewares: [],
          tls: { mode: "none" },
          order: 1,
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z"
        }
      ],
      history: []
    };

    const generated = generateTraefikDynamicConfig(state).yaml;

    expect(generated).toContain("Host(`custom.localhost`) && PathPrefix(`/api`)");
    expect(generated).toContain("http://whoami:80");
  });

  it("omits disabled certificates from the active Traefik config", () => {
    const state: GateLiteState = {
      version: 1,
      groups: [],
      webServices: [],
      certificates: [
        {
          id: "cert-disabled",
          name: "Disabled cert",
          enabled: false,
          source: "upload",
          domains: ["disabled.localhost"],
          certPath: path.join(mountedCertDir, "disabled.crt"),
          keyPath: path.join(mountedCertDir, "disabled.key"),
          status: "valid",
          order: 1,
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z"
        }
      ],
      history: []
    };

    const generated = generateTraefikDynamicConfig(state).yaml;

    expect(generated).not.toContain("/certs/disabled.crt");
    expect(generated).not.toContain("/certs/disabled.key");
    expect(generated.trim()).toBe("{}");
  });

  it("omits certificate paths that are outside the Docker-mounted certificate directory", () => {
    const state: GateLiteState = {
      version: 1,
      groups: [],
      webServices: [],
      certificates: [
        {
          id: "cert-outside",
          name: "Outside cert",
          enabled: true,
          source: "path",
          domains: ["outside.localhost"],
          certPath: "/tmp/outside.crt",
          keyPath: "/tmp/outside.key",
          status: "valid",
          order: 1,
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z"
        }
      ],
      history: []
    };

    const generated = generateTraefikDynamicConfig(state).yaml;

    expect(generated).not.toContain("/certs/outside.crt");
    expect(generated).not.toContain("/certs/outside.key");
  });
});
