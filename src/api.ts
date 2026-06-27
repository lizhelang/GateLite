import type {
  ApplyResponse,
  CertificatePreview,
  CertificateWithBindings,
  AcmeStatus,
  DashboardPayload,
  DnsStatus,
  HealthPayload,
  ImportRoutePreview,
  ImportRoutesResult,
  GateLiteHistoryEvent,
  ServiceGroup,
  TraefikRuntime,
  WebService,
  WebServicePreview,
  WebServiceWithRuntime
} from "../shared/types";
import { getAuthHeader } from "./auth";

export type WebServiceInput = Omit<WebService, "id" | "order" | "createdAt" | "updatedAt">;
export type CertificateInput = {
  name: string;
  enabled: boolean;
  source: "self-signed" | "upload" | "path" | "acme" | "sync";
  domains: string[];
  certPem?: string;
  keyPem?: string;
  certPath?: string;
  keyPath?: string;
  days?: number;
  acme?: {
    email?: string;
    caServer?: string;
    dnsProvider?: string;
    resolver?: string;
  };
  sync?: {
    target?: string;
    lastSyncTime?: string;
  };
};

export type CertificateSyncInput = {
  certPem: string;
  keyPem: string;
  domains?: string[];
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export async function getHealth(): Promise<HealthPayload> {
  return request<HealthPayload>("/api/health", {
    auth: false
  });
}

export async function getDashboard(): Promise<DashboardPayload> {
  return request<DashboardPayload>("/api/dashboard");
}

export async function getRuntime(): Promise<TraefikRuntime> {
  return request<TraefikRuntime>("/api/traefik/runtime");
}

export async function getAcmeStatus(): Promise<AcmeStatus> {
  return request<AcmeStatus>("/api/acme/status");
}

export async function getDnsStatus(): Promise<DnsStatus> {
  return request<DnsStatus>("/api/dns/status");
}

export async function syncDnsNow(): Promise<DnsStatus> {
  return request<DnsStatus>("/api/dns/sync", {
    method: "POST"
  });
}

export async function getGeneratedConfig(): Promise<string> {
  const response = await fetch("/api/generated-config", {
    headers: requestHeaders()
  });
  if (!response.ok) {
    throw new Error(`Generated config request failed with ${response.status}`);
  }
  return response.text();
}

export async function getHistory(): Promise<GateLiteHistoryEvent[]> {
  return request<GateLiteHistoryEvent[]>("/api/history");
}

export async function rollbackHistoryEvent(id: string): Promise<DashboardPayload> {
  return requestApply<DashboardPayload>(`/api/history/${id}/rollback`, {
    method: "POST"
  });
}

export async function createWebService(input: WebServiceInput): Promise<WebServiceWithRuntime> {
  return requestApply<WebServiceWithRuntime>("/api/web-services", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function previewCreateWebService(input: WebServiceInput): Promise<WebServicePreview> {
  return request<WebServicePreview>("/api/web-services/preview", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateWebService(id: string, input: WebServiceInput): Promise<WebServiceWithRuntime> {
  return requestApply<WebServiceWithRuntime>(`/api/web-services/${id}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function previewUpdateWebService(id: string, input: WebServiceInput): Promise<WebServicePreview> {
  return request<WebServicePreview>(`/api/web-services/${id}/preview`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function previewDeleteWebService(id: string): Promise<WebServicePreview> {
  return request<WebServicePreview>(`/api/web-services/${id}/delete-preview`, {
    method: "POST"
  });
}

export async function toggleWebService(id: string, enabled: boolean): Promise<WebServiceWithRuntime> {
  return requestApply<WebServiceWithRuntime>(`/api/web-services/${id}/toggle`, {
    method: "PATCH",
    body: JSON.stringify({ enabled })
  });
}

export async function deleteWebService(id: string): Promise<void> {
  await requestApply(`/api/web-services/${id}`, { method: "DELETE" });
}

export async function reorderWebServices(orderedIds: string[]): Promise<WebService[]> {
  return requestApply<WebService[]>("/api/web-services/reorder", {
    method: "POST",
    body: JSON.stringify({ orderedIds })
  });
}

export async function previewImportDiscoveredRoute(routerName: string, groupId?: string): Promise<ImportRoutePreview> {
  return request<ImportRoutePreview>("/api/discovered-routes/import-preview", {
    method: "POST",
    body: JSON.stringify({ routerName, groupId })
  });
}

export async function importDiscoveredRoute(routerName: string, groupId?: string): Promise<WebServiceWithRuntime> {
  return requestApply<WebServiceWithRuntime>("/api/discovered-routes/import", {
    method: "POST",
    body: JSON.stringify({ routerName, groupId })
  });
}

export async function importAllDiscoveredRoutes(): Promise<ImportRoutesResult> {
  return requestApply<ImportRoutesResult>("/api/discovered-routes/import-all", {
    method: "POST"
  });
}

export async function createGroup(name: string): Promise<ServiceGroup> {
  return requestApply<ServiceGroup>("/api/groups", {
    method: "POST",
    body: JSON.stringify({ name, collapsed: false })
  });
}

export async function updateGroup(id: string, input: Partial<ServiceGroup>): Promise<ServiceGroup> {
  return requestApply<ServiceGroup>(`/api/groups/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function deleteGroup(id: string): Promise<ServiceGroup[]> {
  return requestApply<ServiceGroup[]>(`/api/groups/${id}`, { method: "DELETE" });
}

export async function reorderGroups(orderedIds: string[]): Promise<ServiceGroup[]> {
  return requestApply<ServiceGroup[]>("/api/groups/reorder", {
    method: "POST",
    body: JSON.stringify({ orderedIds })
  });
}

export async function createCertificate(input: CertificateInput): Promise<CertificateWithBindings> {
  return requestApply<CertificateWithBindings>("/api/certificates", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function previewCreateCertificate(input: CertificateInput): Promise<CertificatePreview> {
  return request<CertificatePreview>("/api/certificates/preview", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateCertificate(id: string, input: Partial<CertificateInput>): Promise<CertificateWithBindings> {
  return requestApply<CertificateWithBindings>(`/api/certificates/${id}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function previewUpdateCertificate(id: string, input: Partial<CertificateInput>): Promise<CertificatePreview> {
  return request<CertificatePreview>(`/api/certificates/${id}/preview`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function toggleCertificate(id: string, enabled: boolean): Promise<CertificateWithBindings> {
  return requestApply<CertificateWithBindings>(`/api/certificates/${id}/toggle`, {
    method: "PATCH",
    body: JSON.stringify({ enabled })
  });
}

export async function refreshCertificate(id: string): Promise<CertificateWithBindings> {
  return requestApply<CertificateWithBindings>(`/api/certificates/${id}/refresh`, {
    method: "PATCH"
  });
}

export async function receiveCertificateSync(id: string, input: CertificateSyncInput): Promise<CertificateWithBindings> {
  return requestApply<CertificateWithBindings>(`/api/certificates/${id}/sync`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function reorderCertificates(orderedIds: string[]): Promise<CertificateWithBindings[]> {
  return requestApply<CertificateWithBindings[]>("/api/certificates/reorder", {
    method: "POST",
    body: JSON.stringify({ orderedIds })
  });
}

export async function deleteCertificate(id: string, options: { cleanupFiles?: boolean } = {}): Promise<void> {
  const query = options.cleanupFiles ? "?cleanupFiles=true" : "";
  await requestApply(`/api/certificates/${id}${query}`, { method: "DELETE" });
}

async function requestApply<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
  const response = await request<ApplyResponse<T>>(path, init);
  return response.data;
}

async function request<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  let response: Response;
  const { auth, ...requestInit } = init;

  try {
    response = await fetch(path, {
      ...requestInit,
      signal: controller.signal,
      headers: requestHeaders(requestInit.headers, auth !== false)
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out. Please refresh and try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const body = text ? parseResponseBody(text) : undefined;
  if (!response.ok) {
    const message = body?.error || body?.message || `Request failed with ${response.status}`;
    throw new ApiError(message, response.status);
  }
  return body as T;
}

function requestHeaders(initHeaders?: HeadersInit, includeAuth = true): Headers {
  const headers = new Headers(initHeaders);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("X-GateLite-Client", "web");

  const authorization = includeAuth ? getAuthHeader() : undefined;
  if (authorization && !headers.has("Authorization")) headers.set("Authorization", authorization);

  return headers;
}

function parseResponseBody(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}
