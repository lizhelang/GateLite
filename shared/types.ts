export type TlsMode = "none" | "file-certificate" | "resolver";
export type WebServiceMatchMode = "host" | "custom" | "default";
export type CertificateSource = "self-signed" | "upload" | "path" | "acme" | "sync";
export type CertificateStatus = "valid" | "expiring" | "expired" | "pending" | "invalid";
export type RuntimeStatus = "online" | "offline" | "warning" | "unknown";
export type RuntimeProtocol = "http" | "tcp" | "udp";
export type WebServiceManagementMode = "generated" | "mapped";

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

export interface WebServiceObservability {
  accessLogs?: boolean;
  metrics?: boolean;
  tracing?: boolean;
}

export interface WebService {
  id: string;
  name: string;
  enabled: boolean;
  managementMode?: WebServiceManagementMode;
  sourceRouterName?: string;
  sourceProvider?: string;
  sourceServiceName?: string;
  importedAt?: string;
  matchMode?: WebServiceMatchMode;
  groupId: string;
  domains: string[];
  domainRoot?: string;
  customRule?: string;
  listenPort: number;
  entryPoints: string[];
  targetUrl: string;
  passHostHeader?: boolean;
  middlewares: string[];
  priority?: number;
  tls: WebServiceTls;
  observability?: WebServiceObservability;
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
    rollbackId?: string;
  }>;
}

export interface GateLiteHistoryEvent {
  id: string;
  at: string;
  action: string;
  summary: string;
  rollbackId?: string;
  rollbackAvailable: boolean;
}

export interface ConfigDiffLine {
  type: "context" | "added" | "removed";
  line: string;
}

export interface WebServicePreview {
  valid: true;
  action: "create" | "update";
  service: WebService;
  currentYaml: string;
  nextYaml: string;
  diff: ConfigDiffLine[];
}

export interface DiscoveredRouteBackend {
  serviceName?: string;
  provider?: string;
  status?: RuntimeStatus;
  servers: string[];
  targetUrl?: string;
}

export interface DiscoveredRoute {
  id: string;
  routerName: string;
  protocol: RuntimeProtocol;
  provider?: string;
  rule?: string;
  domains: string[];
  serviceName?: string;
  entryPoints: string[];
  middlewares: string[];
  tls: boolean;
  tlsResolver?: string;
  tlsOptions?: string;
  status: RuntimeStatus;
  backend: DiscoveredRouteBackend;
  managedServiceId?: string;
  managedMode: "generated" | "mapped" | "unmanaged";
  importable: boolean;
  importWarnings: string[];
  traffic?: WebServiceTrafficStats;
}

export interface RuntimeTlsBinding {
  id: string;
  routerName: string;
  provider?: string;
  domains: string[];
  tlsResolver?: string;
  tlsOptions?: string;
  status: RuntimeStatus;
  managedCertificateId?: string;
  managedServiceId?: string;
  importable: boolean;
  importWarnings: string[];
}

export interface ImportRoutePreview {
  valid: true;
  action: "map";
  route: DiscoveredRoute;
  service: WebService;
  currentYaml: string;
  nextYaml: string;
  diff: ConfigDiffLine[];
  warnings: string[];
}

export interface ImportRoutesResult {
  created: WebService[];
  skipped: Array<{
    routerName: string;
    reason: string;
  }>;
}

export interface CertificatePreview {
  valid: true;
  action: "create" | "update";
  certificate: CertificateItem;
  currentYaml: string;
  nextYaml: string;
  diff: ConfigDiffLine[];
}

export interface RuntimeRouter {
  name: string;
  protocol: RuntimeProtocol;
  provider?: string;
  rule?: string;
  service?: string;
  entryPoints: string[];
  middlewares: string[];
  domains: string[];
  tls: boolean;
  tlsResolver?: string;
  tlsOptions?: string;
  tlsPassthrough?: boolean;
  status: RuntimeStatus;
  error?: string;
}

export interface RuntimeService {
  name: string;
  protocol: RuntimeProtocol;
  provider?: string;
  status: RuntimeStatus;
  servers: string[];
  error?: string;
}

export interface RuntimeMiddleware {
  name: string;
  protocol: Exclude<RuntimeProtocol, "udp">;
  provider?: string;
  type?: string;
  status: RuntimeStatus;
  usedBy: string[];
  error?: string;
}

export interface RuntimeTlsItem {
  name: string;
  provider?: string;
  domains: string[];
  detail?: string;
  source: "traefik-api" | "router";
  status: RuntimeStatus;
}

export interface RuntimeTlsSummary {
  routers: RuntimeRouter[];
  certificates: RuntimeTlsItem[];
  options: RuntimeTlsItem[];
  stores: RuntimeTlsItem[];
  resolvers: RuntimeTlsItem[];
  available: boolean;
}

export interface TraefikRuntime {
  connected: boolean;
  apiUrl: string;
  version?: string;
  overview?: unknown;
  entryPoints: unknown[];
  routers: RuntimeRouter[];
  services: RuntimeService[];
  middlewares: RuntimeMiddleware[];
  tls: RuntimeTlsSummary;
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
  requestBytesPerSecond: number;
  responseBytesPerSecond: number;
  openConnections: number;
  openConnectionsScope: "service" | "entrypoint" | "unavailable";
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
  discoveredRoutes: DiscoveredRoute[];
  runtimeTlsBindings: RuntimeTlsBinding[];
  traffic: TrafficOverview;
  history: GateLiteHistoryEvent[];
}
