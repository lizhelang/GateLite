import http from "node:http";
import https from "node:https";

const gateliteApiUrl = process.env.GATELITE_API_URL || "http://localhost:3001";
const traefikApiUrl = process.env.TRAEFIK_API_URL || "http://localhost:18081";
const httpRouteUrl = process.env.GATELITE_VERIFY_HTTP_URL || "http://127.0.0.1:18080";
const httpsRouteUrl = process.env.GATELITE_VERIFY_HTTPS_URL || "https://127.0.0.1:18443";
const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const originalHttpHost = `crud-${suffix}.localhost`;
const editedHttpHost = `crud-edit-${suffix}.localhost`;
const httpsHost = `crud-tls-${suffix}.localhost`;

const created = {
  groupId: "",
  certificateId: "",
  httpServiceId: "",
  httpsServiceId: ""
};

try {
  await assertGateLiteConnected();
  const group = await createAndVerifyGroup();
  created.groupId = group.id;

  const certificate = await createAndVerifyCertificate();
  created.certificateId = certificate.id;
  await downloadAndVerifyCertificate(certificate.id);
  await reorderAndVerifyCertificates(certificate.id);

  const httpService = await createAndVerifyHttpService(group.id);
  created.httpServiceId = httpService.id;

  await updateAndVerifyHttpService(httpService, group.id);
  await toggleAndVerifyHttpService(httpService.id);

  const httpsService = await createAndVerifyHttpsService(group.id, certificate.id);
  created.httpsServiceId = httpsService.id;
  await verifyCertificateBinding(certificate.id, httpsService.id);
  await reorderAndVerifyServices([httpsService.id, httpService.id]);

  await deleteAndVerifyResources();
  console.log("[ok] GateLite management CRUD verification passed.");
} catch (error) {
  console.error(`[fail] ${error instanceof Error ? error.message : String(error)}`);
  await cleanup();
  process.exitCode = 1;
}

async function assertGateLiteConnected() {
  const dashboard = await apiJson("/api/dashboard");
  if (!dashboard?.runtime?.connected) {
    throw new Error("GateLite API is not connected to Traefik. Start Docker Compose and GateLite before running CRUD verification.");
  }
  console.log(`[ok] GateLite API connected to Traefik ${dashboard.runtime.version || "unknown"}.`);
}

async function createAndVerifyGroup() {
  const createdGroup = await apiJson("/api/groups", {
    method: "POST",
    body: { name: `CRUD verify ${suffix}`, collapsed: false },
    expectedStatus: 201
  });
  const collapsed = await apiJson(`/api/groups/${createdGroup.id}`, {
    method: "PATCH",
    body: { collapsed: true }
  });
  if (collapsed.collapsed !== true) {
    throw new Error("Group collapse update was not persisted.");
  }
  const renamed = await apiJson(`/api/groups/${createdGroup.id}`, {
    method: "PATCH",
    body: { name: `CRUD verify renamed ${suffix}`, collapsed: false }
  });
  if (renamed.name !== `CRUD verify renamed ${suffix}` || renamed.collapsed !== false) {
    throw new Error("Group rename/collapse reset was not persisted.");
  }
  console.log("[ok] Group create, rename, collapse, and expand operations work.");
  return renamed;
}

