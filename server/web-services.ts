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
