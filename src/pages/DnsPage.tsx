import { AlertTriangle, CheckCircle2, Cloud, CloudCog, RefreshCw, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DnsManagedRecordStatus, DnsRecordStatus, DnsStatus } from "../../shared/types";
import { getDnsStatus, syncDnsNow } from "../api";
import { StatusBadge } from "../components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLanguage } from "../i18n";
import { cn } from "@/lib/utils";

export function DnsPage() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<DnsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await getDnsStatus());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("Unable to load DNS status.", "无法加载 DNS 状态。"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const runSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      setStatus(await syncDnsNow());
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : t("DNS sync failed.", "DNS 同步失败。"));
    } finally {
      setSyncing(false);
    }
  };

  const summary = useMemo(() => summarizeRecords(status?.records || []), [status]);

  return (
    <section className="grid min-w-0 gap-4">
      {error ? <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

      <div className="grid min-w-0 gap-3 overflow-hidden rounded-xl border bg-card/70 p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <CloudCog className="size-4" />
              {t("Cloudflare DNS/DDNS", "Cloudflare DNS/DDNS")}
            </div>
            <h2 className="text-xl font-semibold tracking-tight">{t("Managed DNS records", "托管 DNS 记录")}</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {t(
                "GateLite updates only the declared allowlist of Cloudflare records and leaves CNAME delegation in place.",
                "GateLite 只更新声明过的 Cloudflare 记录，并保留现有 CNAME 委派。"
              )}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || syncing}>
              <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
              {t("Refresh", "刷新")}
            </Button>
            <Button size="sm" onClick={() => void runSync()} disabled={!status?.enabled || loading || syncing}>
              <Cloud className={syncing ? "size-4 animate-pulse" : "size-4"} />
              {t("Sync now", "立即同步")}
            </Button>
          </div>
        </div>

        <div className="grid min-w-0 gap-3 [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]">
          <SummaryTile label={t("DNS management", "DNS 管理")} value={status?.enabled ? t("Enabled", "已启用") : t("Disabled", "未启用")} tone={status?.enabled ? "good" : "muted"} />
          <SummaryTile label={t("Current IPv4", "当前 IPv4")} value={status?.currentIpv4 || t("Unavailable", "不可用")} tone={status?.currentIpv4 ? "good" : "warn"} />
          <SummaryTile label={t("Records", "记录")} value={`${summary.ok}/${status?.records.length || 0}`} detail={t("matching desired state", "已匹配声明状态")} tone={summary.blocked || summary.failed ? "warn" : "good"} />
          <SummaryTile label={t("Interval", "间隔")} value={`${status?.intervalSeconds || 0}s`} detail={status?.currentIpv4Source || t("No IP source yet", "尚无 IP 来源")} tone="muted" />
        </div>

        {status?.lastSync ? (
          <div className="min-w-0 rounded-lg border bg-background/60 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-300" />
              <span className="font-medium">{t("Last sync", "上次同步")}</span>
              <span className="text-muted-foreground">{new Date(status.lastSync.at).toLocaleString()}</span>
              <Badge variant="outline">{t(`${status.lastSync.created} created`, `创建 ${status.lastSync.created}`)}</Badge>
              <Badge variant="outline">{t(`${status.lastSync.updated} updated`, `更新 ${status.lastSync.updated}`)}</Badge>
              <Badge variant="outline">{t(`${status.lastSync.blocked} blocked`, `阻塞 ${status.lastSync.blocked}`)}</Badge>
              <Badge variant="outline">{t(`${status.lastSync.failed} failed`, `失败 ${status.lastSync.failed}`)}</Badge>
            </div>
          </div>
        ) : null}
      </div>

      {status?.warnings.length ? (
        <div className="grid gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-100">
          <div className="flex items-center gap-2 font-medium">
            <ShieldAlert className="size-4" />
            {t("DNS warnings", "DNS 警告")}
          </div>
          {status.warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}

      <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <section className="min-w-0 rounded-xl border bg-card/70 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t("Cloudflare zones", "Cloudflare 区域")}</h3>
            {loading ? <RefreshCw className="size-4 animate-spin text-muted-foreground" /> : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-1">
            {(status?.zones || []).map((zone) => (
              <div key={zone.zoneName} className="rounded-lg border bg-background/55 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-mono text-sm">{zone.zoneName}</span>
                  <StatusBadge status={zone.status} />
                </div>
                <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                  <span>{zone.tokenConfigured ? t("Token configured", "Token 已配置") : t("Token missing", "Token 缺失")}</span>
                  {zone.error ? <span className="text-amber-700 dark:text-amber-200">{zone.error}</span> : null}
                </div>
              </div>
            ))}
            {!loading && !status?.zones.length ? <div className="text-sm text-muted-foreground">{t("No zones configured.", "尚未配置区域。")}</div> : null}
          </div>
        </section>

        <section className="min-w-0 overflow-hidden rounded-xl border bg-card/70 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t("Record plan", "记录计划")}</h3>
            <Badge variant="outline">{status?.provider || "cloudflare"}</Badge>
          </div>
          <Table className="min-w-[58rem] table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[22%]">{t("Record", "记录")}</TableHead>
                <TableHead className="w-[24%]">{t("Desired", "目标")}</TableHead>
                <TableHead className="w-[24%]">{t("Current", "当前")}</TableHead>
                <TableHead className="w-[30%]">{t("State", "状态")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(status?.records || []).map((record) => (
                <RecordRow key={`${record.zoneName}:${record.type}:${record.name}`} record={record} />
              ))}
              {!loading && !status?.records.length ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    {t("No managed records declared.", "尚未声明托管记录。")}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </section>
      </div>
    </section>
  );
}

function RecordRow({ record }: { record: DnsManagedRecordStatus }) {
  const { t } = useLanguage();
  return (
    <TableRow>
      <TableCell className="whitespace-normal">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {record.type}
            </Badge>
            <span className="break-all font-mono text-xs sm:text-sm">{record.name}</span>
          </div>
          <span className="text-xs text-muted-foreground">{record.zoneName}</span>
        </div>
      </TableCell>
      <TableCell className="whitespace-normal">
        <RecordValue content={record.desiredContent} proxied={record.proxied} ttl={record.ttl} comment={record.comment} />
      </TableCell>
      <TableCell className="whitespace-normal">
        {record.currentContent ? (
          <RecordValue content={record.currentContent} proxied={record.currentProxied} ttl={record.currentTtl} comment={record.currentComment} muted />
        ) : (
          <span className="text-sm text-muted-foreground">{t("Missing", "缺失")}</span>
        )}
      </TableCell>
      <TableCell className="whitespace-normal">
        <div className="grid gap-1">
          <DnsRecordBadge status={record.status} />
          <span className="max-w-[26rem] text-xs text-muted-foreground">{recordMessage(record, t)}</span>
        </div>
      </TableCell>
    </TableRow>
  );
}

function RecordValue({ content, proxied, ttl, comment, muted = false }: { content: string; proxied?: boolean; ttl?: number; comment?: string; muted?: boolean }) {
  const { t } = useLanguage();
  return (
    <div className={cn("grid gap-1 text-xs", muted ? "text-muted-foreground" : "text-foreground")}>
      <span className="break-all font-mono">{content}</span>
      <span className="flex flex-wrap gap-1">
        {typeof proxied === "boolean" ? <Badge variant="outline">{proxied ? t("proxied", "代理") : t("DNS only", "仅 DNS")}</Badge> : null}
        {ttl ? <Badge variant="outline">TTL {ttl}</Badge> : null}
      </span>
      {comment ? <span className="max-w-[24rem] truncate text-muted-foreground">{comment}</span> : null}
    </div>
  );
}

function DnsRecordBadge({ status }: { status: DnsRecordStatus }) {
  const { t } = useLanguage();
  const labels: Record<DnsRecordStatus, string> = {
    ok: t("ok", "正常"),
    missing: t("missing", "缺失"),
    "needs-update": t("needs update", "需更新"),
    conflict: t("conflict", "冲突"),
    error: t("error", "错误"),
    unknown: t("unknown", "未知")
  };
  const className: Record<DnsRecordStatus, string> = {
    ok: "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-200",
    missing: "border-sky-500/35 bg-sky-500/10 text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-200",
    "needs-update": "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200",
    conflict: "border-red-500/35 bg-red-500/10 text-red-700 dark:border-red-400/40 dark:bg-red-400/10 dark:text-red-200",
    error: "border-red-500/35 bg-red-500/10 text-red-700 dark:border-red-400/40 dark:bg-red-400/10 dark:text-red-200",
    unknown: "border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:border-zinc-400/30 dark:bg-zinc-400/10 dark:text-zinc-300"
  };
  return (
    <Badge variant="outline" className={className[status]}>
      {status === "ok" ? <CheckCircle2 className="size-3" /> : status === "conflict" || status === "error" ? <AlertTriangle className="size-3" /> : null}
      {labels[status]}
    </Badge>
  );
}

function SummaryTile({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone: "good" | "warn" | "muted" }) {
  return (
    <div className={cn("rounded-lg border bg-background/55 p-3", tone === "good" && "border-emerald-500/20", tone === "warn" && "border-amber-500/30")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-lg font-semibold">{value}</div>
      {detail ? <div className="mt-1 truncate text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

function summarizeRecords(records: DnsManagedRecordStatus[]) {
  return records.reduce(
    (summary, record) => {
      if (record.status === "ok") summary.ok += 1;
      if (record.status === "conflict") summary.blocked += 1;
      if (record.status === "error") summary.failed += 1;
      return summary;
    },
    { ok: 0, blocked: 0, failed: 0 }
  );
}

function actionLabel(action: DnsManagedRecordStatus["action"], t: (english: string, chinese: string) => string) {
  const labels: Record<DnsManagedRecordStatus["action"], string> = {
    none: t("No change needed.", "无需变更。"),
    create: t("Will create this record.", "将创建这条记录。"),
    update: t("Will update this record.", "将更新这条记录。"),
    blocked: t("Blocked until the conflict is resolved.", "冲突解决前不会执行。")
  };
  return labels[action];
}

function recordMessage(record: DnsManagedRecordStatus, t: (english: string, chinese: string) => string) {
  if (record.status === "ok") return t("Record matches the GateLite declaration.", "记录已匹配 GateLite 声明。");
  if (record.status === "missing") return t("Record is missing in Cloudflare.", "Cloudflare 中缺少这条记录。");
  if (record.status === "needs-update") return t("Record differs from the GateLite declaration.", "当前记录与 GateLite 声明不一致。");
  if (record.status === "conflict") return t("Conflict detected. GateLite will not overwrite it automatically.", "存在冲突，GateLite 不会自动覆盖。");
  if (record.status === "error") return record.message || t("DNS status could not be evaluated.", "无法评估这条 DNS 记录。");
  return record.message || actionLabel(record.action, t);
}
