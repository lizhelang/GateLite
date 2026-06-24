import express from "express";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { CertificateWithBindings, DashboardPayload, WebService, WebServiceWithRuntime } from "../shared/types";
import { webServicesBoundToCertificate } from "./bindings";
import { config } from "./config";
import { createCertificateFromInput, refreshCertificateFromAction, updateCertificateFromInput } from "./certificates";
import { createId, traefikName } from "./ids";
import { getTrafficSnapshot } from "./metrics";
import { certificateInputSchema, groupInputSchema, reorderSchema, webServiceInputSchema } from "./schemas";
import { ensureState, loadState, saveState } from "./store";
import { getTraefikRuntime } from "./traefik";
import { validateWebService, webServiceLabel } from "./web-services";
import { BadRequestError } from "./errors";

ensureState();

const app = express();
app.use(express.json({ limit: "4mb" }));

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
    webServices: payload.webServices
  });
});

app.post("/api/web-services", (request, response) => {
  const parsed = webServiceInputSchema.parse(request.body);
  const now = new Date().toISOString();
  const state = loadState();
  const service: WebService = {
    id: createId("svc"),
    ...parsed,
    domains: normalizeDomains(parsed.domains),
    middlewares: parsed.middlewares.filter(Boolean),
    order: state.webServices.length + 1,
    createdAt: now,
    updatedAt: now
  };
  validateWebService(service, state);
  state.webServices.push(service);
  const next = saveState(state, "web-service.create", `Created Web service ${webServiceLabel(service)}.`);
  response.status(201).json(next.webServices.find((item) => item.id === service.id));
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
    middlewares: parsed.middlewares.filter(Boolean),
    updatedAt: new Date().toISOString()
  };
  validateWebService(updated, state);
  state.webServices[index] = updated;
  const next = saveState(state, "web-service.update", `Updated Web service ${webServiceLabel(updated)}.`);
  response.json(next.webServices.find((service) => service.id === updated.id));
});

app.patch("/api/web-services/:id/toggle", (request, response) => {
  const enabled = z.object({ enabled: z.boolean() }).parse(request.body).enabled;
  const state = loadState();
  const service = state.webServices.find((item) => item.id === request.params.id);
  if (!service) return response.status(404).json({ error: "Web service not found." });
  service.enabled = enabled;
  service.updatedAt = new Date().toISOString();
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

app.put("/api/certificates/:id", (request, response) => {
  const parsed = certificateInputSchema.partial().parse(request.body);
  const state = loadState();
  const index = state.certificates.findIndex((certificate) => certificate.id === request.params.id);
  if (index === -1) return response.status(404).json({ error: "Certificate not found." });

  const current = state.certificates[index];
  state.certificates[index] = updateCertificateFromInput(current, parsed);
  const next = saveState(state, "certificate.update", `Updated certificate ${state.certificates[index].name}.`);
  response.json(next.certificates.find((certificate) => certificate.id === request.params.id));
});

app.patch("/api/certificates/:id/toggle", (request, response) => {
  const enabled = z.object({ enabled: z.boolean() }).parse(request.body).enabled;
  const state = loadState();
  const certificate = state.certificates.find((item) => item.id === request.params.id);
  if (!certificate) return response.status(404).json({ error: "Certificate not found." });
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

const distDir = path.resolve(process.cwd(), "dist");
if (fs.existsSync(distDir)) {
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
  const [runtime, trafficSnapshot] = await Promise.all([getTraefikRuntime(), getTrafficSnapshot(state.webServices)]);
  const groupsById = new Map(state.groups.map((group) => [group.id, group]));
  const routersByManagedName = new Map(runtime.routers.map((router) => [router.name.replace(/@file$/, ""), router]));

  const webServices: WebServiceWithRuntime[] = state.webServices.map((service) => {
    const routerName = traefikName("gatelite", service.id);
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
    traffic: trafficSnapshot.overview
  };
}

function normalizeDomains(domains: string[]): string[] {
  return Array.from(new Set(domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean)));
}
