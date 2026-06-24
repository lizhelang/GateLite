import type {
  CertificateItem,
  DiscoveredRoute,
  GateLiteState,
  RuntimeRouter,
  RuntimeService,
  RuntimeTlsBinding,
  TraefikRuntime,
  WebService,
  WebServiceTrafficStats
} from "../shared/types";
import { certificateCoversDomain, resolverName } from "./bindings";
import { traefikName } from "./ids";

const fallbackGroupName = "Imported Traefik";

export function buildDiscoveredRoutes(
  runtime: TraefikRuntime,
  state: GateLiteState,
  trafficByServiceId: Map<string, WebServiceTrafficStats> = new Map()
): DiscoveredRoute[] {
  const managedByRouterName = managedServicesByRouterName(state.webServices);
  const services = runtime.services;

  return runtime.routers
    .filter((router) => router.protocol === "http")
    .map((router) => {
      const backend = runtimeBackendForRouter(router, services);
      const managed = managedByRouterName.get(router.name) || managedByRouterName.get(router.name.replace(/@[a-z0-9_-]+$/i, ""));
      const warnings = routeImportWarnings(router, backend.targetUrl);
      const managedMode: DiscoveredRoute["managedMode"] = managed ? managed.managementMode || "generated" : "unmanaged";
      const trafficId = managed?.id || discoveredTrafficServiceId(router);

      return {
        id: router.name,
        routerName: router.name,
        protocol: router.protocol,
        provider: router.provider,
        rule: router.rule,
        domains: router.domains,
        serviceName: router.service,
        entryPoints: router.entryPoints,
        middlewares: router.middlewares,
        tls: router.tls,
        tlsResolver: router.tlsResolver,
        tlsOptions: router.tlsOptions,
        status: router.status,
        backend,
        managedServiceId: managed?.id,
        managedMode,
        importable: !managed && warnings.length === 0,
        importWarnings: managed ? ["This Traefik router is already mapped in GateLite."] : warnings,
        traffic: trafficByServiceId.get(trafficId)
      };
    })
    .sort((a, b) => a.domains[0]?.localeCompare(b.domains[0] || "") || a.routerName.localeCompare(b.routerName));
}

export function buildRuntimeTlsBindings(
  runtime: TraefikRuntime,
  state: GateLiteState,
  discoveredRoutes: DiscoveredRoute[]
): RuntimeTlsBinding[] {
  const routesByName = new Map(discoveredRoutes.map((route) => [route.routerName, route]));
  return runtime.tls.routers
    .map((router) => {
      const route = routesByName.get(router.name);
      const managedCertificate = managedCertificateForTlsRouter(router, state.certificates);
      const warnings = tlsImportWarnings(router);

      return {
        id: router.name,
        routerName: router.name,
        provider: router.provider,
        domains: router.domains,
        tlsResolver: router.tlsResolver,
        tlsOptions: router.tlsOptions,
        status: router.status,
        managedServiceId: route?.managedServiceId,
        managedCertificateId: managedCertificate?.id,
        importable: !managedCertificate && warnings.length === 0,
        importWarnings: managedCertificate ? ["This TLS binding is already represented by a GateLite certificate."] : warnings
      };
    })
    .sort((a, b) => a.domains[0]?.localeCompare(b.domains[0] || "") || a.routerName.localeCompare(b.routerName));
}

export function transientServicesForUnmanagedRoutes(runtime: TraefikRuntime, state: GateLiteState): WebService[] {
  const managedByRouterName = managedServicesByRouterName(state.webServices);
  return runtime.routers
    .filter((router) => router.protocol === "http")
    .filter((router) => !managedByRouterName.has(router.name) && !managedByRouterName.has(router.name.replace(/@[a-z0-9_-]+$/i, "")))
    .map((router, index) => {
      const backend = runtimeBackendForRouter(router, runtime.services);
      return transientServiceForRoute(router, backend.targetUrl || "", backend.serviceName, index + 1);
    });
}

