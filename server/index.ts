import express from "express";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { z } from "zod";
import type { CertificateItem, CertificatePreview, CertificateWithBindings, DashboardPayload, DiscoveredRoute, ImportRoutePreview, ImportRoutesResult, WebService, WebServicePreview, WebServiceWithRuntime } from "../shared/types";
import { certificateCoversDomain, resolverName, webServicesBoundToCertificate } from "./bindings";
import { diffText } from "./config-preview";
import { config } from "./config";
import { createCertificateFromInput, receiveSyncedCertificate, refreshCertificateFromAction, updateCertificateFromInput, type CertificateInput } from "./certificates";
import { buildDiscoveredRoutes, buildRuntimeTlsBindings, createMappedWebServiceFromRoute, ensureImportedGroup, findDiscoveredRoute, transientServicesForUnmanagedRoutes } from "./discovery";
import { generateTraefikDynamicConfig } from "./generator";
import { createId, traefikName } from "./ids";
import { getTrafficSnapshot } from "./metrics";
import { certificateInputSchema, certificateSyncInputSchema, groupInputSchema, reorderSchema, webServiceInputSchema } from "./schemas";
import { ensureState, historyEventsForState, listHistory, loadState, rollbackToHistoryEvent, saveState } from "./store";
import { getTraefikRuntime } from "./traefik";
import { validateWebService, webServiceLabel } from "./web-services";
import { BadRequestError } from "./errors";

ensureState();

const app = express();
app.use(express.json({ limit: "4mb" }));
const gzipAssetCache = new Map<string, { mtimeMs: number; content: Buffer }>();

const importRouteSchema = z.object({
  routerName: z.string().trim().min(1),
  groupId: z.string().trim().optional()
});

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    traefikApiUrl: config.traefikApiUrl,
    dynamicFile: config.dynamicFile
  });
});

app.get("/api/dashboard", async (_request, response) => {
  const payload = await dashboardPayload();
  response.json(payload);
});

app.get("/api/traefik/runtime", async (_request, response) => {
  response.json(await getTraefikRuntime());
});

app.get("/api/web-services", async (_request, response) => {
  const payload = await dashboardPayload();
  response.json({
    groups: payload.groups,
    webServices: payload.webServices,
    discoveredRoutes: payload.discoveredRoutes
  });
});

app.post("/api/discovered-routes/import-preview", async (request, response) => {
  const parsed = importRouteSchema.parse(request.body);
  const state = loadState();
  const route = await loadImportableDiscoveredRoute(state, parsed.routerName);
  response.json(previewImportRouteChange(state, route, parsed.groupId));
});

app.post("/api/discovered-routes/import", async (request, response) => {
  const parsed = importRouteSchema.parse(request.body);
  const state = loadState();
  const route = await loadImportableDiscoveredRoute(state, parsed.routerName);
  const groupId = ensureImportedGroup(state, parsed.groupId);
  const now = new Date().toISOString();
  const service = createMappedWebServiceFromRoute(route, createId("svc"), groupId, state.webServices.length + 1, now);
  validateWebService(service, state);
  state.webServices.push(service);
  const next = saveState(state, "web-service.import-map", `Mapped existing Traefik router ${route.routerName} into GateLite.`);
  response.status(201).json(next.webServices.find((item) => item.id === service.id));
});

