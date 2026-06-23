import { describe, expect, it } from "vitest";
import type { GateLiteState } from "../shared/types";
import { generateTraefikDynamicConfig } from "../server/generator";

describe("generateTraefikDynamicConfig", () => {
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
          certPath: "/tmp/cert-dev.crt",
          keyPath: "/tmp/cert-dev.key",
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
          middlewares: [],
          tls: { mode: "none" },
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

    expect(generateTraefikDynamicConfig(state).yaml).not.toContain("disabled.localhost");
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
          certPath: "/tmp/disabled.crt",
          keyPath: "/tmp/disabled.key",
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
  });
});
