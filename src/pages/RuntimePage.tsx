import { Activity, Boxes, Check, Copy, Download, FileCode2, Network, RefreshCw, Server } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { TraefikRuntime } from "../../shared/types";
import { getGeneratedConfig } from "../api";
import { StatusBadge } from "../components/StatusBadge";

interface RuntimePageProps {
  runtime: TraefikRuntime;
}

export function RuntimePage({ runtime }: RuntimePageProps) {
  const [generatedConfig, setGeneratedConfig] = useState("");
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const configStats = useMemo(() => summarizeGeneratedConfig(generatedConfig), [generatedConfig]);
  const entryPoints = useMemo(() => normalizeEntryPoints(runtime.entryPoints), [runtime.entryPoints]);
  const middlewares = useMemo(() => normalizeMiddlewares(runtime.middlewares), [runtime.middlewares]);
  const providers = useMemo(() => readProviders(runtime.overview), [runtime.overview]);
  const features = useMemo(() => readFeatures(runtime.overview), [runtime.overview]);
  const protocolSummaries = useMemo(() => readProtocolSummaries(runtime.overview), [runtime.overview]);

  const loadGeneratedConfig = async () => {
    setConfigLoading(true);
    setConfigError(null);
    try {
      setGeneratedConfig(await getGeneratedConfig());
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : "Unable to load generated Traefik config.");
    } finally {
      setConfigLoading(false);
    }
  };

  useEffect(() => {
    void loadGeneratedConfig();
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedConfig);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setConfigError("Clipboard access failed. You can still select and copy the YAML manually.");
    }
  };

  const handleDownload = () => {
    const url = URL.createObjectURL(new Blob([generatedConfig], { type: "text/yaml" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "gatelite-traefik-dynamic.yml";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="workspace-section">
      <header className="section-heading sticky-story">
        <div>
          <p className="eyebrow">03 Traefik Runtime</p>
          <h2>Dashboard parity surface</h2>
          <p>Routers, services, middlewares, entrypoints, providers, raw config and status from the local Traefik API.</p>
        </div>
        <StatusBadge status={runtime.connected ? "online" : "offline"} label={runtime.connected ? "Connected" : "Offline"} />
      </header>

      {runtime.error ? <div className="notice error">{runtime.error}</div> : null}

      <div className="runtime-matrix">
        <RuntimeStat icon={<Activity size={18} />} label="Version" value={runtime.version || "Unknown"} />
        <RuntimeStat icon={<Network size={18} />} label="Entrypoints" value={String(entryPoints.length)} />
        <RuntimeStat icon={<Boxes size={18} />} label="Routers" value={String(runtime.routers.length)} />
        <RuntimeStat icon={<Server size={18} />} label="Services" value={String(runtime.services.length)} />
        <RuntimeStat icon={<FileCode2 size={18} />} label="Middlewares" value={String(middlewares.length)} />
        <RuntimeStat icon={<Activity size={18} />} label="Providers" value={String(providers.length)} />
      </div>

      <div className="runtime-columns">
        <section className="runtime-list">
          <h3>Routers</h3>
          {runtime.routers.map((router) => (
            <article key={router.name} className="runtime-row">
              <div>
                <strong>{router.name}</strong>
                <p>{router.rule || "No rule"}</p>
              </div>
              <div className="runtime-tags">
                <StatusBadge status={router.status} label={router.status} />
                {router.provider ? <span>{router.provider}</span> : null}
                {router.tls ? <span>TLS</span> : null}
              </div>
            </article>
          ))}
          {runtime.routers.length === 0 ? <div className="empty-inline">No routers visible from Traefik yet.</div> : null}
        </section>

        <section className="runtime-list">
          <h3>Services</h3>
          {runtime.services.map((service) => (
            <article key={service.name} className="runtime-row">
              <div>
                <strong>{service.name}</strong>
                <p>{service.servers.join(", ") || "No servers listed"}</p>
              </div>
              <div className="runtime-tags">
                <StatusBadge status={service.status} label={service.status} />
                {service.provider ? <span>{service.provider}</span> : null}
              </div>
            </article>
          ))}
          {runtime.services.length === 0 ? <div className="empty-inline">No services visible from Traefik yet.</div> : null}
        </section>
      </div>

      <div className="runtime-columns">
        <section className="runtime-list">
          <h3>Entrypoints</h3>
          {entryPoints.map((entryPoint) => (
            <article key={entryPoint.name} className="runtime-row">
              <div>
                <strong>{entryPoint.name}</strong>
                <p>{entryPoint.address || "No address"} · read {entryPoint.readTimeout || "default"} · idle {entryPoint.idleTimeout || "default"}</p>
              </div>
              <div className="runtime-tags">
                <span>{entryPoint.http2 ? "HTTP/2" : "HTTP"}</span>
                {entryPoint.udpTimeout ? <span>UDP {entryPoint.udpTimeout}</span> : null}
              </div>
            </article>
          ))}
          {entryPoints.length === 0 ? <div className="empty-inline">No entrypoints visible from Traefik yet.</div> : null}
        </section>

        <section className="runtime-list">
          <h3>Middlewares</h3>
          {middlewares.map((middleware) => (
            <article key={middleware.name} className="runtime-row">
              <div>
                <strong>{middleware.name}</strong>
                <p>{middleware.type || "unknown"} · used by {middleware.usedBy.length ? middleware.usedBy.join(", ") : "no routers"}</p>
              </div>
              <div className="runtime-tags">
                <StatusBadge status={middleware.status} label={middleware.status} />
                {middleware.provider ? <span>{middleware.provider}</span> : null}
              </div>
            </article>
          ))}
          {middlewares.length === 0 ? <div className="empty-inline">No HTTP middlewares visible from Traefik yet.</div> : null}
        </section>
      </div>

      <section className="runtime-list">
        <h3>Providers and feature flags</h3>
        <div className="provider-grid">
          <div className="provider-card">
            <span>Providers</span>
            <strong>{providers.length ? providers.join(" / ") : "Unknown"}</strong>
          </div>
          <div className="provider-card">
            <span>Metrics</span>
            <strong>{features.metrics || "Disabled"}</strong>
          </div>
          <div className="provider-card">
            <span>Tracing</span>
            <strong>{features.tracing || "Disabled"}</strong>
          </div>
          <div className="provider-card">
            <span>Access log</span>
            <strong>{features.accessLog ? "Enabled" : "Disabled"}</strong>
          </div>
        </div>

        <div className="protocol-grid">
          {protocolSummaries.map((summary) => (
            <article key={summary.protocol} className="protocol-card">
              <span>{summary.protocol}</span>
              <strong>{summary.total}</strong>
              <p>{summary.warnings} warnings · {summary.errors} errors</p>
            </article>
          ))}
        </div>
      </section>

      <section className="config-preview-panel">
        <div className="config-preview-header">
          <div>
            <p className="eyebrow">Generated file-provider config</p>
            <h3>
              <FileCode2 size={18} />
              Traefik YAML preview
            </h3>
          </div>
          <div className="toolbar">
            <button type="button" className="secondary-button" onClick={() => void loadGeneratedConfig()} disabled={configLoading}>
              <RefreshCw size={16} />
              Refresh
            </button>
            <button type="button" className="secondary-button" onClick={() => void handleCopy()} disabled={!generatedConfig}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className="secondary-button" onClick={handleDownload} disabled={!generatedConfig}>
              <Download size={16} />
              YAML
            </button>
          </div>
        </div>

        <div className="config-stat-strip" aria-label="Generated config summary">
          <ConfigStat label="Routers" value={String(configStats.routers)} />
          <ConfigStat label="Services" value={String(configStats.services)} />
          <ConfigStat label="TLS certs" value={String(configStats.certificates)} />
          <ConfigStat label="Size" value={`${configStats.bytes} B`} />
        </div>

        {configError ? <div className="notice error">{configError}</div> : null}
        {configLoading && !generatedConfig ? <div className="notice">Loading generated Traefik YAML...</div> : null}
        <pre className="yaml-preview">{generatedConfig || "Generated config will appear here after GateLite writes runtime/traefik/gatelite.yml."}</pre>
      </section>

      <section className="raw-panel">
        <h3>
          <FileCode2 size={18} />
          Raw data snapshot
        </h3>
        <pre>{JSON.stringify(runtime.rawData || runtime.overview || {}, null, 2)}</pre>
      </section>
    </section>
  );
}

function RuntimeStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="runtime-stat">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ConfigStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="config-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function summarizeGeneratedConfig(config: string) {
  return {
    routers: countIndentedKeys(config, "routers:"),
    services: countIndentedKeys(config, "services:"),
    certificates: Math.max(0, (config.match(/certFile:/g) || []).length),
    bytes: new TextEncoder().encode(config).length
  };
}

function countIndentedKeys(config: string, section: string): number {
  const lines = config.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === section);
  if (start === -1) return 0;
  let count = 0;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    if (/^ {2}\S/.test(line)) break;
    if (/^ {4}[A-Za-z0-9-]+:/.test(line)) count += 1;
  }
  return count;
}

