import { Activity, Boxes, Check, Copy, Download, FileCode2, Network, RefreshCw, Server } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { TraefikRuntime } from "../../shared/types";
import { getGeneratedConfig } from "../api";
import { StatusBadge } from "../components/StatusBadge";
import { useLanguage } from "../i18n";

interface RuntimePageProps {
  runtime: TraefikRuntime;
}

export function RuntimePage({ runtime }: RuntimePageProps) {
  const { t } = useLanguage();
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
      setConfigError(error instanceof Error ? error.message : t("Unable to load generated Traefik config.", "无法加载生成的 Traefik 配置。"));
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
      setConfigError(t("Clipboard access failed. You can still select and copy the YAML manually.", "剪贴板访问失败。你仍然可以手动选择并复制 YAML。"));
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
          <p className="eyebrow">{t("03 Traefik Runtime", "03 Traefik 运行时")}</p>
          <h2>{t("Dashboard parity surface", "Dashboard 对等运行面板")}</h2>
          <p>{t("Routers, services, middlewares, entrypoints, providers, raw config and status from the local Traefik API.", "展示来自本地 Traefik API 的 routers、services、middlewares、entrypoints、providers、原始配置和状态。")}</p>
        </div>
        <StatusBadge status={runtime.connected ? "online" : "offline"} label={runtime.connected ? t("Connected", "已连接") : t("Offline", "离线")} />
      </header>

      {runtime.error ? <div className="notice error">{runtime.error}</div> : null}

      <div className="runtime-matrix">
        <RuntimeStat icon={<Activity size={18} />} label={t("Version", "版本")} value={runtime.version || t("Unknown", "未知")} />
        <RuntimeStat icon={<Network size={18} />} label={t("Entrypoints", "入口点")} value={String(entryPoints.length)} />
        <RuntimeStat icon={<Boxes size={18} />} label={t("Routers", "路由")} value={String(runtime.routers.length)} />
        <RuntimeStat icon={<Server size={18} />} label={t("Services", "服务")} value={String(runtime.services.length)} />
        <RuntimeStat icon={<FileCode2 size={18} />} label={t("Middlewares", "中间件")} value={String(middlewares.length)} />
        <RuntimeStat icon={<Activity size={18} />} label={t("Providers", "Provider")} value={String(providers.length)} />
      </div>

      <div className="runtime-columns">
        <section className="runtime-list">
          <h3>{t("Routers", "路由")}</h3>
          {runtime.routers.map((router) => (
            <article key={router.name} className="runtime-row">
              <div>
                <strong>{router.name}</strong>
                <p>{router.rule || t("No rule", "无规则")}</p>
              </div>
              <div className="runtime-tags">
                <StatusBadge status={router.status} />
                {router.provider ? <span>{router.provider}</span> : null}
                {router.tls ? <span>TLS</span> : null}
              </div>
            </article>
          ))}
          {runtime.routers.length === 0 ? <div className="empty-inline">{t("No routers visible from Traefik yet.", "Traefik 中还没有可见路由。")}</div> : null}
        </section>

        <section className="runtime-list">
          <h3>{t("Services", "服务")}</h3>
          {runtime.services.map((service) => (
            <article key={service.name} className="runtime-row">
              <div>
                <strong>{service.name}</strong>
                <p>{service.servers.join(", ") || t("No servers listed", "未列出 server")}</p>
              </div>
              <div className="runtime-tags">
                <StatusBadge status={service.status} />
                {service.provider ? <span>{service.provider}</span> : null}
              </div>
            </article>
          ))}
          {runtime.services.length === 0 ? <div className="empty-inline">{t("No services visible from Traefik yet.", "Traefik 中还没有可见服务。")}</div> : null}
        </section>
      </div>

      <div className="runtime-columns">
        <section className="runtime-list">
          <h3>{t("Entrypoints", "入口点")}</h3>
          {entryPoints.map((entryPoint) => (
            <article key={entryPoint.name} className="runtime-row">
              <div>
                <strong>{entryPoint.name}</strong>
                <p>{entryPoint.address || t("No address", "无地址")} · {t("read", "读取")} {entryPoint.readTimeout || t("default", "默认")} · {t("idle", "空闲")} {entryPoint.idleTimeout || t("default", "默认")}</p>
              </div>
              <div className="runtime-tags">
                <span>{entryPoint.http2 ? "HTTP/2" : "HTTP"}</span>
                {entryPoint.udpTimeout ? <span>UDP {entryPoint.udpTimeout}</span> : null}
              </div>
            </article>
          ))}
          {entryPoints.length === 0 ? <div className="empty-inline">{t("No entrypoints visible from Traefik yet.", "Traefik 中还没有可见入口点。")}</div> : null}
        </section>

        <section className="runtime-list">
          <h3>{t("Middlewares", "中间件")}</h3>
          {middlewares.map((middleware) => (
            <article key={middleware.name} className="runtime-row">
              <div>
                <strong>{middleware.name}</strong>
                <p>{middleware.type || t("unknown", "未知")} · {t("used by", "被使用于")} {middleware.usedBy.length ? middleware.usedBy.join(", ") : t("no routers", "无路由")}</p>
              </div>
              <div className="runtime-tags">
                <StatusBadge status={middleware.status} />
                {middleware.provider ? <span>{middleware.provider}</span> : null}
              </div>
            </article>
          ))}
          {middlewares.length === 0 ? <div className="empty-inline">{t("No HTTP middlewares visible from Traefik yet.", "Traefik 中还没有可见 HTTP 中间件。")}</div> : null}
        </section>
      </div>

      <section className="runtime-list">
        <h3>{t("Providers and feature flags", "Provider 与功能开关")}</h3>
        <div className="provider-grid">
          <div className="provider-card">
            <span>{t("Providers", "Provider")}</span>
            <strong>{providers.length ? providers.join(" / ") : t("Unknown", "未知")}</strong>
          </div>
          <div className="provider-card">
            <span>{t("Metrics", "指标")}</span>
            <strong>{features.metrics || t("Disabled", "已停用")}</strong>
          </div>
          <div className="provider-card">
            <span>{t("Tracing", "链路追踪")}</span>
            <strong>{features.tracing || t("Disabled", "已停用")}</strong>
          </div>
          <div className="provider-card">
            <span>{t("Access log", "访问日志")}</span>
            <strong>{features.accessLog ? t("Enabled", "已启用") : t("Disabled", "已停用")}</strong>
          </div>
        </div>

        <div className="protocol-grid">
          {protocolSummaries.map((summary) => (
            <article key={summary.protocol} className="protocol-card">
              <span>{summary.protocol}</span>
              <strong>{summary.total}</strong>
              <p>{t(`${summary.warnings} warnings · ${summary.errors} errors`, `${summary.warnings} 个警告 · ${summary.errors} 个错误`)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="config-preview-panel">
        <div className="config-preview-header">
          <div>
            <p className="eyebrow">{t("Generated file-provider config", "生成的 file-provider 配置")}</p>
            <h3>
              <FileCode2 size={18} />
              {t("Traefik YAML preview", "Traefik YAML 预览")}
            </h3>
          </div>
          <div className="toolbar">
            <button type="button" className="secondary-button" onClick={() => void loadGeneratedConfig()} disabled={configLoading}>
              <RefreshCw size={16} />
              {t("Refresh", "刷新")}
            </button>
            <button type="button" className="secondary-button" onClick={() => void handleCopy()} disabled={!generatedConfig}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? t("Copied", "已复制") : t("Copy", "复制")}
            </button>
            <button type="button" className="secondary-button" onClick={handleDownload} disabled={!generatedConfig}>
              <Download size={16} />
              YAML
            </button>
          </div>
        </div>

        <div className="config-stat-strip" aria-label={t("Generated config summary", "生成配置摘要")}>
          <ConfigStat label={t("Routers", "路由")} value={String(configStats.routers)} />
          <ConfigStat label={t("Services", "服务")} value={String(configStats.services)} />
          <ConfigStat label={t("TLS certs", "TLS 证书")} value={String(configStats.certificates)} />
          <ConfigStat label={t("Size", "大小")} value={`${configStats.bytes} B`} />
        </div>

        {configError ? <div className="notice error">{configError}</div> : null}
        {configLoading && !generatedConfig ? <div className="notice">{t("Loading generated Traefik YAML...", "正在加载生成的 Traefik YAML...")}</div> : null}
        <pre className="yaml-preview">{generatedConfig || t("Generated config will appear here after GateLite writes runtime/traefik/gatelite.yml.", "GateLite 写入 runtime/traefik/gatelite.yml 后，生成配置会显示在这里。")}</pre>
      </section>

      <section className="raw-panel">
        <h3>
          <FileCode2 size={18} />
          {t("Raw data snapshot", "原始数据快照")}
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
