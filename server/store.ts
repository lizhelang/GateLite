import fs from "node:fs";
import path from "node:path";
import type { CertificateItem, GateLiteHistoryEvent, GateLiteState, ServiceGroup, WebService } from "../shared/types";
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
  const eventId = createHistoryId("evt");
  const rollbackId = saveRollbackSnapshot(eventId);
  const next: GateLiteState = {
    ...state,
    groups: normalizeGroupOrders(state.groups),
    webServices: normalizeServiceOrders(state.webServices).map((service) => {
      const matchMode = service.matchMode || "host";
      return {
        ...service,
        matchMode,
        domains: matchMode === "default" ? [] : normalizeStringList(service.domains),
        domainRoot: matchMode === "default" ? undefined : normalizeDomainRoot(service.domainRoot),
        entryPoints: normalizeStringList(service.entryPoints),
        middlewares: normalizeStringList(service.middlewares),
        observability: normalizeObservability(service.observability)
      };
    }),
    certificates: normalizeCertificateOrders(state.certificates).map(refreshCertificateMetadata),
    history: [
      {
        id: eventId,
        at: now,
        action,
        summary,
        rollbackId
      },
      ...state.history
    ].slice(0, 100)
  };

  fs.mkdirSync(path.dirname(config.stateFile), { recursive: true });
  fs.writeFileSync(config.stateFile, JSON.stringify(next, null, 2), "utf8");
  writeTraefikDynamicConfig(next);
  return next;
}

export function listHistory(): GateLiteHistoryEvent[] {
  return historyEventsForState(loadState());
}

export function historyEventsForState(state: GateLiteState): GateLiteHistoryEvent[] {
  return state.history.map((event) => ({
    ...event,
    rollbackAvailable: rollbackAvailable(event.rollbackId)
  }));
}

export function rollbackToHistoryEvent(eventId: string): GateLiteState | undefined {
  const state = loadState();
  const event = state.history.find((item) => item.id === eventId);
  if (!event?.rollbackId) return undefined;
  const snapshotPath = rollbackSnapshotPath(event.rollbackId);
  if (!fs.existsSync(snapshotPath)) return undefined;

  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as GateLiteState;
  const restored: GateLiteState = {
    ...snapshot,
    history: [
      {
        id: createHistoryId("evt"),
        at: new Date().toISOString(),
        action: "state.rollback",
        summary: `Rolled back to before ${event.summary}`,
        rollbackId: saveRollbackSnapshot(createHistoryId("rollback"))
      },
      ...state.history
    ].slice(0, 100)
  };
  return saveRestoredState(restored);
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
  if (!config.seedDemo) {
    const initial: GateLiteState = {
      version: 1,
      groups: [{ id: "default", name: "Default", collapsed: false, order: 1 }],
      webServices: [],
      certificates: [],
      history: [
        {
          id: "evt-initial",
          at: now,
          action: "state.init",
          summary: "Initialized an empty GateLite state for production."
        }
      ]
    };

    fs.writeFileSync(config.stateFile, JSON.stringify(initial, null, 2), "utf8");
    writeTraefikDynamicConfig(initial);
    return;
  }

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
      domainRoot: "localhost",
      listenPort: 18080,
      entryPoints: ["web"],
      targetUrl: "http://whoami:80",
      middlewares: [],
      tls: { mode: "none" },
      observability: { accessLogs: true, metrics: true, tracing: false },
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
      domainRoot: "localhost",
      listenPort: 18443,
      entryPoints: ["websecure"],
      targetUrl: "http://whoami:80",
      middlewares: [],
      tls: { mode: "file-certificate", certificateId: certificate.id },
      observability: { accessLogs: true, metrics: true, tracing: false },
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

function normalizeDomainRoot(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^\.+|\.+$/g, "");
  return normalized || undefined;
}

function normalizeObservability(observability: WebService["observability"]): WebService["observability"] {
  if (!observability) return undefined;
  const next: WebService["observability"] = {};
  if (typeof observability.accessLogs === "boolean") next.accessLogs = observability.accessLogs;
  if (typeof observability.metrics === "boolean") next.metrics = observability.metrics;
  if (typeof observability.tracing === "boolean") next.tracing = observability.tracing;
  return Object.keys(next).length ? next : undefined;
}

function createHistoryId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function rollbackAvailable(rollbackId: string | undefined): boolean {
  return Boolean(rollbackId && fs.existsSync(rollbackSnapshotPath(rollbackId)));
}

function saveRollbackSnapshot(eventId: string): string | undefined {
  if (!fs.existsSync(config.stateFile)) return undefined;
  const rollbackId = eventId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const filePath = rollbackSnapshotPath(rollbackId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.copyFileSync(config.stateFile, filePath);
  return rollbackId;
}

function rollbackSnapshotPath(rollbackId: string): string {
  return path.join(path.dirname(config.stateFile), "rollbacks", `${rollbackId}.json`);
}

function saveRestoredState(state: GateLiteState): GateLiteState {
  const restored: GateLiteState = {
    ...state,
    groups: normalizeGroupOrders(state.groups),
    webServices: normalizeServiceOrders(state.webServices).map((service) => {
      const matchMode = service.matchMode || "host";
      return {
        ...service,
        matchMode,
        domains: matchMode === "default" ? [] : normalizeStringList(service.domains),
        domainRoot: matchMode === "default" ? undefined : normalizeDomainRoot(service.domainRoot),
        entryPoints: normalizeStringList(service.entryPoints),
        middlewares: normalizeStringList(service.middlewares),
        observability: normalizeObservability(service.observability)
      };
    }),
    certificates: normalizeCertificateOrders(state.certificates).map(refreshCertificateMetadata)
  };

  fs.mkdirSync(path.dirname(config.stateFile), { recursive: true });
  fs.writeFileSync(config.stateFile, JSON.stringify(restored, null, 2), "utf8");
  writeTraefikDynamicConfig(restored);
  return restored;
}
