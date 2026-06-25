import { describe, expect, it } from "vitest";
import { frontendProtocolForService } from "../src/lib/frontend-endpoints";
import type { WebService } from "../shared/types";

function service(overrides: Partial<Pick<WebService, "entryPoints" | "listenPort" | "tls">> = {}) {
  return {
    entryPoints: ["web"],
    listenPort: 80,
    tls: { mode: "none" as const },
    ...overrides
  };
}

describe("frontendProtocolForService", () => {
  it("uses HTTPS for websecure routes even when TLS is provided by the entrypoint", () => {
    expect(frontendProtocolForService(service({ entryPoints: ["websecure"], listenPort: 16666 }))).toBe("https");
  });

  it("uses HTTPS for the shared 16666 frontend listener", () => {
    expect(frontendProtocolForService(service({ entryPoints: ["web"], listenPort: 16666 }))).toBe("https");
  });

  it("uses HTTPS for explicit TLS modes", () => {
    expect(frontendProtocolForService(service({ tls: { mode: "resolver", resolver: "letsencrypt" } }))).toBe("https");
  });

  it("keeps plain web routes as HTTP", () => {
    expect(frontendProtocolForService(service({ entryPoints: ["web"], listenPort: 18080 }))).toBe("http");
  });
});