async function createAndVerifyCertificate() {
  const certificate = await apiJson("/api/certificates", {
    method: "POST",
    body: {
      name: `CRUD TLS ${suffix}`,
      enabled: true,
      source: "self-signed",
      domains: [httpsHost],
      days: 90
    },
    expectedStatus: 201
  });
  if (certificate.status !== "valid" || !certificate.notAfter) {
    throw new Error(`Expected created self-signed certificate to be valid with expiry, got ${certificate.status}.`);
  }

  const renamed = await apiJson(`/api/certificates/${certificate.id}`, {
    method: "PUT",
    body: { name: `CRUD TLS renamed ${suffix}` }
  });
  if (renamed.name !== `CRUD TLS renamed ${suffix}`) {
    throw new Error("Certificate edit was not persisted.");
  }

  const disabled = await apiJson(`/api/certificates/${certificate.id}/toggle`, {
    method: "PATCH",
    body: { enabled: false }
  });
  if (disabled.enabled !== false) {
    throw new Error("Certificate disable toggle was not persisted.");
  }
  const enabled = await apiJson(`/api/certificates/${certificate.id}/toggle`, {
    method: "PATCH",
    body: { enabled: true }
  });
  if (enabled.enabled !== true) {
    throw new Error("Certificate enable toggle was not persisted.");
  }
  console.log("[ok] Certificate create, edit, status, expiry, and enable toggles work.");
  return enabled;
}

async function downloadAndVerifyCertificate(certificateId) {
  const response = await request(`${gateliteApiUrl}/api/certificates/${certificateId}/download`);
  if (response.status !== 200) {
    throw new Error(`Certificate download returned HTTP ${response.status}: ${response.body.slice(0, 300)}`);
  }
  assertIncludes(response.body, "BEGIN CERTIFICATE", "certificate download");
  if (!/BEGIN (RSA )?PRIVATE KEY/.test(response.body)) {
    throw new Error("Certificate download did not include a private key PEM block.");
  }
  console.log("[ok] Certificate download returns a PEM bundle.");
}

async function reorderAndVerifyCertificates(certificateId) {
  const dashboard = await apiJson("/api/dashboard");
  const remainingIds = dashboard.certificates.map((certificate) => certificate.id).filter((id) => id !== certificateId);
  await apiJson("/api/certificates/reorder", {
    method: "POST",
    body: { orderedIds: [certificateId, ...remainingIds] }
  });
  const next = await apiJson("/api/dashboard");
  const orderedIds = next.certificates.map((certificate) => certificate.id);
  if (orderedIds[0] !== certificateId) {
    throw new Error("Certificate reorder was not persisted.");
  }
  console.log("[ok] Certificate reorder persists list order.");
}

async function createAndVerifyHttpService(groupId) {
  const service = await apiJson("/api/web-services", {
    method: "POST",
    body: {
      name: "",
      enabled: true,
      groupId,
      domains: [originalHttpHost],
      listenPort: 18080,
      entryPoints: ["web"],
      targetUrl: "http://whoami:80",
      middlewares: [],
      tls: { mode: "none" },
      notes: "Temporary HTTP route created by verify:crud."
    },
    expectedStatus: 201
  });
  if (service.name !== "") {
    throw new Error("Blank Web service rule name was not preserved.");
  }
  await waitForHttpRoute(originalHttpHost, "http");
  const body = await routeText(httpRouteUrl, originalHttpHost);
  assertIncludes(body, `Host: ${originalHttpHost}`, originalHttpHost);
  assertIncludes(body, "X-Forwarded-Proto: http", originalHttpHost);
  console.log("[ok] Web service create accepts a blank rule name and applies an HTTP Traefik route.");
  return service;
}

async function updateAndVerifyHttpService(service, groupId) {
  const updated = await apiJson(`/api/web-services/${service.id}`, {
    method: "PUT",
    body: {
      name: `CRUD HTTP edited ${suffix}`,
      enabled: true,
      groupId,
      domains: [editedHttpHost],
      listenPort: 18080,
      entryPoints: ["web"],
      targetUrl: "http://whoami:80",
      middlewares: [],
      tls: { mode: "none" },
      notes: "Edited temporary HTTP route created by verify:crud."
    }
  });
  if (updated.name !== `CRUD HTTP edited ${suffix}` || updated.domains[0] !== editedHttpHost) {
    throw new Error("Web service edit was not persisted.");
  }
  await waitForHttpRoute(editedHttpHost, "http");
  await waitForRouteUnavailable(originalHttpHost, "http");
  console.log("[ok] Web service edit updates the active Traefik host rule.");
}

