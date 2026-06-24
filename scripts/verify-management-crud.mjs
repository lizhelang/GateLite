import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const gateliteApiUrl = process.env.GATELITE_API_URL || "http://localhost:3001";
const traefikApiUrl = process.env.TRAEFIK_API_URL || "http://localhost:18081";
const httpRouteUrl = process.env.GATELITE_VERIFY_HTTP_URL || "http://127.0.0.1:18080";
const httpsRouteUrl = process.env.GATELITE_VERIFY_HTTPS_URL || "https://127.0.0.1:18443";
const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const originalHttpHost = `crud-${suffix}.localhost`;
const editedHttpHost = `crud-edit-${suffix}.localhost`;
const customHttpHost = `crud-custom-${suffix}.localhost`;
const defaultFallbackHost = `unmatched-${suffix}.localhost`;
const httpsHost = `crud-tls-${suffix}.localhost`;
const editedHttpsHost = `crud-tls-edit-${suffix}.localhost`;
const uploadedHttpsHost = `crud-upload-${suffix}.localhost`;
const pathHttpsHost = `crud-path-${suffix}.localhost`;
const syncHttpsHost = `crud-sync-received-${suffix}.localhost`;
const acmeHost = `crud-acme-${suffix}.localhost`;
const acmeResolver = `resolver-${suffix}`;
const mountedCertDir = path.resolve(process.env.GATELITE_VERIFY_CERT_DIR || "runtime/certs");

const created = {
  groupId: "",
  certificateId: "",
  acmeCertificateId: "",
  httpServiceId: "",
  duplicateHttpServiceId: "",
  customServiceId: "",
  defaultServiceId: "",
  httpsServiceId: "",
  httpsHost: "",
  uploadedCertificateId: "",
  uploadedServiceId: "",
  pathCertificateId: "",
  pathServiceId: "",
  syncedCertificateId: "",
  syncedServiceId: "",
  pathCertificateFiles: [],
  acmeServiceId: ""
};

