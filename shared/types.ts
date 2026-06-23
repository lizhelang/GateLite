export type TlsMode = "none" | "file-certificate" | "resolver";
export type CertificateSource = "self-signed" | "upload" | "path" | "acme" | "sync";
export type CertificateStatus = "valid" | "expiring" | "expired" | "pending" | "invalid";
export type RuntimeStatus = "online" | "offline" | "warning" | "unknown";

export interface ServiceGroup {
  id: string;
  name: string;
  collapsed?: boolean;
  order: number;
}

export interface WebServiceTls {
  mode: TlsMode;
  certificateId?: string;
  resolver?: string;
}

export interface WebService {
  id: string;
  name: string;
  enabled: boolean;
  groupId: string;
  domains: string[];
  listenPort: number;
  entryPoints: string[];
  targetUrl: string;
  middlewares: string[];
  priority?: number;
  tls: WebServiceTls;
  order: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CertificateItem {
  id: string;
  name: string;
  enabled: boolean;
  source: CertificateSource;
  domains: string[];
  certPath?: string;
  keyPath?: string;
  mappingPath?: string;
  notBefore?: string;
  notAfter?: string;
  issuer?: string;
  subject?: string;
  status: CertificateStatus;
  statusMessage?: string;
  order: number;
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
  createdAt: string;
  updatedAt: string;
}

export interface GateLiteState {
  version: 1;
  groups: ServiceGroup[];
  webServices: WebService[];
  certificates: CertificateItem[];
  history: Array<{
    id: string;
    at: string;
    action: string;
    summary: string;
  }>;
}

export interface RuntimeRouter {
  name: string;
  provider?: string;
  rule?: string;
  service?: string;
  entryPoints: string[];
  middlewares: string[];
  domains: string[];
  tls: boolean;
  status: RuntimeStatus;
  error?: string;
}

export interface RuntimeService {
  name: string;
  provider?: string;
  status: RuntimeStatus;
  servers: string[];
  error?: string;
}

export interface TraefikRuntime {
  connected: boolean;
  apiUrl: string;
  version?: string;
  overview?: unknown;
  entryPoints: unknown[];
  routers: RuntimeRouter[];
  services: RuntimeService[];
  middlewares: unknown[];
  rawData?: unknown;
  error?: string;
}

export interface DomainTrafficSeries {
  domain: string;
  router: string;
  provider?: string;
  source: "prometheus" | "preview";
  totalRequests: number;
  points: Array<{
    at: string;
    value: number;
  }>;
}

export interface TrafficOverview {
  connected: boolean;
  source: "prometheus" | "unavailable";
  updatedAt: string;
  series: DomainTrafficSeries[];
  error?: string;
}

export interface WebServiceTrafficStats {
  source: "prometheus" | "unavailable";
  updatedAt: string;
  totalRequests: number;
  requestBytes: number;
  responseBytes: number;
  openConnections: number;
}

export interface WebServiceWithRuntime extends WebService {
  runtime?: RuntimeRouter;
  groupName?: string;
  traffic?: WebServiceTrafficStats;
}

export interface CertificateWithBindings extends CertificateItem {
  boundServices: WebService[];
}

export interface DashboardPayload {
  runtime: TraefikRuntime;
  groups: ServiceGroup[];
  webServices: WebServiceWithRuntime[];
  certificates: CertificateWithBindings[];
  traffic: TrafficOverview;
}
