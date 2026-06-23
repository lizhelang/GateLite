import fs from "node:fs";
import path from "node:path";
import type { CertificateItem, GateLiteState, ServiceGroup, WebService } from "../shared/types";
import { config } from "./config";
import { createSelfSignedCertificate, refreshCertificateMetadata } from "./certificates";
import { writeTraefikDynamicConfig } from "./generator";

export function loadState(): GateLiteState {
  ensureState();
  const raw = fs.readFileSync(config.stateFile, "utf8");
  const state = JSON.parse(raw) as GateLiteState;
  state.certificates = state.certificates.map(refreshCertificateMetadata);
  return state;
}

export function saveState(state: GateLiteState, action = "state.save", summary = "Saved GateLite state."): GateLiteState {
  const now = new Date().toISOString();
  const next: GateLiteState = {
    ...state,
    groups: normalizeGroupOrders(state.groups),
    webServices: normalizeServiceOrders(state.webServices).map((service) => ({
      ...service,
      domains: normalizeStringList(service.domains),
      entryPoints: normalizeStringList(service.entryPoints),
      middlewares: normalizeStringList(service.middlewares)
    })),
    certificates: normalizeCertificateOrders(state.certificates).map(refreshCertificateMetadata),
    history: [
      {
        id: `evt-${Date.now()}`,
        at: now,
        action,
        summary
      },
      ...state.history
    ].slice(0, 100)
  };

  fs.mkdirSync(path.dirname(config.stateFile), { recursive: true });
  fs.writeFileSync(config.stateFile, JSON.stringify(next, null, 2), "utf8");
  writeTraefikDynamicConfig(next);
  return next;
}

export function ensureState(): void {
  fs.mkdirSync(path.dirname(config.stateFile), { recursive: true });
  fs.mkdirSync(path.dirname(config.dynamicFile), { recursive: true });
  fs.mkdirSync(config.certDir, { recursive: true });

  if (fs.existsSync(config.stateFile)) {
    const state = JSON.parse(fs.readFileSync(config.stateFile, "utf8")) as GateLiteState;
    writeTraefikDynamicConfig(state);
    return;
  }

  const now = new Date().toISOString();
  const certificate = createSelfSignedCertificate("Local dev certificate", ["secure.localhost", "whoami.localhost"], 365);
  certificate.id = "cert-local-dev";
  certificate.order = 1;

  const groups: ServiceGroup[] = [
    { id: "local", name: "Local Docker", collapsed: false, order: 1 },
    { id: "secure", name: "TLS demos", collapsed: false, order: 2 }
  ];

  const webServices: WebService[] = [
    {
      id: "svc-whoami-http",
      name: "Whoami HTTP",
      enabled: true,
      groupId: "local",
      domains: ["whoami.localhost"],
      listenPort: 18080,
      entryPoints: ["web"],
      targetUrl: "http://whoami:80",
      middlewares: [],
      tls: { mode: "none" },
      order: 1,
      notes: "Seed route to the Docker Compose whoami service.",
      createdAt: now,
      updatedAt: now
    },
    {
      id: "svc-whoami-tls",
      name: "Whoami HTTPS",
      enabled: true,
      groupId: "secure",
      domains: ["secure.localhost"],
      listenPort: 18443,
      entryPoints: ["websecure"],
      targetUrl: "http://whoami:80",
      middlewares: [],
      tls: { mode: "file-certificate", certificateId: certificate.id },
      order: 2,
      notes: "Seed TLS route backed by a generated local self-signed certificate.",
      createdAt: now,
      updatedAt: now
    }
  ];

  const initial: GateLiteState = {
    version: 1,
    groups,
    webServices,
    certificates: [certificate],
    history: [
      {
        id: "evt-initial",
        at: now,
        action: "state.seed",
        summary: "Created seed local Docker routes and a local development certificate."
      }
    ]
  };

  fs.writeFileSync(config.stateFile, JSON.stringify(initial, null, 2), "utf8");
  writeTraefikDynamicConfig(initial);
}

export function withState(mutator: (state: GateLiteState) => GateLiteState, action: string, summary: string): GateLiteState {
  const state = loadState();
  return saveState(mutator(state), action, summary);
}

export function bindCertificates(state: GateLiteState): CertificateItem[] {
  return state.certificates.map(refreshCertificateMetadata);
}

function normalizeGroupOrders(groups: ServiceGroup[]): ServiceGroup[] {
  return [...groups].sort((a, b) => a.order - b.order).map((group, index) => ({ ...group, order: index + 1 }));
}

function normalizeServiceOrders(webServices: WebService[]): WebService[] {
  return [...webServices].sort((a, b) => a.order - b.order).map((service, index) => ({ ...service, order: index + 1 }));
}

function normalizeCertificateOrders(certificates: CertificateItem[]): CertificateItem[] {
  return [...certificates].sort((a, b) => a.order - b.order).map((certificate, index) => ({ ...certificate, order: index + 1 }));
}

function normalizeStringList(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

