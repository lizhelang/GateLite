import type { DnsConfig, ManagedDnsRecordConfig } from "./config";
import { config } from "./config";
import type {
  DnsManagedRecordStatus,
  DnsRecordAction,
  DnsRecordStatus,
  DnsRecordType,
  DnsStatus,
  DnsSyncResult,
  DnsZoneStatus,
  RuntimeStatus
} from "../shared/types";

interface CloudflareZone {
  id: string;
  name: string;
  status?: string;
}

interface CloudflareRecord {
  id: string;
  type: DnsRecordType;
  name: string;
  content: string;
  proxied?: boolean;
  ttl?: number;
  comment?: string;
}

interface CloudflareRecordPayload {
  type: DnsRecordType;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
  comment?: string;
}

interface CloudflareZoneSnapshot {
  config: DnsConfig["cloudflareZones"][number];
  status: DnsZoneStatus;
  zone?: CloudflareZone;
  records: CloudflareRecord[];
}

interface ResolvedIpv4 {
  address?: string;
  source?: string;
  error?: string;
}

const cloudflareBaseUrl = "https://api.cloudflare.com/client/v4";
const incompatibleTypes: Record<DnsRecordType, DnsRecordType[]> = {
  A: ["CNAME"],
  AAAA: ["CNAME"],
  CNAME: ["A", "AAAA"]
};

let lastSync: DnsSyncResult | undefined;
let schedulerStarted = false;

export async function getDnsStatus(): Promise<DnsStatus> {
  return buildDnsStatus({ apply: false });
}

export async function syncDnsNow(): Promise<DnsStatus> {
  return buildDnsStatus({ apply: true });
}