async function toggleAndVerifyHttpService(serviceId) {
  const disabled = await apiJson(`/api/web-services/${serviceId}/toggle`, {
    method: "PATCH",
    body: { enabled: false }
  });
  if (disabled.enabled !== false) {
    throw new Error("Web service disable toggle was not persisted.");
  }
  await waitForRouteUnavailable(editedHttpHost, "http");

  const enabled = await apiJson(`/api/web-services/${serviceId}/toggle`, {
    method: "PATCH",
    body: { enabled: true }
  });
  if (enabled.enabled !== true) {
    throw new Error("Web service enable toggle was not persisted.");
  }
  await waitForHttpRoute(editedHttpHost, "http");
  console.log("[ok] Web service enable/disable toggles add and remove the Traefik route.");
}

async function createAndVerifyHttpsService(groupId, certificateId) {
  const service = await apiJson("/api/web-services", {
    method: "POST",
    body: {
      name: `CRUD HTTPS ${suffix}`,
      enabled: true,
      groupId,
      domains: [httpsHost],
      listenPort: 18443,
      entryPoints: ["websecure"],
      targetUrl: "http://whoami:80",
      middlewares: [],
      tls: { mode: "file-certificate", certificateId },
      notes: "Temporary HTTPS route created by verify:crud."
    },
    expectedStatus: 201
  });
  await waitForHttpRoute(httpsHost, "https");
  const body = await routeText(httpsRouteUrl, httpsHost, { allowSelfSigned: true });
  assertIncludes(body, `Host: ${httpsHost}`, httpsHost);
  assertIncludes(body, "X-Forwarded-Proto: https", httpsHost);
  console.log("[ok] Web service create applies an HTTPS/TLS Traefik route.");
  return service;
}

async function verifyCertificateBinding(certificateId, serviceId) {
  const certificates = await apiJson("/api/certificates");
  const certificate = certificates.find((item) => item.id === certificateId);
  if (!certificate) {
    throw new Error("Created certificate disappeared from certificate list.");
  }
  if (!certificate.boundServices.some((service) => service.id === serviceId)) {
    throw new Error("Certificate binding list does not include the HTTPS Web service.");
  }
  console.log("[ok] Certificate binding list reflects the HTTPS Web service.");
}

async function reorderAndVerifyServices(serviceIds) {
  const dashboard = await apiJson("/api/dashboard");
  const remainingIds = dashboard.webServices.map((service) => service.id).filter((id) => !serviceIds.includes(id));
  await apiJson("/api/web-services/reorder", {
    method: "POST",
    body: { orderedIds: [...serviceIds, ...remainingIds] }
  });
  const next = await apiJson("/api/dashboard");
  const orderedIds = next.webServices.map((service) => service.id);
  if (orderedIds[0] !== serviceIds[0] || orderedIds[1] !== serviceIds[1]) {
    throw new Error("Web service reorder was not persisted.");
  }
  console.log("[ok] Web service reorder persists list order.");
}

async function deleteAndVerifyResources() {
  await apiNoContent(`/api/web-services/${created.httpsServiceId}`, "DELETE");
  created.httpsServiceId = "";
  await waitForRouteUnavailable(httpsHost, "https");

  await apiNoContent(`/api/web-services/${created.httpServiceId}`, "DELETE");
  created.httpServiceId = "";
  await waitForRouteUnavailable(editedHttpHost, "http");

  await apiNoContent(`/api/certificates/${created.certificateId}`, "DELETE");
  created.certificateId = "";
  await apiJson(`/api/groups/${created.groupId}`, { method: "DELETE" });
  created.groupId = "";
  console.log("[ok] Web service, certificate, and group delete operations clean up temporary resources.");
}