app.post("/api/discovered-routes/import-all", async (_request, response) => {
  const state = loadState();
  const runtime = await getTraefikRuntime();
  if (!runtime.connected) throw new BadRequestError(`Traefik runtime is unavailable: ${runtime.error || "not connected"}`);
  const routes = buildDiscoveredRoutes(runtime, state);
  const groupId = ensureImportedGroup(state, undefined);
  const now = new Date().toISOString();
  const result: ImportRoutesResult = {
    created: [],
    skipped: []
  };

  for (const route of routes) {
    if (route.provider === "internal") {
      result.skipped.push({ routerName: route.routerName, reason: "Traefik internal router." });
      continue;
    }
    if (route.managedMode !== "unmanaged") {
      result.skipped.push({ routerName: route.routerName, reason: "Already represented in GateLite." });
      continue;
    }
    if (!route.importable) {
      result.skipped.push({ routerName: route.routerName, reason: route.importWarnings.join(" ") || "Not importable." });
      continue;
    }

    const service = createMappedWebServiceFromRoute(route, createId("svc"), groupId, state.webServices.length + result.created.length + 1, now);
    try {
      validateWebService(service, {
        ...state,
        webServices: [...state.webServices, ...result.created]
      });
      result.created.push(service);
    } catch (error) {
      result.skipped.push({
        routerName: route.routerName,
        reason: error instanceof Error ? error.message : "Validation failed."
      });
    }
  }

  if (result.created.length > 0) {
    state.webServices.push(...result.created);
    saveState(state, "web-service.import-map-all", `Mapped ${result.created.length} existing external Traefik router(s) into GateLite.`);
  }
  response.json(result);
});

app.post("/api/web-services", (request, response) => {
  const parsed = webServiceInputSchema.parse(request.body);
  const now = new Date().toISOString();
  const state = loadState();
  const service = webServiceFromInput(createId("svc"), parsed, state.webServices.length + 1, now);
  validateWebService(service, state);
  state.webServices.push(service);
  const next = saveState(state, "web-service.create", `Created Web service ${webServiceLabel(service)}.`);
  response.status(201).json(next.webServices.find((item) => item.id === service.id));
});

app.post("/api/web-services/preview", (request, response) => {
  const parsed = webServiceInputSchema.parse(request.body);
  const now = new Date().toISOString();
  const state = loadState();
  const service = webServiceFromInput(previewServiceId(parsed.domains[0] || parsed.name || "new"), parsed, state.webServices.length + 1, now);
  validateWebService(service, state);
  response.json(previewWebServiceChange(state, service, "create"));
});

app.put("/api/web-services/:id", (request, response) => {
  const parsed = webServiceInputSchema.parse(request.body);
  const state = loadState();
  const index = state.webServices.findIndex((service) => service.id === request.params.id);
  if (index === -1) return response.status(404).json({ error: "Web service not found." });
  const updated: WebService = {
    ...state.webServices[index],
    ...parsed,
    domains: normalizeDomains(parsed.domains),
    domainRoot: normalizeDomainRoot(parsed.domainRoot),
    middlewares: parsed.middlewares.filter(Boolean),
    updatedAt: new Date().toISOString()
  };
  validateWebService(updated, state);
  state.webServices[index] = updated;
  const next = saveState(state, "web-service.update", `Updated Web service ${webServiceLabel(updated)}.`);
  response.json(next.webServices.find((service) => service.id === updated.id));
});

app.post("/api/web-services/:id/preview", (request, response) => {
  const parsed = webServiceInputSchema.parse(request.body);
  const state = loadState();
  const index = state.webServices.findIndex((service) => service.id === request.params.id);
  if (index === -1) return response.status(404).json({ error: "Web service not found." });
  const updated: WebService = {
    ...state.webServices[index],
    ...parsed,
    domains: normalizeDomains(parsed.domains),
    domainRoot: normalizeDomainRoot(parsed.domainRoot),
    middlewares: parsed.middlewares.filter(Boolean),
    updatedAt: new Date().toISOString()
  };
  validateWebService(updated, state);
  response.json(previewWebServiceChange(state, updated, "update"));
});

