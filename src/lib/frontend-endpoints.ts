import type { WebService } from "../../shared/types";

export type FrontendProtocol = "http" | "https";

const httpsFrontendPorts = new Set([443, 8443, 11443, 16666]);

export function frontendProtocolForService(service: Pick<WebService, "entryPoints" | "listenPort" | "tls">): FrontendProtocol {
  if (service.tls.mode !== "none") return "https";

  const entryPoints = service.entryPoints.map((entryPoint) => entryPoint.trim().toLowerCase());
  if (entryPoints.includes("websecure") || entryPoints.includes("https")) return "https";
  if (httpsFrontendPorts.has(service.listenPort)) return "https";

  return "http";
}
