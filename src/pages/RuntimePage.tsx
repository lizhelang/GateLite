import { Activity, Boxes, Check, Copy, Download, FileCode2, Network, RefreshCw, RotateCcw, Server } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { DashboardPayload, GateLiteHistoryEvent } from "../../shared/types";
import { getGeneratedConfig, rollbackHistoryEvent } from "../api";
import { StatusBadge } from "../components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLanguage } from "../i18n";

interface RuntimePageProps {
  dashboard: DashboardPayload;
  onRefresh: () => Promise<void>;
}

export function RuntimePage({ dashboard, onRefresh }: RuntimePageProps) {
  const { t } = useLanguage();
  const runtime = dashboard.runtime;
  const [generatedConfig, setGeneratedConfig] = useState("");
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);
  const [rollbackError, setRollbackError] = useState<string | null>(null);

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

  const handleRollback = async (event: GateLiteHistoryEvent) => {
    if (!event.rollbackAvailable) return;
    if (!window.confirm(t(`Rollback GateLite state to before "${event.summary}"?`, `回滚到「${event.summary}」之前的状态？`))) return;
    setRollingBackId(event.id);
    setRollbackError(null);
    try {
      await rollbackHistoryEvent(event.id);
      await onRefresh();
      await loadGeneratedConfig();
    } catch (error) {
      setRollbackError(error instanceof Error ? error.message : t("Rollback failed.", "回滚失败。"));
    } finally {
      setRollingBackId(null);
    }
  };

  return (
    <section className="grid gap-4">
      <Card className="bg-card/80">
        <CardHeader>
          <div className="grid gap-3 md:flex md:items-center md:justify-between">
            <div className="grid min-w-0 gap-1">
              <CardDescription>{t("04 Traefik Runtime", "04 Traefik 运行时")}</CardDescription>
              <CardTitle className="text-2xl">{t("Dashboard parity surface", "Dashboard 对等运行面板")}</CardTitle>
              <CardDescription>{t("Routers, services, middlewares, entrypoints, providers, raw config and status from the local Traefik API.", "展示来自本地 Traefik API 的 routers、services、middlewares、entrypoints、providers、原始配置和状态。")}</CardDescription>
            </div>
            <StatusBadge status={runtime.connected ? "online" : "offline"} label={runtime.connected ? t("Connected", "已连接") : t("Offline", "离线")} />
          </div>
        </CardHeader>
      </Card>

      {runtime.error ? <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{runtime.error}</div> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <RuntimeStat icon={<Activity className="size-4" />} label={t("Version", "版本")} value={runtime.version || t("Unknown", "未知")} />
        <RuntimeStat icon={<Network className="size-4" />} label={t("Entrypoints", "入口点")} value={String(entryPoints.length)} />
        <RuntimeStat icon={<Boxes className="size-4" />} label={t("Routers", "路由")} value={String(runtime.routers.length)} />
        <RuntimeStat icon={<Server className="size-4" />} label={t("Services", "服务")} value={String(runtime.services.length)} />
        <RuntimeStat icon={<FileCode2 className="size-4" />} label={t("Middlewares", "中间件")} value={String(middlewares.length)} />
        <RuntimeStat icon={<Activity className="size-4" />} label={t("Providers", "Provider")} value={String(providers.length)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <EntityTable
          title={t("Routers", "路由")}
          empty={t("No routers visible from Traefik yet.", "Traefik 中还没有可见路由。")}
          columns={[t("Name", "名称"), t("Rule", "规则"), t("Status", "状态")]}
          rows={runtime.routers.map((router) => [
            router.name,
            router.rule || t("No rule", "无规则"),
            <div className="flex flex-wrap gap-1" key={`${router.name}-status`}>
              <StatusBadge status={router.status} />
              {router.provider ? <Badge variant="outline">{router.provider}</Badge> : null}
              {router.tls ? <Badge variant="outline">TLS</Badge> : null}
            </div>
          ])}
        />
        <EntityTable
          title={t("Services", "服务")}
          empty={t("No services visible from Traefik yet.", "Traefik 中还没有可见服务。")}
          columns={[t("Name", "名称"), t("Servers", "Server"), t("Status", "状态")]}
          rows={runtime.services.map((service) => [
            service.name,
            service.servers.join(", ") || t("No servers listed", "未列出 server"),
            <div className="flex flex-wrap gap-1" key={`${service.name}-status`}>
              <StatusBadge status={service.status} />
              {service.provider ? <Badge variant="outline">{service.provider}</Badge> : null}
            </div>
          ])}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <EntityTable
          title={t("Entrypoints", "入口点")}
          empty={t("No entrypoints visible from Traefik yet.", "Traefik 中还没有可见入口点。")}
          columns={[t("Name", "名称"), t("Address", "地址"), t("Protocol", "协议")]}
          rows={entryPoints.map((entryPoint) => [
            entryPoint.name,
            `${entryPoint.address || t("No address", "无地址")} · ${t("read", "读取")} ${entryPoint.readTimeout || t("default", "默认")} · ${t("idle", "空闲")} ${entryPoint.idleTimeout || t("default", "默认")}`,
            <div className="flex flex-wrap gap-1" key={`${entryPoint.name}-protocol`}>
              <Badge variant="outline">{entryPoint.http2 ? "HTTP/2" : "HTTP"}</Badge>
              {entryPoint.udpTimeout ? <Badge variant="outline">UDP {entryPoint.udpTimeout}</Badge> : null}
            </div>
          ])}
        />
        <EntityTable
          title={t("Middlewares", "中间件")}
          empty={t("No HTTP middlewares visible from Traefik yet.", "Traefik 中还没有可见 HTTP 中间件。")}
          columns={[t("Name", "名称"), t("Usage", "使用情况"), t("Status", "状态")]}
          rows={middlewares.map((middleware) => [
            middleware.name,
            `${middleware.type || t("unknown", "未知")} · ${t("used by", "被使用于")} ${middleware.usedBy.length ? middleware.usedBy.join(", ") : t("no routers", "无路由")}`,
            <div className="flex flex-wrap gap-1" key={`${middleware.name}-status`}>
              <StatusBadge status={middleware.status} />
              {middleware.provider ? <Badge variant="outline">{middleware.provider}</Badge> : null}
            </div>
          ])}
        />
      </div>

      <Card className="bg-card/80">
        <CardHeader>
          <CardDescription>{t("Providers and feature flags", "Provider 与功能开关")}</CardDescription>
          <CardTitle>{providers.length ? providers.join(" / ") : t("Unknown", "未知")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <InfoTile label={t("Metrics", "指标")} value={features.metrics || t("Disabled", "已停用")} />
          <InfoTile label={t("Tracing", "链路追踪")} value={features.tracing || t("Disabled", "已停用")} />
          <InfoTile label={t("Access log", "访问日志")} value={features.accessLog ? t("Enabled", "已启用") : t("Disabled", "已停用")} />
          {protocolSummaries.map((summary) => (
            <InfoTile key={summary.protocol} label={summary.protocol} value={String(summary.total)} caption={t(`${summary.warnings} warnings · ${summary.errors} errors`, `${summary.warnings} 个警告 · ${summary.errors} 个错误`)} />
          ))}
        </CardContent>
      </Card>

      <HistoryTable
        history={dashboard.history}
        rollingBackId={rollingBackId}
        rollbackError={rollbackError}
        onRollback={handleRollback}
      />

      <Card className="bg-card/80">
        <CardHeader>
          <div className="grid gap-3 md:flex md:items-center md:justify-between">
            <div className="grid min-w-0 gap-1">
              <CardDescription>{t("Generated file-provider config", "生成的 file-provider 配置")}</CardDescription>
              <CardTitle className="flex items-center gap-2">
                <FileCode2 className="size-5" />
                {t("Traefik YAML preview", "Traefik YAML 预览")}
              </CardTitle>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void loadGeneratedConfig()} disabled={configLoading}>
                <RefreshCw className={configLoading ? "size-4 animate-spin" : "size-4"} />
                {t("Refresh", "刷新")}
              </Button>
              <Button type="button" variant="outline" onClick={() => void handleCopy()} disabled={!generatedConfig}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? t("Copied", "已复制") : t("Copy", "复制")}
              </Button>
              <Button type="button" variant="outline" onClick={handleDownload} disabled={!generatedConfig}>
                <Download className="size-4" />
                YAML
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <InfoTile label={t("Routers", "路由")} value={String(configStats.routers)} />
            <InfoTile label={t("Services", "服务")} value={String(configStats.services)} />
            <InfoTile label={t("TLS certs", "TLS 证书")} value={String(configStats.certificates)} />
            <InfoTile label={t("Size", "大小")} value={`${configStats.bytes} B`} />
          </div>
          {configError ? <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{configError}</div> : null}
          {configLoading && !generatedConfig ? <div className="rounded-xl border bg-background/40 p-3 text-sm text-muted-foreground">{t("Loading generated Traefik YAML...", "正在加载生成的 Traefik YAML...")}</div> : null}
          <pre className="yaml-scroll max-h-[460px] overflow-auto rounded-xl border bg-background/70 p-4 text-xs leading-relaxed text-muted-foreground">{generatedConfig || t("Generated config will appear here after GateLite writes runtime/traefik/gatelite.yml.", "GateLite 写入 runtime/traefik/gatelite.yml 后，生成配置会显示在这里。")}</pre>
        </CardContent>
      </Card>

      <Card className="bg-card/80">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCode2 className="size-5" />
            {t("Raw data snapshot", "原始数据快照")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="yaml-scroll max-h-[420px] overflow-auto rounded-xl border bg-background/70 p-4 text-xs leading-relaxed text-muted-foreground">{JSON.stringify(runtime.rawData || runtime.overview || {}, null, 2)}</pre>
        </CardContent>
      </Card>
    </section>
  );
}

function HistoryTable({
  history,
  rollingBackId,
  rollbackError,
  onRollback
}: {
  history: GateLiteHistoryEvent[];
  rollingBackId: string | null;
  rollbackError: string | null;
  onRollback: (event: GateLiteHistoryEvent) => Promise<void>;
}) {
  const { t } = useLanguage();
  const rows = history.slice(0, 12);

  return (
    <Card className="bg-card/80">
      <CardHeader>
        <div className="grid gap-1">
          <CardDescription>{t("Config history", "配置历史")}</CardDescription>
          <CardTitle>{t("Rollback-ready changes", "可回滚的变更记录")}</CardTitle>
          <CardDescription>{t("Every successful GateLite write stores the previous state before regenerating Traefik file-provider config.", "每次 GateLite 成功写入都会先保存旧状态，再重新生成 Traefik file-provider 配置。")}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {rollbackError ? <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{rollbackError}</div> : null}
        {rows.length ? (
          <div className="overflow-x-auto rounded-xl border">
            <Table className="min-w-[780px]">
              <TableHeader className="bg-muted/65">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-44">{t("Time", "时间")}</TableHead>
                  <TableHead className="w-44">{t("Action", "动作")}</TableHead>
                  <TableHead>{t("Summary", "摘要")}</TableHead>
                  <TableHead className="w-28 text-right">{t("Rollback", "回滚")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{formatHistoryTime(event.at)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="rounded-md font-mono text-[11px]">
                        {event.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[520px] truncate text-sm text-muted-foreground">{event.summary}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!event.rollbackAvailable || rollingBackId === event.id}
                        onClick={() => void onRollback(event)}
                      >
                        <RotateCcw className={rollingBackId === event.id ? "size-3.5 animate-spin" : "size-3.5"} />
                        {t("Rollback", "回滚")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">{t("No config changes recorded yet.", "还没有配置变更记录。")}</div>
        )}
      </CardContent>
    </Card>
  );
}

function RuntimeStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <Card className="bg-card/70">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          {icon}
          {label}
        </CardDescription>
        <CardTitle className="truncate text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function EntityTable({ title, empty, columns, rows }: { title: string; empty: string; columns: string[]; rows: Array<Array<ReactNode>> }) {
  return (
    <Card className="bg-card/80">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <TableCell key={cellIndex} className={cellIndex === 0 ? "font-medium" : "max-w-[460px] whitespace-normal text-muted-foreground"}>
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">{empty}</div>
        )}
      </CardContent>
    </Card>
  );
}

function InfoTile({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <div className="rounded-xl border bg-background/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {caption ? <div className="mt-1 text-xs text-muted-foreground">{caption}</div> : null}
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

function formatHistoryTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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