app.patch("/api/web-services/:id/toggle", (request, response) => {
  const enabled = z.object({ enabled: z.boolean() }).parse(request.body).enabled;
  const state = loadState();
  const service = state.webServices.find((item) => item.id === request.params.id);
  if (!service) return response.status(404).json({ error: "Web service not found." });
  if (service.managementMode === "mapped") {
    throw new BadRequestError("Mapped external routes are read-only in GateLite. Edit the original provider configuration, or delete only the GateLite mapping.");
  }
  const updated: WebService = {
    ...service,
    enabled,
    updatedAt: new Date().toISOString()
  };
  validateWebService(updated, state);
  Object.assign(service, updated);
  const next = saveState(state, "web-service.toggle", `${enabled ? "Enabled" : "Disabled"} Web service ${webServiceLabel(service)}.`);
  response.json(next.webServices.find((item) => item.id === service.id));
});

app.delete("/api/web-services/:id", (request, response) => {
  const state = loadState();
  const service = state.webServices.find((item) => item.id === request.params.id);
  if (!service) return response.status(404).json({ error: "Web service not found." });
  state.webServices = state.webServices.filter((item) => item.id !== request.params.id);
  saveState(state, "web-service.delete", `Deleted Web service ${webServiceLabel(service)}.`);
  response.status(204).send();
});

app.post("/api/web-services/reorder", (request, response) => {
  const { orderedIds } = reorderSchema.parse(request.body);
  const state = loadState();
  const order = new Map(orderedIds.map((id, index) => [id, index + 1]));
  state.webServices = state.webServices.map((service) => ({
    ...service,
    order: order.get(service.id) ?? service.order
  }));
  const next = saveState(state, "web-service.reorder", "Reordered Web services.");
  response.json(next.webServices);
});

app.post("/api/groups", (request, response) => {
  const parsed = groupInputSchema.parse(request.body);
  const state = loadState();
  const group = {
    id: createId("grp"),
    name: parsed.name,
    collapsed: parsed.collapsed,
    order: state.groups.length + 1
  };
  state.groups.push(group);
  const next = saveState(state, "group.create", `Created group ${group.name}.`);
  response.status(201).json(next.groups.find((item) => item.id === group.id));
});

app.patch("/api/groups/:id", (request, response) => {
  const parsed = groupInputSchema.partial().parse(request.body);
  const state = loadState();
  const group = state.groups.find((item) => item.id === request.params.id);
  if (!group) return response.status(404).json({ error: "Group not found." });
  Object.assign(group, parsed);
  const next = saveState(state, "group.update", `Updated group ${group.name}.`);
  response.json(next.groups.find((item) => item.id === group.id));
});

app.post("/api/groups/reorder", (request, response) => {
  const { orderedIds } = reorderSchema.parse(request.body);
  const state = loadState();
  const order = new Map(orderedIds.map((id, index) => [id, index + 1]));
  state.groups = state.groups.map((group) => ({
    ...group,
    order: order.get(group.id) ?? group.order
  }));
  const next = saveState(state, "group.reorder", "Reordered Web service groups.");
  response.json(next.groups);
});

app.delete("/api/groups/:id", (request, response) => {
  const state = loadState();
  const group = state.groups.find((item) => item.id === request.params.id);
  if (!group) return response.status(404).json({ error: "Group not found." });
  if (state.groups.length <= 1) return response.status(409).json({ error: "At least one group is required." });
  const serviceCount = state.webServices.filter((service) => service.groupId === group.id).length;
  if (serviceCount > 0) return response.status(409).json({ error: "Group is not empty. Move or delete its Web services first." });
  state.groups = state.groups.filter((item) => item.id !== group.id);
  const next = saveState(state, "group.delete", `Deleted group ${group.name}.`);
  response.json(next.groups);
});

app.get("/api/certificates", async (_request, response) => {
  const payload = await dashboardPayload();
  response.json(payload.certificates);
});

app.post("/api/certificates", (request, response) => {
  const parsed = certificateInputSchema.parse(request.body);
  const state = loadState();
  const certificate = createCertificateFromInput(parsed);
  certificate.order = state.certificates.length + 1;
  state.certificates.push(certificate);
  const next = saveState(state, "certificate.create", `Created certificate ${certificate.name}.`);
  response.status(201).json(next.certificates.find((item) => item.id === certificate.id));
});

