import type { CertificateItem, GateLiteState, WebService } from "../shared/types";
import { BadRequestError } from "./errors";

export function validateWebService(service: WebService, state: GateLiteState): void {
  if (service.matchMode !== "default" && service.domains.length === 0) {
    throw new BadRequestError("At least one frontend domain is required for host rules.");
  }
  if (!state.groups.some((group) => group.id === service.groupId)) {
    throw new BadRequestError(`Web service group does not exist: ${service.groupId}`);
  }
  if (service.tls.mode === "file-certificate") {
    validateFileCertificateBinding(service, state.certificates);
  }
  if (service.tls.mode !== "none" && !service.entryPoints.includes("websecure")) {
    throw new BadRequestError("TLS services must include the websecure entrypoint.");
  }
  validateFrontendDomainAvailability(service, state.webServices);
}

export function webServiceLabel(service: WebService): string {
  return service.name.trim() || service.domains[0] || service.id;
}

function validateFileCertificateBinding(service: WebService, certificates: CertificateItem[]): void {
  if (!service.tls.certificateId) {
    throw new BadRequestError("A certificate is required when TLS mode is file-certificate.");
  }
  const certificate = certificates.find((item) => item.id === service.tls.certificateId);
  if (!certificate) {
    throw new BadRequestError(`Certificate does not exist: ${service.tls.certificateId}`);
  }
  if (!certificate.enabled) {
    throw new BadRequestError(`Certificate is disabled: ${certificate.name}`);
  }
  if (certificate.source === "acme") {
    throw new BadRequestError(`Certificate source ${certificate.source} cannot be used with file-certificate TLS mode.`);
  }
  if (!certificate.certPath || !certificate.keyPath) {
    throw new BadRequestError(`Certificate ${certificate.name} does not have readable certificate and private key paths.`);
  }
  if (certificate.status === "pending" || certificate.status === "invalid" || certificate.status === "expired") {
    throw new BadRequestError(`Certificate ${certificate.name} is ${certificate.status} and cannot be bound to a Web service.`);
  }
}

function validateFrontendDomainAvailability(service: WebService, services: WebService[]): void {
  if (!service.enabled) return;
  const requestedDomains = frontendDomainKeys(service);
  if (requestedDomains.length === 0) return;

  for (const existing of services) {
    if (existing.id === service.id || !existing.enabled) continue;
    const sharedEntryPoint = firstSharedEntryPoint(service.entryPoints, existing.entryPoints);
    if (!sharedEntryPoint) continue;

    const existingDomains = new Set(frontendDomainKeys(existing));
    for (const domain of requestedDomains) {
      if (!existingDomains.has(domain)) continue;
      if (domain === "*") {
        throw new BadRequestError(`Default fallback already exists on entrypoint ${sharedEntryPoint}: ${webServiceLabel(existing)}.`);
      }
      throw new BadRequestError(`Frontend domain ${domain} is already used on entrypoint ${sharedEntryPoint} by Web service ${webServiceLabel(existing)}.`);
    }
  }
}

function frontendDomainKeys(service: WebService): string[] {
  if (service.matchMode === "default") return ["*"];
  if (service.matchMode === "custom") return [];
  return Array.from(new Set(service.domains.map(normalizeDomain).filter(Boolean)));
}

function firstSharedEntryPoint(left: string[], right: string[]): string | undefined {
  const rightSet = new Set(right.map(normalizeEntryPoint));
  return left.find((entryPoint) => rightSet.has(normalizeEntryPoint(entryPoint)))?.trim();
}

function normalizeEntryPoint(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^\.+|\.+$/g, "");
}
