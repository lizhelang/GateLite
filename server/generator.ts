import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { CertificateItem, GateLiteState, WebService } from "../shared/types";
import { config } from "./config";
import { traefikName } from "./ids";

export interface GeneratedConfig {
  yaml: string;
  object: Record<string, unknown>;
}

export function generateTraefikDynamicConfig(state: GateLiteState): GeneratedConfig {
  const routers: Record<string, unknown> = {};
  const services: Record<string, unknown> = {};

  for (const service of sortedEnabledServices(state.webServices)) {
    const routerName = traefikName("gatelite", service.id);
    const serviceName = traefikName("gatelite-service", service.id);
    const rule = routerRule(service);
    if (!rule || !service.targetUrl) continue;

    routers[routerName] = {
      rule,
      service: serviceName,
      entryPoints: service.entryPoints,
      ...(service.middlewares.length ? { middlewares: service.middlewares } : {}),
      ...(service.priority !== undefined ? { priority: service.priority } : service.matchMode === "default" ? { priority: 1 } : {}),
      ...routerTlsConfig(service)
    };

    services[serviceName] = {
      loadBalancer: {
        servers: [{ url: service.targetUrl }],
        passHostHeader: service.passHostHeader ?? true
      }
    };
  }

  const tlsCertificates = state.certificates
    .filter((certificate) => certificate.enabled)
    .filter((certificate) => certificate.source !== "acme")
    .map((certificate) => certificateToTraefik(certificate))
    .filter(Boolean);

  const object = {
    http: {
      routers,
      services
    },
    tls: {
      certificates: tlsCertificates
    }
  };

  return {
    object,
    yaml: YAML.stringify(object)
  };
}

export function writeTraefikDynamicConfig(state: GateLiteState): GeneratedConfig {
  const generated = generateTraefikDynamicConfig(state);
  fs.mkdirSync(path.dirname(config.dynamicFile), { recursive: true });
  fs.writeFileSync(config.dynamicFile, generated.yaml, "utf8");
  return generated;
}

function sortedEnabledServices(webServices: WebService[]): WebService[] {
  return [...webServices].filter((service) => service.enabled).sort((a, b) => a.order - b.order);
}

function routerRule(service: WebService): string {
  if (service.matchMode === "default") return "PathPrefix(`/`)";
  if (service.matchMode === "custom") return service.customRule?.trim() || "";
  return service.domains.map((domain) => `Host(\`${domain}\`)`).join(" || ");
}

function routerTlsConfig(service: WebService): Record<string, unknown> {
  if (service.tls.mode === "none") return {};
  if (service.tls.mode === "resolver") {
    return {
      tls: {
        certResolver: service.tls.resolver || "letsencrypt"
      }
    };
  }
  return { tls: {} };
}

function certificateToTraefik(certificate: CertificateItem): { certFile: string; keyFile: string } | undefined {
  if (!certificate.certPath || !certificate.keyPath) return undefined;
  return {
    certFile: path.posix.join(config.certMountPath, path.basename(certificate.certPath)),
    keyFile: path.posix.join(config.certMountPath, path.basename(certificate.keyPath))
  };
}