app.post("/api/certificates/preview", (request, response) => {
  const parsed = certificateInputSchema.parse(request.body);
  const state = loadState();
  const certificate = certificateFromInputForPreview(parsed);
  certificate.order = state.certificates.length + 1;
  response.json(previewCertificateChange(state, certificate, "create"));
});

app.put("/api/certificates/:id", (request, response) => {
  const parsed = certificateInputSchema.partial().parse(request.body);
  const state = loadState();
  const index = state.certificates.findIndex((certificate) => certificate.id === request.params.id);
  if (index === -1) return response.status(404).json({ error: "Certificate not found." });

  const current = state.certificates[index];
  const bindingConflict = boundCertificateUpdateConflict(current, parsed, state.webServices);
  if (bindingConflict) return response.status(409).json({ error: bindingConflict });

  const updated = updateCertificateFromInput(current, parsed);
  const updatedBindingConflict = boundCertificateResultConflict(updated, state.webServices);
  if (updatedBindingConflict) return response.status(409).json({ error: updatedBindingConflict });

  state.certificates[index] = updated;
  const next = saveState(state, "certificate.update", `Updated certificate ${state.certificates[index].name}.`);
  response.json(next.certificates.find((certificate) => certificate.id === request.params.id));
});

app.post("/api/certificates/:id/preview", (request, response) => {
  const parsed = certificateInputSchema.partial().parse(request.body);
  const state = loadState();
  const index = state.certificates.findIndex((certificate) => certificate.id === request.params.id);
  if (index === -1) return response.status(404).json({ error: "Certificate not found." });

  const current = state.certificates[index];
  const bindingConflict = boundCertificateUpdateConflict(current, parsed, state.webServices);
  if (bindingConflict) return response.status(409).json({ error: bindingConflict });

  assertCertificatePreviewHasNoLocalWrite(current, parsed);
  const updated = updateCertificateFromInput(current, parsed);
  const updatedBindingConflict = boundCertificateResultConflict(updated, state.webServices);
  if (updatedBindingConflict) return response.status(409).json({ error: updatedBindingConflict });
  response.json(previewCertificateChange(state, updated, "update"));
});

app.patch("/api/certificates/:id/toggle", (request, response) => {
  const enabled = z.object({ enabled: z.boolean() }).parse(request.body).enabled;
  const state = loadState();
  const certificate = state.certificates.find((item) => item.id === request.params.id);
  if (!certificate) return response.status(404).json({ error: "Certificate not found." });
  if (!enabled && webServicesBoundToCertificate(certificate, state.webServices).length > 0) {
    return response.status(409).json({ error: "Certificate is bound to at least one Web service." });
  }
  certificate.enabled = enabled;
  certificate.updatedAt = new Date().toISOString();
  const next = saveState(state, "certificate.toggle", `${enabled ? "Enabled" : "Disabled"} certificate ${certificate.name}.`);
  response.json(next.certificates.find((item) => item.id === certificate.id));
});

app.patch("/api/certificates/:id/refresh", (request, response) => {
  const state = loadState();
  const index = state.certificates.findIndex((item) => item.id === request.params.id);
  if (index === -1) return response.status(404).json({ error: "Certificate not found." });
  state.certificates[index] = refreshCertificateFromAction(state.certificates[index]);
  const next = saveState(state, "certificate.refresh", `Refreshed certificate ${state.certificates[index].name}.`);
  response.json(next.certificates.find((item) => item.id === request.params.id));
});

app.post("/api/certificates/:id/sync", (request, response) => {
  const parsed = certificateSyncInputSchema.parse(request.body);
  const state = loadState();
  const index = state.certificates.findIndex((item) => item.id === request.params.id);
  if (index === -1) return response.status(404).json({ error: "Certificate not found." });

  const current = state.certificates[index];
  const synced = receiveSyncedCertificate(current, parsed);
  const bindingConflict = boundCertificateResultConflict(synced, state.webServices);
  if (bindingConflict) {
    removeReceivedCertificateFiles(synced, current);
    return response.status(409).json({ error: bindingConflict });
  }

  state.certificates[index] = synced;
  const next = saveState(state, "certificate.sync.receive", `Received synced certificate ${synced.name}.`);
  response.json(next.certificates.find((item) => item.id === request.params.id));
});

