import type { CertificateItem, WebService } from "../shared/types";

export function webServicesBoundToCertificate(certificate: CertificateItem, services: WebService[]): WebService[] {
  return services.filter((service) => isWebServiceBoundToCertificate(certificate, service));
}

export function isWebServiceBoundToCertificate(certificate: CertificateItem, service: WebService): boolean {
  if (service.tls.mode === "file-certificate") {
    return service.tls.certificateId === certificate.id;
  }

  if (certificate.source === "acme" && service.tls.mode === "resolver") {
    return resolverName(certificate.acme?.resolver) === resolverName(service.tls.resolver);
  }

  return false;
}

function resolverName(value: string | undefined): string {
  return (value || "letsencrypt").trim().toLowerCase();
}