export function startDnsScheduler(): void {
  if (schedulerStarted || !config.dns.enabled) return;
  schedulerStarted = true;

  void syncDnsNow().catch((error) => {
    console.error(`[dns] Initial DNS sync failed: ${error instanceof Error ? error.message : String(error)}`);
  });

  const timer = setInterval(() => {
    void syncDnsNow().catch((error) => {
      console.error(`[dns] Scheduled DNS sync failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, config.dns.intervalSeconds * 1000);
  timer.unref?.();
}

export function desiredDnsContent(record: Pick<ManagedDnsRecordConfig, "content">, ipv4?: string): string {
  return record.content === "@ipv4" ? ipv4 || "" : record.content;
}

export function normalizeRecordName(name: string, zoneName: string): string {
  const normalized = name.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  const normalizedZone = zoneName.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  if (normalized === "@" || normalized === normalizedZone) return normalizedZone;
  if (normalized.endsWith(`.${normalizedZone}`)) return normalized;
  return `${normalized}.${normalizedZone}`;
}

export function evaluateRecordStatus({
  desired,
  existingRecords,
  currentIpv4
}: {
  desired: ManagedDnsRecordConfig;
  existingRecords: CloudflareRecord[];
  currentIpv4?: string;
}): DnsManagedRecordStatus {
  const name = normalizeRecordName(desired.name, desired.zoneName);
  const desiredContent = desiredDnsContent(desired, currentIpv4);
  const base = {
    zoneName: desired.zoneName,
    type: desired.type,
    name,
    desiredContent,
    proxied: desired.proxied,
    ttl: desired.ttl,
    comment: desired.comment
  };

  if (desired.content === "@ipv4" && !desiredContent) {
    return {
      ...base,
      status: "error",
      action: "blocked",
      message: "Current public IPv4 is unavailable, so this A record cannot be evaluated."
    };
  }

  const sameName = existingRecords.filter((record) => record.name.toLowerCase() === name);
  const conflicts = sameName.filter((record) => incompatibleTypes[desired.type].includes(record.type));
  if (conflicts.length > 0) {
    return {
      ...base,
      currentContent: conflicts.map((record) => `${record.type} ${record.content}`).join(", "),
      status: "conflict",
      action: "blocked",
      message: `Existing ${conflicts.map((record) => record.type).join("/")} record blocks ${desired.type} management for ${name}.`
    };
  }

  const matches = sameName.filter((record) => record.type === desired.type);
  if (matches.length > 1) {
    return {
      ...base,
      currentContent: matches.map((record) => record.content).join(", "),
      status: "conflict",
      action: "blocked",
      message: `Multiple ${desired.type} records exist for ${name}; GateLite will not guess which one to manage.`
    };
  }

  if (matches.length === 0) {
    return {
      ...base,
      status: "missing",
      action: "create",
      message: "Record is missing in Cloudflare."
    };
  }

  const current = matches[0];
  const normalizedTtl = desired.ttl ?? current.ttl;
  const normalizedProxied = desired.proxied ?? current.proxied;
  const normalizedComment = desired.comment ?? current.comment;
  const needsUpdate =
    current.content !== desiredContent ||
    (desired.ttl !== undefined && current.ttl !== normalizedTtl) ||
    (desired.proxied !== undefined && current.proxied !== normalizedProxied) ||
    (desired.comment !== undefined && (current.comment || "") !== (normalizedComment || ""));

  return {
    ...base,
    currentContent: current.content,
    currentProxied: current.proxied,
    currentTtl: current.ttl,
    currentComment: current.comment,
    cloudflareRecordId: current.id,
    status: needsUpdate ? "needs-update" : "ok",
    action: needsUpdate ? "update" : "none",
    message: needsUpdate ? "Record differs from the GateLite declaration." : "Record matches the GateLite declaration."
  };
}

async function buildDnsStatus({ apply }: { apply: boolean }): Promise<DnsStatus> {
  const now = new Date().toISOString();
  const dns = config.dns;
  if (!dns.enabled) {
    return {
      enabled: false,
      provider: "cloudflare",
      intervalSeconds: dns.intervalSeconds,
      updatedAt: now,
      zones: dns.cloudflareZones.map((zone) => ({
        zoneName: zone.zoneName,
        configured: false,
        tokenConfigured: Boolean(zone.apiToken),
        status: "unknown"
      })),
      records: [],
      warnings: ["DNS management is disabled. Set GATELITE_DNS_ENABLED=true to let GateLite manage declared DNS records."],
      lastSync
    };
  }

  const warnings: string[] = [];
  if (dns.cloudflareZones.length === 0) warnings.push("No Cloudflare zones are configured.");
  if (dns.records.length === 0) warnings.push("No DNS records are declared in GATELITE_DNS_RECORDS.");

  const ipv4 = await resolvePublicIpv4(dns);
  if (ipv4.error) warnings.push(ipv4.error);

  const snapshots = await Promise.all(dns.cloudflareZones.map((zone) => readCloudflareZoneSnapshot(zone)));
  for (const snapshot of snapshots) {
    if (snapshot.status.error) warnings.push(`${snapshot.status.zoneName}: ${snapshot.status.error}`);
  }

  const snapshotsByZone = new Map(snapshots.map((snapshot) => [snapshot.config.zoneName, snapshot]));
  const recordStatuses: DnsManagedRecordStatus[] = [];
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let blocked = 0;
  let failed = 0;

  for (const record of dns.records) {
    const snapshot = snapshotsByZone.get(record.zoneName);
    if (!snapshot?.zone) {
      blocked += 1;
      recordStatuses.push({
        zoneName: record.zoneName,
        type: record.type,
        name: normalizeRecordName(record.name, record.zoneName),
        desiredContent: desiredDnsContent(record, ipv4.address),
        proxied: record.proxied,
        ttl: record.ttl,
        comment: record.comment,
        status: "error",
        action: "blocked",
        message: "Configured Cloudflare zone is not available to GateLite."
      });
      continue;
    }

    const status = evaluateRecordStatus({
      desired: record,
      existingRecords: snapshot.records,
      currentIpv4: ipv4.address
    });

    if (apply && (status.action === "create" || status.action === "update")) {
      const applied = await applyRecord(snapshot, record, status);
      recordStatuses.push(applied);
      if (applied.status === "error" || applied.status === "conflict") {
        failed += 1;
      } else if (status.action === "create") {
        created += 1;
      } else {
        updated += 1;
      }
      continue;
    }

    if (status.action === "none") unchanged += 1;
    if (status.action === "blocked") blocked += 1;
    recordStatuses.push(status);
  }

  if (!apply) {
    unchanged = recordStatuses.filter((record) => record.action === "none").length;
    blocked = recordStatuses.filter((record) => record.action === "blocked").length;
  }

  const status: DnsStatus = {
    enabled: true,
    provider: "cloudflare",
    intervalSeconds: dns.intervalSeconds,
    updatedAt: now,
    currentIpv4: ipv4.address,
    currentIpv4Source: ipv4.source,
    zones: snapshots.map((snapshot) => snapshot.status),
    records: recordStatuses,
    warnings,
    lastSync
  };

  if (apply) {
    lastSync = {
      at: now,
      applied: true,
      currentIpv4: ipv4.address,
      created,
      updated,
      unchanged,
      blocked,
      failed,
      warnings
    };
    status.lastSync = lastSync;
  }

  return status;
}

async function applyRecord(snapshot: CloudflareZoneSnapshot, record: ManagedDnsRecordConfig, status: DnsManagedRecordStatus): Promise<DnsManagedRecordStatus> {
  if (!snapshot.zone) return status;

  try {
    const payload: CloudflareRecordPayload = {
      type: record.type,
      name: status.name,
      content: status.desiredContent,
      ttl: record.ttl,
      proxied: record.proxied,
      comment: record.comment
    };
    const client = new CloudflareClient(snapshot.config.apiToken);

    if (status.action === "create") {
      const response = await client.request<CloudflareRecord>("POST", `/zones/${snapshot.zone.id}/dns_records`, payload);
      return {
        ...status,
        currentContent: response.content,
        currentProxied: response.proxied,
        currentTtl: response.ttl,
        currentComment: response.comment,
        cloudflareRecordId: response.id,
        status: "ok",
        action: "none",
        message: "Record was created in Cloudflare."
      };
    }

    if (status.action === "update" && status.cloudflareRecordId) {
      const response = await client.request<CloudflareRecord>("PUT", `/zones/${snapshot.zone.id}/dns_records/${status.cloudflareRecordId}`, payload);
      return {
        ...status,
        currentContent: response.content,
        currentProxied: response.proxied,
        currentTtl: response.ttl,
        currentComment: response.comment,
        cloudflareRecordId: response.id,
        status: "ok",
        action: "none",
        message: "Record was updated in Cloudflare."
      };
    }

    return status;
  } catch (error) {
    return {
      ...status,
      status: "error",
      action: "blocked",
      message: error instanceof Error ? error.message : "Cloudflare update failed."
    };
  }
}

async function readCloudflareZoneSnapshot(zoneConfig: DnsConfig["cloudflareZones"][number]): Promise<CloudflareZoneSnapshot> {
  const statusBase: DnsZoneStatus = {
    zoneName: zoneConfig.zoneName,
    configured: true,
    tokenConfigured: Boolean(zoneConfig.apiToken),
    status: "unknown"
  };

  try {
    const client = new CloudflareClient(zoneConfig.apiToken);
    const zoneResponse = await client.request<CloudflareZone[]>("GET", `/zones?name=${encodeURIComponent(zoneConfig.zoneName)}&per_page=50`);
    const zone = zoneResponse.find((candidate) => candidate.name === zoneConfig.zoneName);
    if (!zone) {
      return {
        config: zoneConfig,
        status: {
          ...statusBase,
          status: "offline",
          error: "Cloudflare token cannot see this zone."
        },
        records: []
      };
    }

    const records = await client.request<CloudflareRecord[]>("GET", `/zones/${zone.id}/dns_records?per_page=200`);
    return {
      config: zoneConfig,
      zone,
      status: {
        ...statusBase,
        cloudflareZoneId: zone.id,
        status: zone.status === "active" ? "online" : "warning"
      },
      records
    };
  } catch (error) {
    return {
      config: zoneConfig,
      status: {
        ...statusBase,
        status: "offline",
        error: error instanceof Error ? error.message : "Cloudflare zone lookup failed."
      },
      records: []
    };
  }
}

async function resolvePublicIpv4(dns: DnsConfig): Promise<ResolvedIpv4> {
  if (dns.targetIpv4) {
    return isIpv4(dns.targetIpv4)
      ? { address: dns.targetIpv4, source: "GATELITE_DNS_TARGET_IPV4" }
      : { error: "GATELITE_DNS_TARGET_IPV4 is not a valid IPv4 address." };
  }

  for (const url of dns.publicIpv4Urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) continue;
      const text = await response.text();
      const match = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
      if (match && isIpv4(match[0])) return { address: match[0], source: url };
    } catch {
      // Try the next configured endpoint.
    }
  }

  return { error: "Unable to discover current public IPv4 from configured endpoints." };
}

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

class CloudflareClient {
  constructor(private readonly apiToken: string) {}

  async request<T>(method: "GET" | "POST" | "PUT", path: string, body?: CloudflareRecordPayload): Promise<T> {
    const response = await fetch(`${cloudflareBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const payload = (await response.json()) as { success: boolean; result: T; errors?: Array<{ message: string }> };
    if (!response.ok || !payload.success) {
      const message = payload.errors?.map((error) => error.message).join("; ") || `Cloudflare API returned HTTP ${response.status}.`;
      throw new Error(message);
    }
    return payload.result;
  }
}