app.post("/api/certificates/reorder", (request, response) => {
  const { orderedIds } = reorderSchema.parse(request.body);
  const state = loadState();
  const order = new Map(orderedIds.map((id, index) => [id, index + 1]));
  state.certificates = state.certificates.map((certificate) => ({
    ...certificate,
    order: order.get(certificate.id) ?? certificate.order
  }));
  const next = saveState(state, "certificate.reorder", "Reordered certificates.");
  response.json(next.certificates);
});

app.get("/api/certificates/:id/download", (request, response) => {
  const state = loadState();
  const certificate = state.certificates.find((item) => item.id === request.params.id);
  if (!certificate) return response.status(404).json({ error: "Certificate not found." });
  if (!certificate.certPath || !fs.existsSync(certificate.certPath)) {
    return response.status(409).json({ error: "Certificate PEM file is not available for download." });
  }

  const parts = [
    `# ${certificate.name}`,
    `# Domains: ${certificate.domains.join(", ") || "none"}`,
    "",
    fs.readFileSync(certificate.certPath, "utf8").trim(),
    ""
  ];
  if (certificate.keyPath && fs.existsSync(certificate.keyPath)) {
    parts.push(fs.readFileSync(certificate.keyPath, "utf8").trim(), "");
  }

  const fileName = `${certificate.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || certificate.id}.pem`;
  response.setHeader("Content-Type", "application/x-pem-file; charset=utf-8");
  response.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  response.send(parts.join("\n"));
});

app.delete("/api/certificates/:id", (request, response) => {
  const state = loadState();
  const certificate = state.certificates.find((item) => item.id === request.params.id);
  if (!certificate) return response.status(404).json({ error: "Certificate not found." });
  const isBound = webServicesBoundToCertificate(certificate, state.webServices).length > 0;
  if (isBound) return response.status(409).json({ error: "Certificate is bound to at least one Web service." });
  state.certificates = state.certificates.filter((item) => item.id !== request.params.id);
  saveState(state, "certificate.delete", `Deleted certificate ${certificate.name}.`);
  response.status(204).send();
});

app.get("/api/generated-config", (_request, response) => {
  ensureState();
  response.type("text/yaml").send(fs.readFileSync(config.dynamicFile, "utf8"));
});

app.get("/api/history", (_request, response) => {
  response.json(listHistory());
});

app.post("/api/history/:id/rollback", async (request, response) => {
  if (!rollbackToHistoryEvent(request.params.id)) return response.status(404).json({ error: "Rollback snapshot not found for this history event." });
  response.json(await dashboardPayload());
});

const distDir = path.resolve(process.cwd(), "dist");
if (fs.existsSync(distDir)) {
  app.use(serveCompressedStaticAsset);
  app.use(express.static(distDir));
  app.use((_request, response) => {
    response.sendFile(path.join(distDir, "index.html"));
  });
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) {
    return response.status(400).json({ error: "Validation failed.", issues: error.issues });
  }
  if (error instanceof BadRequestError) {
    return response.status(error.statusCode).json({ error: error.message });
  }
  console.error(error);
  return response.status(500).json({ error: error instanceof Error ? error.message : "Unexpected server error." });
});

app.listen(config.port, () => {
  console.log(`GateLite API listening on http://localhost:${config.port}`);
  console.log(`Traefik API target: ${config.traefikApiUrl}`);
});

