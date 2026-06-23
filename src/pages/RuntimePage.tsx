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
        <RuntimeStat icon={<Network size={18} />} label="Entrypoints" value={String(runtime.entryPoints.length)} />
        <RuntimeStat icon={<Boxes size={18} />} label="Routers" value={String(runtime.routers.length)} />
        <RuntimeStat icon={<Server size={18} />} label="Services" value={String(runtime.services.length)} />
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
