import { readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";

const traefikApiUrl = process.env.TRAEFIK_API_URL || "http://localhost:18081";
const gateliteApiUrl = process.env.GATELITE_API_URL || "http://localhost:3001";
const dynamicFile = process.env.GATELITE_DYNAMIC_FILE || "runtime/traefik/gatelite.yml";
const httpRouteUrl = process.env.GATELITE_VERIFY_HTTP_URL || "http://127.0.0.1:18080";
const httpsRouteUrl = process.env.GATELITE_VERIFY_HTTPS_URL || "https://127.0.0.1:18443";
const httpHost = process.env.GATELITE_VERIFY_HTTP_HOST || "whoami.localhost";
const httpsHost = process.env.GATELITE_VERIFY_HTTPS_HOST || "secure.localhost";

const checks = [
  verifyTraefikApi,
  verifyGateLiteApi,
  verifyGeneratedConfig,
  verifyHttpRoute,
  verifyHttpsRoute
];

try {
  for (const check of checks) {
    await check();
  }
  console.log("[ok] Local Traefik verification passed.");
} catch (error) {
  console.error(`[fail] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

async function verifyTraefikApi() {
  const version = await requestJson(`${traefikApiUrl}/api/version`);
  const routers = await requestJson(`${traefikApiUrl}/api/http/routers`);
  const versionText = readString(version, "Version") || readString(version, "version");
  if (!versionText) {
    throw new Error(`Traefik API at ${traefikApiUrl} did not return a version.`);
  }
  if (!Array.isArray(routers) || routers.length === 0) {
    throw new Error("Traefik API returned no HTTP routers.");
  }
  console.log(`[ok] Traefik API connected: ${versionText}, ${routers.length} HTTP routers.`);
}

async function verifyGateLiteApi() {
  const dashboard = await requestJson(`${gateliteApiUrl}/api/dashboard`);
  const connected = Boolean(dashboard?.runtime?.connected);
  const services = Array.isArray(dashboard?.webServices) ? dashboard.webServices.length : 0;
  const certificates = Array.isArray(dashboard?.certificates) ? dashboard.certificates.length : 0;
  if (!connected) {
    throw new Error(`GateLite API at ${gateliteApiUrl} is not connected to Traefik.`);
  }
  if (services < 2) {
    throw new Error(`Expected at least 2 GateLite Web services, found ${services}.`);
  }
  if (certificates < 1) {
    throw new Error(`Expected at least 1 GateLite certificate, found ${certificates}.`);
  }
  const routerProtocols = new Set((dashboard?.runtime?.routers || []).map((router) => router.protocol).filter(Boolean));
  const serviceProtocols = new Set((dashboard?.runtime?.services || []).map((service) => service.protocol).filter(Boolean));
  if (!routerProtocols.has("http") || !serviceProtocols.has("http")) {
    throw new Error("GateLite runtime payload should expose protocol fields for Traefik routers and services.");
  }
  if (!Array.isArray(dashboard?.runtime?.middlewares)) {
    throw new Error("GateLite runtime payload should expose normalized HTTP/TCP middlewares.");
  }
  if (!dashboard?.runtime?.tls || !Array.isArray(dashboard.runtime.tls.routers)) {
    throw new Error("GateLite runtime payload should expose a TLS runtime summary.");
  }
  if (!dashboard.runtime.tls.routers.some((router) => router.tls === true)) {
    throw new Error("Expected at least one TLS router in the GateLite runtime TLS summary.");
  }
  console.log(`[ok] GateLite API connected: ${services} services, ${certificates} certificates.`);
}

async function verifyGeneratedConfig() {
  const yaml = await readFile(dynamicFile, "utf8");
  assertIncludes(yaml, httpHost, dynamicFile);
  assertIncludes(yaml, httpsHost, dynamicFile);
  assertIncludes(yaml, "certFile:", dynamicFile);
  assertIncludes(yaml, "keyFile:", dynamicFile);
  console.log(`[ok] Generated dynamic config includes ${httpHost}, ${httpsHost}, and TLS file references.`);
}

async function verifyHttpRoute() {
  const body = await requestText(httpRouteUrl, { Host: httpHost });
  assertIncludes(body, "Hostname:", `${httpRouteUrl} (${httpHost})`);
  assertIncludes(body, `Host: ${httpHost}`, `${httpRouteUrl} (${httpHost})`);
  assertIncludes(body, "X-Forwarded-Proto: http", `${httpRouteUrl} (${httpHost})`);
  console.log(`[ok] HTTP route ${httpHost} reaches whoami through Traefik.`);
}

async function verifyHttpsRoute() {
  const body = await requestText(httpsRouteUrl, { Host: httpsHost }, { allowSelfSigned: true });
  assertIncludes(body, "Hostname:", `${httpsRouteUrl} (${httpsHost})`);
  assertIncludes(body, `Host: ${httpsHost}`, `${httpsRouteUrl} (${httpsHost})`);
  assertIncludes(body, "X-Forwarded-Proto: https", `${httpsRouteUrl} (${httpsHost})`);
  console.log(`[ok] HTTPS route ${httpsHost} reaches whoami through Traefik.`);
}

async function requestJson(url) {
  const text = await requestText(url);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Expected JSON from ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requestText(url, headers = {}, options = {}) {
  const target = new URL(url);
  const transport = target.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.request(
      target,
      {
        method: "GET",
        headers,
        timeout: 5000,
        rejectUnauthorized: options.allowSelfSigned ? false : undefined
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`${url} returned HTTP ${response.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          resolve(body);
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error(`${url} timed out after 5000ms.`));
    });
    request.on("error", reject);
    request.end();
  });
}

function readString(value, key) {
  if (value && typeof value === "object" && key in value) {
    return String(value[key]);
  }
  return "";
}

function assertIncludes(value, expected, source) {
  if (!value.includes(expected)) {
    throw new Error(`Expected ${source} to include "${expected}".`);
  }
}