type RecordLike = Record<string, unknown>;

function normalizeEntryPoints(value: unknown[]) {
  return value
    .map((item) => {
      const record = asRecord(item);
      const transport = asRecord(record.transport);
      const respondingTimeouts = asRecord(transport.respondingTimeouts);
      const http2 = asRecord(record.http2);
      const udp = asRecord(record.udp);
      return {
        name: readString(record.name) || "entrypoint",
        address: readString(record.address),
        readTimeout: readString(respondingTimeouts.readTimeout),
        idleTimeout: readString(respondingTimeouts.idleTimeout),
        http2: Object.keys(http2).length > 0,
        udpTimeout: readString(udp.timeout)
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeMiddlewares(value: unknown[]) {
  return value
    .map((item) => {
      const record = asRecord(item);
      return {
        name: readString(record.name) || "middleware",
        provider: readString(record.provider),
        type: readString(record.type),
        status: normalizeRuntimeStatus(readString(record.status)),
        usedBy: Array.isArray(record.usedBy) ? record.usedBy.map(String) : []
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function readProviders(overview: unknown): string[] {
  const record = asRecord(overview);
  return Array.isArray(record.providers) ? record.providers.map(String) : [];
}

function readFeatures(overview: unknown) {
  const features = asRecord(asRecord(overview).features);
  return {
    metrics: readString(features.metrics),
    tracing: readString(features.tracing),
    accessLog: Boolean(features.accessLog)
  };
}

function readProtocolSummaries(overview: unknown) {
  const record = asRecord(overview);
  return ["http", "tcp", "udp"].map((protocol) => {
    const section = asRecord(record[protocol]);
    const totals = ["routers", "services", "middlewares"].reduce(
      (summary, key) => {
        const item = asRecord(section[key]);
        summary.total += readNumber(item.total);
        summary.warnings += readNumber(item.warnings);
        summary.errors += readNumber(item.errors);
        return summary;
      },
      { total: 0, warnings: 0, errors: 0 }
    );
    return { protocol: protocol.toUpperCase(), ...totals };
  });
}

function normalizeRuntimeStatus(value: string): "online" | "offline" | "warning" | "unknown" {
  if (value.toLowerCase() === "enabled") return "online";
  if (value.toLowerCase() === "disabled") return "offline";
  if (value.toLowerCase() === "warning") return "warning";
  return "unknown";
}

function asRecord(value: unknown): RecordLike {
  return value && typeof value === "object" ? (value as RecordLike) : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
