import type {
  CertificateWithBindings,
  DashboardPayload,
  ServiceGroup,
  TraefikRuntime,
  WebService,
  WebServiceWithRuntime
} from "../shared/types";

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
};

export async function getDashboard(): Promise<DashboardPayload> {
  return request<DashboardPayload>("/api/dashboard");
}

export async function getRuntime(): Promise<TraefikRuntime> {
  return request<TraefikRuntime>("/api/traefik/runtime");
}

export async function getGeneratedConfig(): Promise<string> {
  const response = await fetch("/api/generated-config");
  if (!response.ok) {
    throw new Error(`Generated config request failed with ${response.status}`);
  }
  return response.text();
}

export async function createWebService(input: WebServiceInput): Promise<WebServiceWithRuntime> {
  return request<WebServiceWithRuntime>("/api/web-services", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateWebService(id: string, input: WebServiceInput): Promise<WebServiceWithRuntime> {
  return request<WebServiceWithRuntime>(`/api/web-services/${id}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function toggleWebService(id: string, enabled: boolean): Promise<WebServiceWithRuntime> {
  return request<WebServiceWithRuntime>(`/api/web-services/${id}/toggle`, {
    method: "PATCH",
    body: JSON.stringify({ enabled })
  });
}

export async function deleteWebService(id: string): Promise<void> {
  await request<void>(`/api/web-services/${id}`, { method: "DELETE" });
}

export async function reorderWebServices(orderedIds: string[]): Promise<WebService[]> {
  return request<WebService[]>("/api/web-services/reorder", {
    method: "POST",
    body: JSON.stringify({ orderedIds })
  });
}

export async function createGroup(name: string): Promise<ServiceGroup> {
  return request<ServiceGroup>("/api/groups", {
    method: "POST",
    body: JSON.stringify({ name, collapsed: false })
  });
}

export async function updateGroup(id: string, input: Partial<ServiceGroup>): Promise<ServiceGroup> {
  return request<ServiceGroup>(`/api/groups/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function deleteGroup(id: string): Promise<ServiceGroup[]> {
  return request<ServiceGroup[]>(`/api/groups/${id}`, { method: "DELETE" });
}

export async function createCertificate(input: CertificateInput): Promise<CertificateWithBindings> {
  return request<CertificateWithBindings>("/api/certificates", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateCertificate(id: string, input: Partial<CertificateInput>): Promise<CertificateWithBindings> {
  return request<CertificateWithBindings>(`/api/certificates/${id}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function deleteCertificate(id: string): Promise<void> {
  await request<void>(`/api/certificates/${id}`, { method: "DELETE" });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const message = body?.error || body?.message || `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}