async function dashboardPayload(): Promise<DashboardPayload> {
  const state = loadState();
  const runtime = await getTraefikRuntime();
  const transientServices = transientServicesForUnmanagedRoutes(runtime, state);
  const trafficSnapshot = await getTrafficSnapshot([...state.webServices, ...transientServices]);
  const discoveredRoutes = buildDiscoveredRoutes(runtime, state, trafficSnapshot.statsByServiceId);
  const runtimeTlsBindings = buildRuntimeTlsBindings(runtime, state, discoveredRoutes);
  const groupsById = new Map(state.groups.map((group) => [group.id, group]));
  const routersByManagedName = new Map(runtime.routers.flatMap((router) => [[router.name, router] as const, [router.name.replace(/@[a-z0-9_-]+$/i, ""), router] as const]));

  const webServices: WebServiceWithRuntime[] = state.webServices.map((service) => {
    const routerName = service.managementMode === "mapped" && service.sourceRouterName ? service.sourceRouterName : traefikName("gatelite", service.id);
    return {
      ...service,
      groupName: groupsById.get(service.groupId)?.name || "Ungrouped",
      runtime: routersByManagedName.get(routerName),
      traffic: trafficSnapshot.statsByServiceId.get(service.id)
    };
  });

  const certificates: CertificateWithBindings[] = state.certificates.map((certificate) => ({
    ...certificate,
    boundServices: webServicesBoundToCertificate(certificate, state.webServices)
  }));

  return {
    runtime,
    groups: state.groups,
    webServices,
    certificates,
    discoveredRoutes,
    runtimeTlsBindings,
    traffic: trafficSnapshot.overview,
    history: historyEventsForState(state)
  };
}

function serveCompressedStaticAsset(request: express.Request, response: express.Response, next: express.NextFunction) {
  if (request.method !== "GET" && request.method !== "HEAD") return next();
  if (!request.acceptsEncodings("gzip")) return next();
  if (!/^\/assets\/.+\.(?:js|css)$/i.test(request.path)) return next();

  const filePath = safeDistPath(request.path);
  if (!filePath) return next();

  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return next();
    const cached = gzipAssetCache.get(filePath);
    const content = cached && cached.mtimeMs === stat.mtimeMs ? cached.content : zlib.gzipSync(fs.readFileSync(filePath), { level: 6 });

    if (!cached || cached.mtimeMs !== stat.mtimeMs) {
      gzipAssetCache.set(filePath, { mtimeMs: stat.mtimeMs, content });
    }

    response.setHeader("Content-Encoding", "gzip");
    response.setHeader("Vary", "Accept-Encoding");
    response.setHeader("Content-Length", content.length);
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    response.type(path.extname(filePath));
    if (request.method === "HEAD") return response.end();
    return response.end(content);
  } catch {
    return next();
  }
}

function safeDistPath(requestPath: string): string | undefined {
  const relativePath = decodeURIComponent(requestPath).replace(/^\/+/, "");
  const filePath = path.resolve(distDir, relativePath);
  if (filePath !== distDir && !filePath.startsWith(`${distDir}${path.sep}`)) return undefined;
  return filePath;
}

async function loadImportableDiscoveredRoute(state: ReturnType<typeof loadState>, routerName: string): Promise<DiscoveredRoute> {
  const runtime = await getTraefikRuntime();
  if (!runtime.connected) throw new BadRequestError(`Traefik runtime is unavailable: ${runtime.error || "not connected"}`);
  const routes = buildDiscoveredRoutes(runtime, state);
  const route = findDiscoveredRoute(routes, routerName);
  if (!route) throw new BadRequestError(`Traefik router not found: ${routerName}`);
  if (route.managedServiceId) throw new BadRequestError(`Traefik router is already mapped in GateLite: ${route.routerName}`);
  if (!route.importable) throw new BadRequestError(`Traefik router cannot be imported: ${route.importWarnings.join(" ")}`);
  return route;
}

function normalizeDomains(domains: string[]): string[] {
  return Array.from(new Set(domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean)));
}

function normalizeDomainRoot(domainRoot: string | undefined): string | undefined {
  const normalized = domainRoot?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^\.+|\.+$/g, "");
  return normalized || undefined;
}