async function cleanup() {
  await ignoreNotFound(async () => created.httpsServiceId && apiNoContent(`/api/web-services/${created.httpsServiceId}`, "DELETE"));
  await ignoreNotFound(async () => created.httpServiceId && apiNoContent(`/api/web-services/${created.httpServiceId}`, "DELETE"));
  await ignoreNotFound(async () => created.certificateId && apiNoContent(`/api/certificates/${created.certificateId}`, "DELETE"));
  await ignoreNotFound(async () => created.groupId && apiJson(`/api/groups/${created.groupId}`, { method: "DELETE" }));
}

async function waitForHttpRoute(host, protocol) {
  await retry(async () => {
    const routers = await requestJson(`${traefikApiUrl}/api/http/routers`);
    if (!routers.some((router) => router.rule?.includes(`Host(\`${host}\`)`) && router.status === "enabled")) {
      throw new Error(`${protocol.toUpperCase()} router for ${host} is not enabled yet.`);
    }
    const url = protocol === "https" ? httpsRouteUrl : httpRouteUrl;
    const body = await routeText(url, host, { allowSelfSigned: protocol === "https" });
    assertIncludes(body, `Host: ${host}`, host);
  }, `${protocol.toUpperCase()} route ${host}`);
}

async function waitForRouteUnavailable(host, protocol) {
  await retry(async () => {
    const routers = await requestJson(`${traefikApiUrl}/api/http/routers`);
    if (routers.some((router) => router.rule?.includes(`Host(\`${host}\`)`) && router.status === "enabled")) {
      throw new Error(`${protocol.toUpperCase()} router for ${host} is still enabled.`);
    }
    const url = protocol === "https" ? httpsRouteUrl : httpRouteUrl;
    await expectRouteFailure(url, host, { allowSelfSigned: protocol === "https" });
  }, `${protocol.toUpperCase()} route removal ${host}`);
}

async function apiJson(path, { method = "GET", body, expectedStatus = 200 } = {}) {
  const response = await request(`${gateliteApiUrl}${path}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { "Content-Type": "application/json" } : undefined
  });
  if (response.status !== expectedStatus) {
    throw new Error(`${method} ${path} returned HTTP ${response.status}: ${response.body.slice(0, 300)}`);
  }
  return response.body ? JSON.parse(response.body) : undefined;
}

async function apiNoContent(path, method) {
  const response = await request(`${gateliteApiUrl}${path}`, { method });
  if (response.status !== 204) {
    throw new Error(`${method} ${path} returned HTTP ${response.status}: ${response.body.slice(0, 300)}`);
  }
}

async function requestJson(url) {
  const response = await request(url);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${url} returned HTTP ${response.status}: ${response.body.slice(0, 300)}`);
  }
  return JSON.parse(response.body);
}

async function routeText(url, host, options = {}) {
  const response = await request(url, {
    headers: { Host: host },
    allowSelfSigned: options.allowSelfSigned
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${url} (${host}) returned HTTP ${response.status}: ${response.body.slice(0, 300)}`);
  }
  return response.body;
}

async function expectRouteFailure(url, host, options = {}) {
  const response = await request(url, {
    headers: { Host: host },
    allowSelfSigned: options.allowSelfSigned
  });
  if (response.status !== 404) {
    throw new Error(`${url} (${host}) should be unavailable with 404, got HTTP ${response.status}.`);
  }
}

function request(url, { method = "GET", body, headers = {}, allowSelfSigned = false } = {}) {
  const target = new URL(url);
  const transport = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(
      target,
      {
        method,
        headers,
        timeout: 5000,
        rejectUnauthorized: allowSelfSigned ? false : undefined
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          resolve({ status: response.statusCode || 0, body: responseBody });
        });
      }
    );
    request.on("timeout", () => request.destroy(new Error(`${method} ${url} timed out after 5000ms.`)));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

async function retry(operation, label) {
  let lastError;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`${label} did not settle: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function ignoreNotFound(operation) {
  try {
    await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("404")) {
      console.warn(`[warn] cleanup skipped: ${message}`);
    }
  }
}

function assertIncludes(value, expected, source) {
  if (!value.includes(expected)) {
    throw new Error(`Expected ${source} to include "${expected}".`);
  }
}
