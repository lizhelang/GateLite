import crypto from "node:crypto";
import type express from "express";
import type { AccessRole, AuthConfig } from "./config";

type RequiredRole = AccessRole | "public";

interface AuthIdentity {
  role: AccessRole;
  subject: string;
  method: "basic" | "bearer";
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthIdentity;
    }
  }
}

const roleRank: Record<AccessRole, number> = {
  viewer: 1,
  agent: 2,
  operator: 2,
  admin: 3
};

export function createAuthMiddleware(auth: AuthConfig): express.RequestHandler {
  if (!auth.enabled) return (_request, _response, next) => next();

  if (!hasAnyCredential(auth)) {
    throw new Error("GATELITE_AUTH_ENABLED=true requires GATELITE_AUTH_USERNAME/GATELITE_AUTH_PASSWORD or at least one role token.");
  }

  return (request, response, next) => {
    const requiredRole = requiredRoleForRequest(request.method, request.path);
    if (requiredRole === "public") return next();

    const identity = authenticateRequest(auth, request);
    if (!identity) {
      response.setHeader("WWW-Authenticate", 'Basic realm="GateLite"');
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    if (!roleCanAccess(identity.role, requiredRole)) {
      response.status(403).json({ error: `Role ${identity.role} cannot access this GateLite operation.` });
      return;
    }

    request.auth = identity;
    next();
  };
}

export function requiredRoleForRequest(method: string, path: string): RequiredRole {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === "GET" && path === "/api/health") return "public";

  if (!path.startsWith("/api/")) return "viewer";

  if (normalizedMethod === "GET" && /^\/api\/certificates\/[^/]+\/download$/.test(path)) return "admin";
  if (normalizedMethod === "POST" && /^\/api\/certificates\/[^/]+\/sync$/.test(path)) return "admin";
  if (normalizedMethod === "POST" && /^\/api\/history\/[^/]+\/rollback$/.test(path)) return "admin";
  if (normalizedMethod === "POST" && path === "/api/discovered-routes/import-all") return "admin";
  if (normalizedMethod === "DELETE" && /^\/api\/certificates\/[^/]+$/.test(path)) return "admin";

  if (normalizedMethod === "GET") return "viewer";
  return "operator";
}

export function roleCanAccess(role: AccessRole, requiredRole: RequiredRole): boolean {
  if (requiredRole === "public") return true;
  return roleRank[role] >= roleRank[requiredRole];
}

function authenticateRequest(auth: AuthConfig, request: express.Request): AuthIdentity | undefined {
  const authorization = request.headers.authorization;
  if (!authorization) return undefined;

  const basic = authenticateBasic(auth, authorization);
  if (basic) return basic;

  const bearer = authenticateBearer(auth, authorization);
  if (bearer) return bearer;

  return undefined;
}

function authenticateBasic(auth: AuthConfig, authorization: string): AuthIdentity | undefined {
  if (!auth.username || !auth.password || !authorization.startsWith("Basic ")) return undefined;

  const decoded = Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) return undefined;

  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  if (!safeEqual(username, auth.username) || !safeEqual(password, auth.password)) return undefined;

  return {
    role: "admin",
    subject: username,
    method: "basic"
  };
}

function authenticateBearer(auth: AuthConfig, authorization: string): AuthIdentity | undefined {
  if (!authorization.startsWith("Bearer ")) return undefined;

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) return undefined;

  for (const role of ["admin", "operator", "agent", "viewer"] as const) {
    if (auth.tokens[role].some((candidate) => safeEqual(candidate, token))) {
      return {
        role,
        subject: role,
        method: "bearer"
      };
    }
  }

  return undefined;
}

function hasAnyCredential(auth: AuthConfig): boolean {
  if (auth.username && auth.password) return true;
  return Object.values(auth.tokens).some((tokens) => tokens.length > 0);
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = crypto.createHash("sha256").update(left).digest();
  const rightHash = crypto.createHash("sha256").update(right).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}
