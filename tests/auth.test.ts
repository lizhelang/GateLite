import { describe, expect, it } from "vitest";
import { requiredRoleForRequest, roleCanAccess } from "../server/auth";

describe("GateLite access policy", () => {
  it("keeps health public even when auth is enabled", () => {
    expect(requiredRoleForRequest("GET", "/api/health")).toBe("public");
  });

  it("allows viewer access to read-only API and UI routes", () => {
    expect(requiredRoleForRequest("GET", "/api/dashboard")).toBe("viewer");
    expect(requiredRoleForRequest("GET", "/")).toBe("viewer");
    expect(roleCanAccess("viewer", "viewer")).toBe(true);
  });

  it("requires operator-level access for normal write operations", () => {
    const requiredRole = requiredRoleForRequest("POST", "/api/web-services");

    expect(requiredRole).toBe("operator");
    expect(roleCanAccess("viewer", requiredRole)).toBe(false);
    expect(roleCanAccess("agent", requiredRole)).toBe(true);
    expect(roleCanAccess("operator", requiredRole)).toBe(true);
    expect(roleCanAccess("admin", requiredRole)).toBe(true);
  });

  it("requires admin access for private-key and high-risk operations", () => {
    for (const [method, path] of [
      ["GET", "/api/certificates/cert-local/download"],
      ["POST", "/api/certificates/cert-local/sync"],
      ["POST", "/api/history/evt-local/rollback"],
      ["POST", "/api/discovered-routes/import-all"],
      ["DELETE", "/api/certificates/cert-local"]
    ]) {
      const requiredRole = requiredRoleForRequest(method, path);

      expect(requiredRole).toBe("admin");
      expect(roleCanAccess("operator", requiredRole)).toBe(false);
      expect(roleCanAccess("agent", requiredRole)).toBe(false);
      expect(roleCanAccess("admin", requiredRole)).toBe(true);
    }
  });
});
