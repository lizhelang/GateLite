import path from "node:path";

export interface AppConfig {
  port: number;
  traefikApiUrl: string;
  stateFile: string;
  dynamicFile: string;
  certDir: string;
  certMountPath: string;
  traefikStaticConfigFile?: string;
  acmeStorageFile?: string;
  seedDemo: boolean;
  auth: AuthConfig;
}

export type AccessRole = "viewer" | "agent" | "operator" | "admin";

export interface AuthConfig {
  enabled: boolean;
  username?: string;
  password?: string;
  tokens: Record<AccessRole, string[]>;
}

const root = process.cwd();

export const config: AppConfig = {
  port: Number(process.env.PORT || 3001),
  traefikApiUrl: process.env.TRAEFIK_API_URL || "http://localhost:18081",
  stateFile: path.resolve(root, process.env.GATELITE_STATE_FILE || "runtime/gatelite-state.json"),
  dynamicFile: path.resolve(root, process.env.GATELITE_DYNAMIC_FILE || "runtime/traefik/gatelite.yml"),
  certDir: path.resolve(root, process.env.GATELITE_CERT_DIR || "runtime/certs"),
  certMountPath: process.env.GATELITE_CERT_MOUNT_PATH || "/certs",
  traefikStaticConfigFile: resolveOptionalPath(process.env.GATELITE_TRAEFIK_STATIC_CONFIG_FILE),
  acmeStorageFile: resolveOptionalPath(process.env.GATELITE_ACME_STORAGE_FILE),
  seedDemo: process.env.GATELITE_SEED_DEMO !== "false",
  auth: readAuthConfig()
};

function resolveOptionalPath(value: string | undefined): string | undefined {
  const normalized = normalizeEnv(value);
  return normalized ? path.resolve(root, normalized) : undefined;
}

function readAuthConfig(): AuthConfig {
  return {
    enabled: process.env.GATELITE_AUTH_ENABLED === "true",
    username: normalizeEnv(process.env.GATELITE_AUTH_USERNAME),
    password: normalizeEnv(process.env.GATELITE_AUTH_PASSWORD),
    tokens: {
      viewer: readRoleTokens("viewer", process.env.GATELITE_VIEWER_TOKEN),
      agent: readRoleTokens("agent", process.env.GATELITE_AGENT_TOKEN),
      operator: readRoleTokens("operator", process.env.GATELITE_OPERATOR_TOKEN),
      admin: readRoleTokens("admin", process.env.GATELITE_ADMIN_TOKEN)
    }
  };
}

function readRoleTokens(role: AccessRole, dedicatedToken: string | undefined): string[] {
  const tokens = new Set<string>();
  const normalizedDedicated = normalizeEnv(dedicatedToken);
  if (normalizedDedicated) tokens.add(normalizedDedicated);

  for (const entry of (process.env.GATELITE_AUTH_TOKENS || "").split(",")) {
    const [entryRole, ...secretParts] = entry.split(":");
    const secret = normalizeEnv(secretParts.join(":"));
    if (entryRole?.trim() === role && secret) tokens.add(secret);
  }

  return Array.from(tokens);
}

function normalizeEnv(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}