function webServiceFromInput(id: string, input: z.infer<typeof webServiceInputSchema>, order: number, now: string): WebService {
  return {
    id,
    ...input,
    domains: normalizeDomains(input.domains),
    domainRoot: normalizeDomainRoot(input.domainRoot),
    middlewares: input.middlewares.filter(Boolean),
    order,
    createdAt: now,
    updatedAt: now
  };
}

function previewServiceId(seed: string): string {
  const clean = seed
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return `preview-${clean || "service"}`;
}

function previewWebServiceChange(state: ReturnType<typeof loadState>, service: WebService, action: WebServicePreview["action"]): WebServicePreview {
  const currentYaml = generateTraefikDynamicConfig(state).yaml;
  const nextState = {
    ...state,
    webServices:
      action === "create"
        ? [...state.webServices, service]
        : state.webServices.map((item) => (item.id === service.id ? service : item))
  };
  const nextYaml = generateTraefikDynamicConfig(nextState).yaml;
  return {
    valid: true,
    action,
    service,
    currentYaml,
    nextYaml,
    diff: diffText(currentYaml, nextYaml)
  };
}

function previewImportRouteChange(state: ReturnType<typeof loadState>, route: DiscoveredRoute, groupIdInput: string | undefined): ImportRoutePreview {
  const currentYaml = generateTraefikDynamicConfig(state).yaml;
  const nextState = JSON.parse(JSON.stringify(state)) as ReturnType<typeof loadState>;
  const groupId = ensureImportedGroup(nextState, groupIdInput);
  const now = new Date().toISOString();
  const service = createMappedWebServiceFromRoute(route, `preview-${route.routerName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "route"}`, groupId, nextState.webServices.length + 1, now);
  validateWebService(service, nextState);
  nextState.webServices.push(service);
  const nextYaml = generateTraefikDynamicConfig(nextState).yaml;
  return {
    valid: true,
    action: "map",
    route,
    service,
    currentYaml,
    nextYaml,
    diff: diffText(currentYaml, nextYaml),
    warnings: [
      "This import creates a GateLite mapping only.",
      "GateLite will not write a duplicate file-provider router for an existing external provider route.",
      ...route.importWarnings
    ]
  };
}

function certificateFromInputForPreview(input: z.infer<typeof certificateInputSchema>): CertificateItem {
  if (input.source === "self-signed" || input.source === "upload") {
    throw new BadRequestError("Certificate preview is unavailable for sources that generate local PEM files. Use apply for self-signed/upload certificates, or preview path, ACME, and sync sources.");
  }
  return createCertificateFromInput(input);
}

function assertCertificatePreviewHasNoLocalWrite(current: CertificateItem, input: Partial<z.infer<typeof certificateInputSchema>>): void {
  const source = input.source ?? current.source;
  const regeneratesSelfSigned = source === "self-signed" && (current.source !== "self-signed" || input.domains !== undefined || input.days !== undefined);
  const writesUploadPem = source === "upload" && (current.source !== "upload" || input.certPem !== undefined || input.keyPem !== undefined || !current.certPath || !current.keyPath);
  if (regeneratesSelfSigned || writesUploadPem) {
    throw new BadRequestError("Certificate preview would need to generate or replace local PEM files. Apply the certificate change to write files, or preview path, ACME, sync, or metadata-only changes.");
  }
}

function previewCertificateChange(state: ReturnType<typeof loadState>, certificate: CertificateItem, action: CertificatePreview["action"]): CertificatePreview {
  const currentYaml = generateTraefikDynamicConfig(state).yaml;
  const nextState = {
    ...state,
    certificates:
      action === "create"
        ? [...state.certificates, certificate]
        : state.certificates.map((item) => (item.id === certificate.id ? certificate : item))
  };
  const nextYaml = generateTraefikDynamicConfig(nextState).yaml;
  return {
    valid: true,
    action,
    certificate,
    currentYaml,
    nextYaml,
    diff: diffText(currentYaml, nextYaml)
  };
}

