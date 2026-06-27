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
  dns: DnsConfig;
}

export type AccessRole = "viewer" | "agent" | "operator" | "admin";
export type DnsRecordType = "A" | "AAAA" | "CNAME";

export interface AuthConfig {
  enabled: boolean;
  username?: string;
  password?: string;
  tokens: Record<AccessRole, string[]>;
}

export interface CloudflareZoneConfig {
  zoneName: string;
  apiToken: string;
}

export interface ManagedDnsRecordConfig {
  zoneName: string;
  type: DnsRecordType;
  name: string;
  content: string;
  proxied?: boolean;
  ttl?: number;
  comment?: string;
}

export interface DnsConfig {
  enabled: boolean;
  intervalSeconds: number;
  targetIpv4?: string;
  publicIpv4Urls: string[];
  cloudflareZones: CloudflareZoneConfig[];
  records: ManagedDnsRecordConfig[];
}

const root = process.cwd();

const auth = readAuthConfig();
const dns = readDnsConfig();

if (dns.enabled && !auth.enabled) {
  throw new Error("GATELITE_DNS_ENABLED=true requires GATELITE_AUTH_ENABLED=true so Cloudflare DNS write operations are not exposed without GateLite auth.");
}

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
  auth,
  dns
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

function readDnsConfig(): DnsConfig {
  return {
    enabled: process.env.GATELITE_DNS_ENABLED === "true",
    intervalSeconds: clampNumber(Number(process.env.GATELITE_DNS_INTERVAL_SECONDS || 300), 60, 86400),
    targetIpv4: normalizeEnv(process.env.GATELITE_DNS_TARGET_IPV4),
    publicIpv4Urls: readList(process.env.GATELITE_DNS_PUBLIC_IPV4_URLS || "https://ifconfig.co/ip,https://api.ipify.org"),
    cloudflareZones: readCloudflareZones(process.env.GATELITE_CLOUDFLARE_ZONE_TOKENS),
    records: readManagedDnsRecords(process.env.GATELITE_DNS_RECORDS)
  };
}

function readCloudflareZones(value: string | undefined): CloudflareZoneConfig[] {
  return readDelimitedEntries(value).flatMap((entry) => {
    const separator = entry.indexOf("=");
    if (separator === -1) return [];
    const zoneName = normalizeDomain(entry.slice(0, separator));
    const apiToken = normalizeEnv(entry.slice(separator + 1));
    return zoneName && apiToken ? [{ zoneName, apiToken }] : [];
  });
}

function readManagedDnsRecords(value: string | undefined): ManagedDnsRecordConfig[] {
  const normalized = normalizeEnv(value);
  if (!normalized) return [];
  if (normalized.startsWith("[")) {
    const parsed = JSON.parse(normalized) as ManagedDnsRecordConfig[];
    return parsed.map(normalizeManagedDnsRecord).filter(Boolean) as ManagedDnsRecordConfig[];
  }

  return readDelimitedEntries(normalized)
    .map((entry) => {
      const [zoneName, type, name, content, proxied, ttl, ...commentParts] = entry.split("|");
      return normalizeManagedDnsRecord({
        zoneName,
        type: type as DnsRecordType,
        name,
        content,
        proxied: proxied === "" || proxied === undefined ? undefined : proxied === "true",
        ttl: ttl ? Number(ttl) : undefined,
        comment: commentParts.join("|")
      });
    })
    .filter(Boolean) as ManagedDnsRecordConfig[];
}

function normalizeManagedDnsRecord(record: ManagedDnsRecordConfig): ManagedDnsRecordConfig | undefined {
  const zoneName = normalizeDomain(record.zoneName);
  const name = normalizeDomain(record.name);
  const content = normalizeEnv(record.content);
  const type = record.type?.toUpperCase() as DnsRecordType;
  if (!zoneName || !name || !content || !["A", "AAAA", "CNAME"].includes(type)) return undefined;
  return {
    zoneName,
    type,
    name,
    content,
    proxied: typeof record.proxied === "boolean" ? record.proxied : undefined,
    ttl: record.ttl ? clampNumber(Number(record.ttl), 1, 86400) : undefined,
    comment: normalizeEnv(record.comment)
  };
}

function readDelimitedEntries(value: string | undefined): string[] {
  return readList(value, /[;\n]/);
}

function readList(value: string | undefined, separator: RegExp = /[,\n]/): string[] {
  return (value || "")
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeDomain(value: string | undefined): string | undefined {
  return normalizeEnv(value)
    ?.toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^\.+|\.+$/g, "");
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function normalizeEnv(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}
