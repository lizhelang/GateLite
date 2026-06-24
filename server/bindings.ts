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

export function certificateCoversDomain(certificateDomains: string[], domainInput: string): boolean {
  const domain = normalizeDomain(domainInput);
  if (!domain) return false;

  return certificateDomains.some((candidate) => {
    const pattern = normalizeDomain(candidate);
    if (!pattern) return false;
    if (pattern === domain) return true;
    if (!pattern.startsWith("*.")) return false;

    const suffix = pattern.slice(2);
    if (!domain.endsWith(`.${suffix}`)) return false;
    const prefix = domain.slice(0, -(suffix.length + 1));
    return prefix.length > 0 && !prefix.includes(".");
  });
}

export function resolverName(value: string | undefined): string {
  return (value || "letsencrypt").trim().toLowerCase();
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^\.+|\.+$/g, "");
}