export function createMappedWebServiceFromRoute(route: DiscoveredRoute, id: string, groupId: string, order: number, now: string): WebService {
  const domains = normalizeDomains(route.domains);
  const primaryDomain = domains[0] || "";
  const simpleHost = isSimpleHostRule(route.rule || "", domains);
  const tls = route.tlsResolver ? { mode: "resolver" as const, resolver: route.tlsResolver } : { mode: "none" as const };

  return {
    id,
    name: displayNameFromRoute(route),
    enabled: route.status !== "offline",
    managementMode: "mapped",
    sourceRouterName: route.routerName,
    sourceProvider: route.provider,
    sourceServiceName: route.backend.serviceName || route.serviceName,
    importedAt: now,
    matchMode: simpleHost ? "host" : "custom",
    groupId,
    domains,
    domainRoot: primaryDomain ? inferRootDomain(primaryDomain) : undefined,
    customRule: simpleHost ? undefined : route.rule || "",
    listenPort: inferListenPort(route),
    entryPoints: route.entryPoints.length ? route.entryPoints : [route.tls ? "websecure" : "web"],
    targetUrl: route.backend.targetUrl || "",
    passHostHeader: true,
    middlewares: route.middlewares,
    tls,
    observability: { accessLogs: true, metrics: true, tracing: false },
    order,
    notes: [
      `Mapped from existing Traefik router ${route.routerName}.`,
      route.backend.serviceName ? `Runtime service: ${route.backend.serviceName}.` : "",
      "GateLite treats this as an external read-only route and will not write a duplicate file-provider router."
    ]
      .filter(Boolean)
      .join("\n"),
    createdAt: now,
    updatedAt: now
  };
}

export function ensureImportedGroup(state: GateLiteState, preferredGroupId: string | undefined): string {
  if (preferredGroupId && state.groups.some((group) => group.id === preferredGroupId)) return preferredGroupId;
  const existing = state.groups.find((group) => group.name === fallbackGroupName);
  if (existing) return existing.id;
  const id = "imported-traefik";
  state.groups.push({
    id,
    name: fallbackGroupName,
    collapsed: false,
    order: state.groups.length + 1
  });
  return id;
}

export function findDiscoveredRoute(routes: DiscoveredRoute[], routerName: string): DiscoveredRoute | undefined {
  return routes.find((route) => route.routerName === routerName || route.routerName.replace(/@[a-z0-9_-]+$/i, "") === routerName);
}

export function discoveredTrafficServiceId(router: RuntimeRouter): string {
  return `runtime-${router.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "router"}`;
}

function transientServiceForRoute(router: RuntimeRouter, targetUrl: string, sourceServiceName: string | undefined, order: number): WebService {
  return {
    id: discoveredTrafficServiceId(router),
    name: router.domains[0] || router.name,
    enabled: router.status !== "offline",
    managementMode: "mapped",
    sourceRouterName: router.name,
    sourceProvider: router.provider,
    sourceServiceName,
    matchMode: router.domains.length === 1 ? "host" : "custom",
    groupId: "__runtime",
    domains: normalizeDomains(router.domains),
    domainRoot: router.domains[0] ? inferRootDomain(router.domains[0]) : undefined,
    customRule: router.rule,
    listenPort: inferListenPort(router),
    entryPoints: router.entryPoints.length ? router.entryPoints : [router.tls ? "websecure" : "web"],
    targetUrl,
    passHostHeader: true,
    middlewares: router.middlewares,
    tls: router.tlsResolver ? { mode: "resolver", resolver: router.tlsResolver } : { mode: "none" },
    order,
    createdAt: "",
    updatedAt: ""
  };
}

function managedServicesByRouterName(services: WebService[]): Map<string, WebService> {
  const map = new Map<string, WebService>();
  for (const service of services) {
    const generated = traefikName("gatelite", service.id);
    map.set(generated, service);
    map.set(`${generated}@file`, service);
    if (service.sourceRouterName) {
      map.set(service.sourceRouterName, service);
      map.set(service.sourceRouterName.replace(/@[a-z0-9_-]+$/i, ""), service);
    }
  }
  return map;
}