function boundCertificateUpdateConflict(current: CertificateItem, input: Partial<CertificateInput>, services: WebService[]): string | undefined {
  const boundServices = webServicesBoundToCertificate(current, services);
  if (boundServices.length === 0) return undefined;
  if (input.enabled === false) return "Certificate is bound to at least one Web service.";

  const fileBoundServices = boundServices.filter((service) => service.tls.mode === "file-certificate" && service.tls.certificateId === current.id);
  if (fileBoundServices.length > 0) {
    if (input.source !== undefined && input.source !== current.source) {
      return "Certificate is bound to at least one Web service. Unbind it before changing certificate source.";
    }
    if (input.certPem !== undefined || input.keyPem !== undefined || input.certPath !== undefined || input.keyPath !== undefined) {
      return "Certificate is bound to at least one Web service. Unbind it before replacing certificate files.";
    }
    if (input.domains !== undefined) {
      const nextDomains = normalizeDomains(input.domains);
      const missingDomains = boundServiceDomains(fileBoundServices).filter((domain) => !certificateCoversDomain(nextDomains, domain));
      if (missingDomains.length > 0) {
        return `Certificate update would stop covering bound Web service domain(s): ${missingDomains.join(", ")}.`;
      }
    }
  }

  const resolverBoundServices = boundServices.filter((service) => service.tls.mode === "resolver");
  if (resolverBoundServices.length > 0) {
    if (input.source !== undefined && input.source !== "acme") {
      return "ACME certificate is bound to at least one resolver Web service. Unbind it before changing certificate source.";
    }
    if (input.acme !== undefined) {
      const nextResolver = resolverName(input.acme.resolver);
      const requiredResolvers = Array.from(new Set(resolverBoundServices.map((service) => resolverName(service.tls.resolver))));
      const missingResolvers = requiredResolvers.filter((requiredResolver) => requiredResolver !== nextResolver);
      if (missingResolvers.length > 0) {
        return `ACME resolver update would unbind Web service resolver(s): ${missingResolvers.join(", ")}.`;
      }
    }
  }

  return undefined;
}

function boundCertificateResultConflict(certificate: CertificateItem, services: WebService[]): string | undefined {
  const fileBoundServices = services.filter((service) => service.tls.mode === "file-certificate" && service.tls.certificateId === certificate.id);
  if (fileBoundServices.length === 0) return undefined;
  if (!certificate.enabled) return "Certificate is bound to at least one Web service.";
  if (certificate.source === "acme") {
    return "Certificate is bound to file-certificate Web services and must remain a local certificate source.";
  }
  if (!certificate.certPath || !certificate.keyPath) {
    return "Certificate is bound to file-certificate Web services and must keep readable certificate files.";
  }
  if (certificate.status === "pending" || certificate.status === "invalid" || certificate.status === "expired") {
    return `Certificate is bound to file-certificate Web services and cannot be ${certificate.status}.`;
  }
  const missingDomains = boundServiceDomains(fileBoundServices).filter((domain) => !certificateCoversDomain(certificate.domains, domain));
  if (missingDomains.length > 0) {
    return `Certificate update would stop covering bound Web service domain(s): ${missingDomains.join(", ")}.`;
  }
  return undefined;
}

function boundServiceDomains(services: WebService[]): string[] {
  return Array.from(new Set(services.flatMap((service) => service.domains).map((domain) => domain.trim().toLowerCase()).filter(Boolean)));
}

function removeReceivedCertificateFiles(next: CertificateItem, current: CertificateItem): void {
  const certDir = path.resolve(config.certDir);
  for (const filePath of [next.certPath, next.keyPath]) {
    if (!filePath || filePath === current.certPath || filePath === current.keyPath) continue;
    const resolved = path.resolve(filePath);
    const relative = path.relative(certDir, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    fs.rmSync(resolved, { force: true });
  }
}