try {
  await assertGateLiteConnected();
  const group = await createAndVerifyGroup();
  created.groupId = group.id;
  await verifyWebServiceValidation(group.id);

  const certificate = await createAndVerifyCertificate();
  created.certificateId = certificate.id;
  await downloadAndVerifyCertificate(certificate.id);
  await reorderAndVerifyCertificates(certificate.id);
  await createRefreshAndDeleteSyncCertificate();
  await createAndVerifySyncedCertificateRoute(group.id);
  await createAndVerifyUploadedCertificateRoute(group.id);
  await createAndVerifyPathCertificateRoute(group.id);

  const httpService = await createAndVerifyHttpService(group.id);
  created.httpServiceId = httpService.id;

  await verifyDuplicateDomainProtection(group.id, httpService.domains[0]);
  await updateAndVerifyHttpService(httpService, group.id);
  await toggleAndVerifyHttpService(httpService.id);
  const customService = await createAndVerifyCustomHttpService(group.id);
  created.customServiceId = customService.id;
  const defaultService = await createAndVerifyDefaultHttpService(group.id);
  created.defaultServiceId = defaultService.id;
  await deleteAndVerifyDefaultHttpService(defaultService.id);
  created.defaultServiceId = "";

  const httpsService = await createAndVerifyHttpsService(group.id, certificate.id, certificate.domains[0] || editedHttpsHost);
  created.httpsServiceId = httpsService.id;
  created.httpsHost = certificate.domains[0] || editedHttpsHost;
  await verifyCertificateBinding(certificate.id, httpsService.id, "HTTPS file certificate");
  await verifyBoundCertificateToggleProtection(certificate.id, "HTTPS file certificate");
  await verifyBoundFileCertificateUpdateProtection(certificate.id, certificate.domains[0] || editedHttpsHost, "HTTPS file certificate");
  await createAndVerifyAcmeResolverBinding(group.id);
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

async function verifyWebServiceValidation(groupId) {
  const missingGroup = await request(`${gateliteApiUrl}/api/web-services`, {
    method: "POST",
    body: JSON.stringify({
      name: `CRUD invalid group ${suffix}`,
      enabled: true,
      groupId: `missing-${suffix}`,
      domains: [`invalid-group-${suffix}.localhost`],
      listenPort: 18080,
      entryPoints: ["web"],
      targetUrl: "whoami:80",
      middlewares: [],
      tls: { mode: "none" }
    }),
    headers: { "Content-Type": "application/json" }
  });
  if (missingGroup.status !== 400 || !missingGroup.body.includes("Web service group does not exist")) {
    throw new Error(`Missing Web service group should return HTTP 400, got ${missingGroup.status}: ${missingGroup.body.slice(0, 300)}`);
  }

  const missingCertificate = await request(`${gateliteApiUrl}/api/web-services`, {
    method: "POST",
    body: JSON.stringify({
      name: `CRUD invalid certificate ${suffix}`,
      enabled: true,
      groupId,
      domains: [`invalid-cert-${suffix}.localhost`],
      listenPort: 18443,
      entryPoints: ["websecure"],
      targetUrl: "http://whoami:80",
      middlewares: [],
      tls: { mode: "file-certificate", certificateId: `missing-${suffix}` }
    }),
    headers: { "Content-Type": "application/json" }
  });
  if (missingCertificate.status !== 400 || !missingCertificate.body.includes("Certificate does not exist")) {
    throw new Error(`Missing Web service certificate should return HTTP 400, got ${missingCertificate.status}: ${missingCertificate.body.slice(0, 300)}`);
  }

  console.log("[ok] Web service validation rejects missing groups and certificate references.");
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

  const regenerated = await apiJson(`/api/certificates/${certificate.id}`, {
    method: "PUT",
    body: {
      name: `CRUD TLS renamed ${suffix}`,
      source: "self-signed",
      domains: [editedHttpsHost],
      days: 120
    }
  });
  if (!regenerated.domains.includes(editedHttpsHost) || regenerated.status !== "valid" || !regenerated.notAfter) {
    throw new Error("Certificate edit did not regenerate a valid self-signed certificate with the updated SAN.");
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
  console.log("[ok] Certificate create, edit, SAN regeneration, status, expiry, and enable toggles work.");
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

async function createRefreshAndDeleteSyncCertificate() {
  const certificate = await apiJson("/api/certificates", {
    method: "POST",
    body: {
      name: `CRUD sync ${suffix}`,
      enabled: true,
      source: "sync",
      domains: [`sync-${suffix}.localhost`],
      sync: { target: `https://peer.example.com/sync/${suffix}` }
    },
    expectedStatus: 201
  });
  if (certificate.status !== "pending" || certificate.sync?.target !== `https://peer.example.com/sync/${suffix}`) {
    throw new Error("Sync certificate was not registered as a pending sync target.");
  }

  const refreshed = await apiJson(`/api/certificates/${certificate.id}/refresh`, {
    method: "PATCH"
  });
  if (refreshed.status !== "pending" || !refreshed.sync?.lastSyncTime) {
    throw new Error("Sync certificate refresh did not preserve pending status and record lastSyncTime.");
  }

  await apiNoContent(`/api/certificates/${certificate.id}`, "DELETE");
  console.log("[ok] Sync certificate target registration and refresh status action work.");
}

async function createAndVerifySyncedCertificateRoute(groupId) {
  const certificate = await apiJson("/api/certificates", {
    method: "POST",
    body: {
      name: `CRUD synced TLS ${suffix}`,
      enabled: true,
      source: "sync",
      domains: [syncHttpsHost],
      sync: { target: `https://peer.example.com/sync/${suffix}/receive` }
    },
    expectedStatus: 201
  });
  created.syncedCertificateId = certificate.id;
  if (certificate.status !== "pending" || certificate.certPath || certificate.keyPath) {
    throw new Error("New sync certificate should start pending without local PEM files.");
  }

  const { certPem, keyPem } = createTemporaryPemBundle(syncHttpsHost);
  const received = await apiJson(`/api/certificates/${certificate.id}/sync`, {
    method: "POST",
    body: {
      certPem,
      keyPem,
      domains: [syncHttpsHost]
    }
  });
  if (received.status !== "valid" || received.source !== "sync" || !received.certPath || !received.keyPath || !received.sync?.lastSyncTime) {
    throw new Error("Received sync certificate was not parsed into a valid local certificate bundle.");
  }
  if (!received.domains.includes(syncHttpsHost)) {
    throw new Error("Received sync certificate did not keep the expected SAN.");
  }
  await verifyGeneratedConfigIncludes(`/certs/${path.basename(received.certPath)}`, "synced certificate generated cert mount");
  await verifyGeneratedConfigIncludes(`/certs/${path.basename(received.keyPath)}`, "synced certificate generated key mount");

  const service = await createAndVerifyHttpsService(groupId, certificate.id, syncHttpsHost);
  created.syncedServiceId = service.id;
  await verifyCertificateBinding(certificate.id, service.id, "synced PEM certificate");
  await verifyBoundCertificateToggleProtection(certificate.id, "synced PEM certificate");
  await verifyBoundFileCertificateUpdateProtection(certificate.id, syncHttpsHost, "synced PEM certificate");
  await verifyBoundSyncedCertificateReceiveProtection(certificate.id, syncHttpsHost);
  console.log("[ok] Synced PEM certificate receive action binds to a verified HTTPS route.");
}

async function createAndVerifyUploadedCertificateRoute(groupId) {
  const { certPem, keyPem } = createTemporaryPemBundle(uploadedHttpsHost);
  const certificate = await apiJson("/api/certificates", {
    method: "POST",
    body: {
      name: `CRUD uploaded TLS ${suffix}`,
      enabled: true,
      source: "upload",
      domains: [uploadedHttpsHost],
      certPem,
      keyPem
    },
    expectedStatus: 201
  });
  created.uploadedCertificateId = certificate.id;

  if (certificate.source !== "upload" || certificate.status !== "valid" || !certificate.domains.includes(uploadedHttpsHost)) {
    throw new Error("Uploaded PEM certificate was not parsed as a valid certificate with the expected SAN.");
  }
  await downloadAndVerifyCertificate(certificate.id);

  const service = await createAndVerifyHttpsService(groupId, certificate.id, uploadedHttpsHost);
  created.uploadedServiceId = service.id;
  await verifyCertificateBinding(certificate.id, service.id, "uploaded PEM certificate");
  await verifyBoundCertificateToggleProtection(certificate.id, "uploaded PEM certificate");
  await verifyBoundFileCertificateUpdateProtection(certificate.id, uploadedHttpsHost, "uploaded PEM certificate");
  console.log("[ok] Uploaded PEM certificate binds to a verified HTTPS route.");
}

async function createAndVerifyPathCertificateRoute(groupId) {
  const { certPath, keyPath } = createTemporaryMountedCertificateFiles(pathHttpsHost);
  created.pathCertificateFiles = [certPath, keyPath];

  const certificate = await apiJson("/api/certificates", {
    method: "POST",
    body: {
      name: `CRUD path TLS ${suffix}`,
      enabled: true,
      source: "path",
      domains: [pathHttpsHost],
      certPath,
      keyPath
    },
    expectedStatus: 201
  });
  created.pathCertificateId = certificate.id;

  if (certificate.source !== "path" || certificate.status !== "valid" || !certificate.domains.includes(pathHttpsHost)) {
    throw new Error("Existing path certificate was not parsed as a valid certificate with the expected SAN.");
  }
  await verifyGeneratedConfigIncludes(`/certs/${path.basename(certPath)}`, "path certificate generated cert mount");
  await verifyGeneratedConfigIncludes(`/certs/${path.basename(keyPath)}`, "path certificate generated key mount");

  const service = await createAndVerifyHttpsService(groupId, certificate.id, pathHttpsHost);
  created.pathServiceId = service.id;
  await verifyCertificateBinding(certificate.id, service.id, "existing path certificate");
  await verifyBoundCertificateToggleProtection(certificate.id, "existing path certificate");
  await verifyBoundFileCertificateUpdateProtection(certificate.id, pathHttpsHost, "existing path certificate", { certPath, keyPath });
  console.log("[ok] Existing path certificate binds to a verified HTTPS route.");
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
  if (service.targetUrl !== "http://whoami:80") {
    throw new Error(`Bare backend host:port was not normalized for Traefik, got ${service.targetUrl}.`);
  }
  await waitForHttpRoute(originalHttpHost, "http");
  const body = await routeText(httpRouteUrl, originalHttpHost);
  assertIncludes(body, `Host: ${originalHttpHost}`, originalHttpHost);
  assertIncludes(body, "X-Forwarded-Proto: http", originalHttpHost);
  console.log("[ok] Web service create accepts a blank rule name and applies an HTTP Traefik route.");
  return service;
}

async function verifyDuplicateDomainProtection(groupId, host) {
  const duplicateResponse = await request(`${gateliteApiUrl}/api/web-services`, {
    method: "POST",
    body: JSON.stringify({
      name: `CRUD duplicate ${suffix}`,
      enabled: true,
      groupId,
      domains: [host],
      listenPort: 18080,
      entryPoints: ["web"],
      targetUrl: "whoami:80",
      middlewares: [],
      tls: { mode: "none" }
    }),
    headers: { "Content-Type": "application/json" }
  });
  if (duplicateResponse.status !== 400 || !duplicateResponse.body.includes("already used")) {
    throw new Error(`Duplicate enabled Web service domain should return HTTP 400, got ${duplicateResponse.status}: ${duplicateResponse.body.slice(0, 300)}`);
  }

  const disabledDuplicate = await apiJson("/api/web-services", {
    method: "POST",
    body: {
      name: `CRUD disabled duplicate ${suffix}`,
      enabled: false,
      groupId,
      domains: [host],
      listenPort: 18080,
      entryPoints: ["web"],
      targetUrl: "whoami:80",
      middlewares: [],
      tls: { mode: "none" },
      notes: "Disabled duplicate route created by verify:crud."
    },
    expectedStatus: 201
  });
  created.duplicateHttpServiceId = disabledDuplicate.id;

  const toggleResponse = await request(`${gateliteApiUrl}/api/web-services/${disabledDuplicate.id}/toggle`, {
    method: "PATCH",
    body: JSON.stringify({ enabled: true }),
    headers: { "Content-Type": "application/json" }
  });
  if (toggleResponse.status !== 400 || !toggleResponse.body.includes("already used")) {
    throw new Error(`Enabling a disabled duplicate Web service domain should return HTTP 400, got ${toggleResponse.status}: ${toggleResponse.body.slice(0, 300)}`);
  }

  await apiNoContent(`/api/web-services/${disabledDuplicate.id}`, "DELETE");
  created.duplicateHttpServiceId = "";
  await waitForHttpRoute(host, "http");
  console.log("[ok] Web service duplicate domain protection works on create and enable.");
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

async function createAndVerifyCustomHttpService(groupId) {
  const customRule = `Host(\`${customHttpHost}\`) && PathPrefix(\`/agent\`)`;
  const service = await apiJson("/api/web-services", {
    method: "POST",
    body: {
      name: `CRUD custom ${suffix}`,
      enabled: true,
      matchMode: "custom",
      customRule,
      groupId,
      domains: [customHttpHost],
      listenPort: 18080,
      entryPoints: ["web"],
      targetUrl: "http://whoami:80",
      passHostHeader: false,
      middlewares: [],
      tls: { mode: "none" },
      observability: { accessLogs: false, metrics: true, tracing: false },
      notes: "Temporary custom Traefik rule created by verify:crud."
    },
    expectedStatus: 201
  });
  if (service.matchMode !== "custom" || service.customRule !== customRule || service.passHostHeader !== false) {
    throw new Error("Custom Web service rule was not persisted.");
  }
  await waitForCustomHttpRoute(customHttpHost, customRule);
  await verifyGeneratedConfigIncludes(`gatelite-service-${service.id}:`, "custom Web service generated backend");
  await verifyGeneratedConfigIncludes("passHostHeader: false", "custom Web service passHostHeader=false");
  await verifyGeneratedConfigIncludes("accessLogs: false", "custom Web service router access log override");
  await verifyGeneratedConfigIncludes("metrics: true", "custom Web service router metrics override");
  await verifyGeneratedConfigIncludes("tracing: false", "custom Web service router tracing override");
  const body = await routeText(httpRouteUrl, customHttpHost, { path: "/agent/check" });
  assertIncludes(body, `Host: ${customHttpHost}`, customHttpHost);
  assertIncludes(body, "GET /agent/check HTTP/1.1", customHttpHost);
  console.log("[ok] Web service custom Traefik rule applies a Host plus PathPrefix route and writes passHostHeader=false.");
  return service;
}

async function createAndVerifyDefaultHttpService(groupId) {
  const service = await apiJson("/api/web-services", {
    method: "POST",
    body: {
      name: `CRUD default ${suffix}`,
      enabled: true,
      matchMode: "default",
      groupId,
      domains: [],
      listenPort: 18080,
      entryPoints: ["web"],
      targetUrl: "http://whoami:80",
      middlewares: [],
      tls: { mode: "none" },
      notes: "Temporary default fallback route created by verify:crud."
    },
    expectedStatus: 201
  });
  if (service.matchMode !== "default" || service.domains.length !== 0) {
    throw new Error("Default Web service rule was not persisted as a domainless fallback.");
  }
  await waitForDefaultRoute();
  const body = await routeText(httpRouteUrl, defaultFallbackHost);
  assertIncludes(body, `Host: ${defaultFallbackHost}`, defaultFallbackHost);
  assertIncludes(body, "X-Forwarded-Proto: http", defaultFallbackHost);
  console.log("[ok] Default Web service fallback catches unmatched HTTP hosts.");
  return service;
}

async function deleteAndVerifyDefaultHttpService(serviceId) {
  await apiNoContent(`/api/web-services/${serviceId}`, "DELETE");
  await waitForDefaultRouteUnavailable();
  console.log("[ok] Default Web service fallback is removed when deleted.");
}

async function createAndVerifyHttpsService(groupId, certificateId, host = httpsHost) {
  const service = await apiJson("/api/web-services", {
    method: "POST",
    body: {
      name: `CRUD HTTPS ${suffix}`,
      enabled: true,
      groupId,
      domains: [host],
      listenPort: 18443,
      entryPoints: ["websecure"],
      targetUrl: "http://whoami:80",
      middlewares: [],
      tls: { mode: "file-certificate", certificateId },
      notes: "Temporary HTTPS route created by verify:crud."
    },
    expectedStatus: 201
  });
  await waitForHttpRoute(host, "https");
  const body = await routeText(httpsRouteUrl, host, { allowSelfSigned: true });
  assertIncludes(body, `Host: ${host}`, host);
  assertIncludes(body, "X-Forwarded-Proto: https", host);
  console.log("[ok] Web service create applies an HTTPS/TLS Traefik route.");
  return service;
}

async function verifyCertificateBinding(certificateId, serviceId, label = "certificate") {
  const certificates = await apiJson("/api/certificates");
  const certificate = certificates.find((item) => item.id === certificateId);
  if (!certificate) {
    throw new Error("Created certificate disappeared from certificate list.");
  }
  if (!certificate.boundServices.some((service) => service.id === serviceId)) {
    throw new Error(`Certificate binding list does not include the ${label} Web service.`);
  }
  console.log(`[ok] Certificate binding list reflects the ${label} Web service.`);
}

async function createAndVerifyAcmeResolverBinding(groupId) {
  const certificate = await apiJson("/api/certificates", {
    method: "POST",
    body: {
      name: `CRUD ACME ${suffix}`,
      enabled: true,
      source: "acme",
      domains: [acmeHost],
      acme: {
        resolver: acmeResolver,
        email: `admin-${suffix}@example.com`,
        dnsProvider: "cloudflare"
      }
    },
    expectedStatus: 201
  });
  created.acmeCertificateId = certificate.id;

  const service = await apiJson("/api/web-services", {
    method: "POST",
    body: {
      name: `CRUD ACME route ${suffix}`,
      enabled: true,
      groupId,
      domains: [acmeHost],
      listenPort: 18443,
      entryPoints: ["websecure"],
      targetUrl: "http://whoami:80",
      middlewares: [],
      tls: { mode: "resolver", resolver: acmeResolver },
      notes: "Temporary ACME resolver route created by verify:crud."
    },
    expectedStatus: 201
  });
  created.acmeServiceId = service.id;

  await verifyCertificateBinding(certificate.id, service.id, "ACME resolver");
  await verifyGeneratedConfigIncludes(`certResolver: ${acmeResolver}`, "ACME resolver generated config");

  const deleteResponse = await request(`${gateliteApiUrl}/api/certificates/${certificate.id}`, { method: "DELETE" });
  if (deleteResponse.status !== 409) {
    throw new Error(`Deleting an ACME certificate bound by resolver should return 409, got HTTP ${deleteResponse.status}.`);
  }
  await verifyBoundCertificateToggleProtection(certificate.id, "ACME resolver certificate");
  await verifyBoundAcmeResolverUpdateProtection(certificate.id, acmeResolver);

  console.log("[ok] ACME resolver certificate binding, update protection, disable protection, and delete protection work.");
}

async function verifyBoundCertificateToggleProtection(certificateId, label = "certificate") {
  const response = await request(`${gateliteApiUrl}/api/certificates/${certificateId}/toggle`, {
    method: "PATCH",
    body: JSON.stringify({ enabled: false }),
    headers: { "Content-Type": "application/json" }
  });
  if (response.status !== 409 || !response.body.includes("bound")) {
    throw new Error(`Disabling a bound ${label} should return HTTP 409, got ${response.status}: ${response.body.slice(0, 300)}`);
  }

  const certificates = await apiJson("/api/certificates");
  const certificate = certificates.find((item) => item.id === certificateId);
  if (!certificate?.enabled) {
    throw new Error(`Bound ${label} should remain enabled after rejected disable toggle.`);
  }
  console.log(`[ok] Bound ${label} disable protection works.`);
}

async function verifyBoundFileCertificateUpdateProtection(certificateId, boundHost, label = "certificate", pathFiles) {
  await expectCertificateUpdateConflict(
    certificateId,
    { enabled: false },
    `Editing a bound ${label} to disabled should return HTTP 409`
  );
  await expectCertificateUpdateConflict(
    certificateId,
    { domains: [`wrong-${boundHost}`] },
    `Editing a bound ${label} SANs away from ${boundHost} should return HTTP 409`
  );

  if (pathFiles) {
    await expectCertificateUpdateConflict(
      certificateId,
      { certPath: pathFiles.certPath, keyPath: pathFiles.keyPath },
      `Replacing bound ${label} path files should return HTTP 409`
    );
  } else {
    const { certPem, keyPem } = createTemporaryPemBundle(`replace-${boundHost}`);
    await expectCertificateUpdateConflict(
      certificateId,
      { certPem, keyPem },
      `Replacing bound ${label} PEM files should return HTTP 409`
    );
  }

  const certificate = await readCertificate(certificateId);
  if (!certificate.enabled || !certificate.domains.includes(boundHost)) {
    throw new Error(`Rejected ${label} update should leave the bound certificate enabled and covering ${boundHost}.`);
  }
  console.log(`[ok] Bound ${label} edit protection keeps active routes covered.`);
}

async function verifyBoundAcmeResolverUpdateProtection(certificateId, resolver) {
  await expectCertificateUpdateConflict(
    certificateId,
    { acme: { resolver: `${resolver}-moved`, email: `moved-${suffix}@example.com`, dnsProvider: "cloudflare" } },
    "Editing a bound ACME resolver should return HTTP 409"
  );
  await expectCertificateUpdateConflict(
    certificateId,
    { source: "sync", domains: [acmeHost], sync: { target: "https://peer.example.com/sync" } },
    "Changing a bound ACME certificate source should return HTTP 409"
  );

  const certificate = await readCertificate(certificateId);
  if (certificate.source !== "acme" || certificate.acme?.resolver !== resolver) {
    throw new Error("Rejected ACME resolver update should preserve the bound resolver.");
  }
  console.log("[ok] Bound ACME resolver edit protection keeps resolver routes bound.");
}

async function verifyBoundSyncedCertificateReceiveProtection(certificateId, boundHost) {
  const replacementHost = `wrong-${boundHost}`;
  const { certPem, keyPem } = createTemporaryPemBundle(replacementHost);
  const response = await request(`${gateliteApiUrl}/api/certificates/${certificateId}/sync`, {
    method: "POST",
    body: JSON.stringify({
      certPem,
      keyPem,
      domains: [replacementHost]
    }),
    headers: { "Content-Type": "application/json" }
  });
  if (response.status !== 409 || !response.body.includes("covering")) {
    throw new Error(`Receiving a synced PEM that drops bound ${boundHost} should return HTTP 409, got ${response.status}: ${response.body.slice(0, 300)}`);
  }

  const certificate = await readCertificate(certificateId);
  if (!certificate.domains.includes(boundHost)) {
    throw new Error(`Rejected synced PEM receive should leave the bound certificate covering ${boundHost}.`);
  }
  await waitForHttpRoute(boundHost, "https");
  console.log("[ok] Bound synced PEM receive protection keeps the existing HTTPS route usable.");
}

async function expectCertificateUpdateConflict(certificateId, body, message) {
  const response = await request(`${gateliteApiUrl}/api/certificates/${certificateId}`, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" }
  });
  if (response.status !== 409 || (!response.body.includes("bound") && !response.body.includes("covering") && !response.body.includes("unbind"))) {
    throw new Error(`${message}, got ${response.status}: ${response.body.slice(0, 300)}`);
  }
}

async function readCertificate(certificateId) {
  const certificates = await apiJson("/api/certificates");
  const certificate = certificates.find((item) => item.id === certificateId);
  if (!certificate) {
    throw new Error(`Certificate ${certificateId} disappeared from certificate list.`);
  }
  return certificate;
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
  await apiNoContent(`/api/web-services/${created.acmeServiceId}`, "DELETE");
  created.acmeServiceId = "";
  await apiNoContent(`/api/certificates/${created.acmeCertificateId}`, "DELETE");
  created.acmeCertificateId = "";

  await apiNoContent(`/api/web-services/${created.syncedServiceId}`, "DELETE");
  created.syncedServiceId = "";
  await waitForRouteUnavailable(syncHttpsHost, "https");
  await apiNoContent(`/api/certificates/${created.syncedCertificateId}`, "DELETE");
  created.syncedCertificateId = "";

  await apiNoContent(`/api/web-services/${created.uploadedServiceId}`, "DELETE");
  created.uploadedServiceId = "";
  await waitForRouteUnavailable(uploadedHttpsHost, "https");
  await apiNoContent(`/api/certificates/${created.uploadedCertificateId}`, "DELETE");
  created.uploadedCertificateId = "";

  await apiNoContent(`/api/web-services/${created.pathServiceId}`, "DELETE");
  created.pathServiceId = "";
  await waitForRouteUnavailable(pathHttpsHost, "https");
  await apiNoContent(`/api/certificates/${created.pathCertificateId}`, "DELETE");
  created.pathCertificateId = "";
  removePathCertificateFiles();

  await apiNoContent(`/api/web-services/${created.httpsServiceId}`, "DELETE");
  created.httpsServiceId = "";
  await waitForRouteUnavailable(created.httpsHost || editedHttpsHost, "https");

  await apiNoContent(`/api/web-services/${created.httpServiceId}`, "DELETE");
  created.httpServiceId = "";
  await waitForRouteUnavailable(editedHttpHost, "http");

  await apiNoContent(`/api/web-services/${created.customServiceId}`, "DELETE");
  created.customServiceId = "";
  await waitForRouteUnavailable(customHttpHost, "http");

  await apiNoContent(`/api/certificates/${created.certificateId}`, "DELETE");
  created.certificateId = "";
  await apiJson(`/api/groups/${created.groupId}`, { method: "DELETE" });
  created.groupId = "";
  console.log("[ok] Web service, certificate, and group delete operations clean up temporary resources.");
}

async function cleanup() {
  await ignoreNotFound(async () => created.acmeServiceId && apiNoContent(`/api/web-services/${created.acmeServiceId}`, "DELETE"));
  await ignoreNotFound(async () => created.syncedServiceId && apiNoContent(`/api/web-services/${created.syncedServiceId}`, "DELETE"));
  await ignoreNotFound(async () => created.pathServiceId && apiNoContent(`/api/web-services/${created.pathServiceId}`, "DELETE"));
  await ignoreNotFound(async () => created.uploadedServiceId && apiNoContent(`/api/web-services/${created.uploadedServiceId}`, "DELETE"));
  await ignoreNotFound(async () => created.httpsServiceId && apiNoContent(`/api/web-services/${created.httpsServiceId}`, "DELETE"));
  await ignoreNotFound(async () => created.defaultServiceId && apiNoContent(`/api/web-services/${created.defaultServiceId}`, "DELETE"));
  await ignoreNotFound(async () => created.customServiceId && apiNoContent(`/api/web-services/${created.customServiceId}`, "DELETE"));
  await ignoreNotFound(async () => created.duplicateHttpServiceId && apiNoContent(`/api/web-services/${created.duplicateHttpServiceId}`, "DELETE"));
  await ignoreNotFound(async () => created.httpServiceId && apiNoContent(`/api/web-services/${created.httpServiceId}`, "DELETE"));
  await ignoreNotFound(async () => created.acmeCertificateId && apiNoContent(`/api/certificates/${created.acmeCertificateId}`, "DELETE"));
  await ignoreNotFound(async () => created.syncedCertificateId && apiNoContent(`/api/certificates/${created.syncedCertificateId}`, "DELETE"));
  await ignoreNotFound(async () => created.pathCertificateId && apiNoContent(`/api/certificates/${created.pathCertificateId}`, "DELETE"));
  await ignoreNotFound(async () => created.uploadedCertificateId && apiNoContent(`/api/certificates/${created.uploadedCertificateId}`, "DELETE"));
  await ignoreNotFound(async () => created.certificateId && apiNoContent(`/api/certificates/${created.certificateId}`, "DELETE"));
  await ignoreNotFound(async () => created.groupId && apiJson(`/api/groups/${created.groupId}`, { method: "DELETE" }));
  removePathCertificateFiles();
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

async function waitForCustomHttpRoute(host, expectedRule) {
  await retry(async () => {
    const routers = await requestJson(`${traefikApiUrl}/api/http/routers`);
    if (!routers.some((router) => router.rule === expectedRule && router.status === "enabled")) {
      throw new Error(`Custom HTTP router for ${host} is not enabled yet.`);
    }
    const body = await routeText(httpRouteUrl, host, { path: "/agent/check" });
    assertIncludes(body, `Host: ${host}`, host);
  }, `custom HTTP route ${host}`);
}

async function waitForDefaultRoute() {
  await retry(async () => {
    const routers = await requestJson(`${traefikApiUrl}/api/http/routers`);
    if (!routers.some((router) => isGateLiteDefaultRouter(router))) {
      throw new Error("Default fallback router is not enabled yet.");
    }
    const body = await routeText(httpRouteUrl, defaultFallbackHost);
    assertIncludes(body, `Host: ${defaultFallbackHost}`, defaultFallbackHost);
  }, `default fallback route ${defaultFallbackHost}`);
}

async function waitForDefaultRouteUnavailable() {
  await retry(async () => {
    const routers = await requestJson(`${traefikApiUrl}/api/http/routers`);
    if (routers.some((router) => isGateLiteDefaultRouter(router))) {
      throw new Error("Default fallback router is still enabled.");
    }
    await expectRouteFailure(httpRouteUrl, defaultFallbackHost);
  }, `default fallback route removal ${defaultFallbackHost}`);
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

async function verifyGeneratedConfigIncludes(fragment, label) {
  const response = await request(`${gateliteApiUrl}/api/generated-config`);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`generated config request returned HTTP ${response.status}: ${response.body.slice(0, 300)}`);
  }
  assertIncludes(response.body, fragment, label);
}

async function routeText(url, host, options = {}) {
  const targetUrl = withRequestPath(url, options.path);
  const response = await request(targetUrl, {
    headers: { Host: host },
    allowSelfSigned: options.allowSelfSigned
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${url} (${host}) returned HTTP ${response.status}: ${response.body.slice(0, 300)}`);
  }
  return response.body;
}

async function expectRouteFailure(url, host, options = {}) {
  const targetUrl = withRequestPath(url, options.path);
  const response = await request(targetUrl, {
    headers: { Host: host },
    allowSelfSigned: options.allowSelfSigned
  });
  if (response.status !== 404) {
    throw new Error(`${url} (${host}) should be unavailable with 404, got HTTP ${response.status}.`);
  }
}

function withRequestPath(url, requestPath) {
  if (!requestPath) return url;
  const target = new URL(url);
  target.pathname = requestPath;
  return target.toString();
}

function isGateLiteDefaultRouter(router) {
  return router.name?.startsWith("gatelite-") && router.rule === "PathPrefix(`/`)" && router.status === "enabled";
}

function createTemporaryPemBundle(host) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gatelite-upload-"));
  const certPath = path.join(dir, "uploaded.crt");
  const keyPath = path.join(dir, "uploaded.key");
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-sha256",
        "-nodes",
        "-days",
        "90",
        "-subj",
        `/CN=${host}`,
        "-addext",
        `subjectAltName=DNS:${host}`,
        "-keyout",
        keyPath,
        "-out",
        certPath
      ],
      { stdio: "ignore" }
    );
    return {
      certPem: fs.readFileSync(certPath, "utf8"),
      keyPem: fs.readFileSync(keyPath, "utf8")
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function createTemporaryMountedCertificateFiles(host) {
  fs.mkdirSync(mountedCertDir, { recursive: true });
  const safeSuffix = suffix.replace(/[^a-z0-9-]/gi, "-");
  const certPath = path.join(mountedCertDir, `crud-path-${safeSuffix}.crt`);
  const keyPath = path.join(mountedCertDir, `crud-path-${safeSuffix}.key`);
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-nodes",
      "-days",
      "90",
      "-subj",
      `/CN=${host}`,
      "-addext",
      `subjectAltName=DNS:${host}`,
      "-keyout",
      keyPath,
      "-out",
      certPath
    ],
    { stdio: "ignore" }
  );
  fs.chmodSync(keyPath, 0o600);
  return { certPath, keyPath };
}

function removePathCertificateFiles() {
  for (const file of created.pathCertificateFiles) {
    if (file) {
      fs.rmSync(file, { force: true });
    }
  }
  created.pathCertificateFiles = [];
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