function runtimeBackendForRouter(router: RuntimeRouter, services: RuntimeService[]): DiscoveredRoute["backend"] {
  const runtimeService = findRuntimeService(router, services);
  const servers = runtimeService?.servers || [];
  return {
    serviceName: runtimeService?.name || router.service,
    provider: runtimeService?.provider || router.provider,
    status: runtimeService?.status,
    servers,
    targetUrl: servers[0]
  };
}

function findRuntimeService(router: RuntimeRouter, services: RuntimeService[]): RuntimeService | undefined {
  if (!router.service) return undefined;
  const serviceName = router.service;
  const candidates = new Set<string>([serviceName]);
  if (!serviceName.includes("@") && router.provider) candidates.add(`${serviceName}@${router.provider}`);
  for (const candidate of candidates) {
    const exact = services.find((service) => service.name === candidate);
    if (exact) return exact;
  }
  return services.find((service) => stripProvider(service.name) === serviceName && (!router.provider || service.provider === router.provider || service.name.endsWith(`@${router.provider}`)));
}

function routeImportWarnings(router: RuntimeRouter, targetUrl: string | undefined): string[] {
  const warnings: string[] = [];
  if (router.protocol !== "http") warnings.push("Only HTTP routers can be imported as GateLite Web services.");
  if (router.domains.length === 0) warnings.push("The Traefik rule does not expose a Host domain that GateLite can map.");
  if (!targetUrl) warnings.push("The runtime service does not expose a backend server URL.");
  if (router.service?.endsWith("@internal")) warnings.push("Traefik internal services cannot be mapped as reverse proxy backends.");
  return warnings;
}

function tlsImportWarnings(router: RuntimeRouter): string[] {
  const warnings: string[] = [];
  if (!router.tlsResolver) {
    warnings.push("Traefik does not expose certificate material or an ACME resolver for this TLS router.");
  }
  if (router.domains.length === 0) warnings.push("No Host domain is attached to this TLS router.");
  return warnings;
}

function managedCertificateForTlsRouter(router: RuntimeRouter, certificates: CertificateItem[]): CertificateItem | undefined {
  const routerResolver = resolverName(router.tlsResolver);
  if (routerResolver) {
    const resolverMatch = certificates.find((certificate) => certificate.source === "acme" && resolverName(certificate.acme?.resolver) === routerResolver);
    if (resolverMatch) return resolverMatch;
  }
  return certificates.find((certificate) => router.domains.length > 0 && router.domains.every((domain) => certificateCoversDomain(certificate.domains, domain)));
}

function displayNameFromRoute(route: DiscoveredRoute): string {
  const domain = route.domains[0];
  if (domain) return domain;
  return stripProvider(route.routerName).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || route.routerName;
}

function isSimpleHostRule(rule: string, domains: string[]): boolean {
  if (domains.length !== 1) return false;
  const normalized = rule.replace(/\s+/g, "");
  return normalized === `Host(\`${domains[0]}\`)` || normalized === `Host("${domains[0]}")` || normalized === `Host('${domains[0]}')`;
}

function inferListenPort(route: Pick<DiscoveredRoute, "entryPoints" | "tls"> | RuntimeRouter): number {
  const entryPoints = route.entryPoints.map((entryPoint) => entryPoint.toLowerCase());
  if (entryPoints.includes("websecure")) return 443;
  if (entryPoints.includes("web")) return 80;
  return route.tls ? 443 : 80;
}

function inferRootDomain(domainInput: string): string {
  const domain = normalizeDomain(domainInput);
  const labels = domain.split(".").filter(Boolean);
  if (labels.length <= 1) return domain || "localhost";
  if (domain.endsWith(".localhost")) return "localhost";
  if (labels.length >= 4) return labels.slice(-3).join(".");
  return labels.slice(-2).join(".");
}

function normalizeDomains(domains: string[]): string[] {
  return Array.from(new Set(domains.map(normalizeDomain).filter(Boolean)));
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^\.+|\.+$/g, "");
}

function stripProvider(value: string): string {
  return value.replace(/@[a-z0-9_-]+$/i, "");
}
