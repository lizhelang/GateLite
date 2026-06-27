import http from "node:http";
import https from "node:https";

try {
  const urls = readUrls();
  const authHeader = readBasicAuthHeader();
  for (const baseUrl of urls) {
    await verifyUrl(baseUrl, authHeader);
  }
  console.log("[ok] GateLite public-domain verification passed.");
} catch (error) {
  console.error(`[fail] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

function readUrls() {
  const configured = process.env.GATELITE_PUBLIC_URLS;
  if (!configured) {
    throw new Error("Set GATELITE_PUBLIC_URLS to one or more deployed GateLite URLs before running verify:domains.");
  }
  return configured
    .split(",")
    .map((url) => url.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

async function verifyUrl(baseUrl, authHeader) {
  const health = await requestJson(`${baseUrl}/api/health`);
  if (health?.ok !== true) throw new Error(`${baseUrl}/api/health did not return ok=true.`);
  if (health?.auth?.enabled !== false && health?.auth?.enabled !== true) {
    throw new Error(`${baseUrl}/api/health did not expose auth.enabled.`);
  }

  const root = await requestText(baseUrl, authHeader);
  if (!root.includes("<title>GateLite</title>")) throw new Error(`${baseUrl}/ did not return the GateLite HTML shell.`);
  console.log(`[ok] ${baseUrl} serves GateLite and health is reachable.`);
}

async function requestJson(url) {
  const body = await requestText(url);
  return JSON.parse(body);
}

function requestText(url, authHeader) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("http://") ? http : https;
    const request = client.get(url, { timeout: 8000, headers: authHeader ? { Authorization: authHeader } : undefined }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`${url} returned HTTP ${response.statusCode}: ${body.slice(0, 160)}`));
          return;
        }
        resolve(body);
      });
    });
    request.on("timeout", () => request.destroy(new Error(`${url} timed out after 8000ms.`)));
    request.on("error", reject);
  });
}

function readBasicAuthHeader() {
  const username = process.env.GATELITE_VERIFY_AUTH_USERNAME;
  const password = process.env.GATELITE_VERIFY_AUTH_PASSWORD;
  if (!username || !password) return undefined;
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}
