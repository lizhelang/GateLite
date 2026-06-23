import { Activity, ChartSpline, Clock3, Globe2, Route, ShieldCheck } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis } from "recharts";
import type { CertificateWithBindings, DashboardPayload, TrafficOverview as TrafficOverviewData, WebServiceWithRuntime } from "../../shared/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useLanguage } from "../i18n";

interface TrafficOverviewProps {
  dashboard: DashboardPayload | null;
  loading: boolean;
}

type Series = {
  key: string;
  domain: string;
  color: string;
  values: number[];
  total: number;
  source: "prometheus" | "preview";
};

const palette = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export function TrafficOverview({ dashboard, loading }: TrafficOverviewProps) {
  const { t } = useLanguage();
  const services = dashboard?.webServices || [];
  const certificates = dashboard?.certificates || [];
  const domains = uniqueDomains(services);
  const series = buildTrafficSeries(services, dashboard?.traffic);
  const routeTotals = getRouteTotals(dashboard);
  const tlsCoverage = getTlsCoverage(services, domains.length);
  const certSummary = getCertificateSummary(certificates);
  const entryPoints = Array.from(new Set(services.flatMap((service) => service.entryPoints))).filter(Boolean);
  const hasPrometheusTraffic = series.some((item) => item.source === "prometheus");
  const chartConfig = Object.fromEntries(
    series.map((item) => [
      item.key,
      {
        label: item.domain,
        color: item.color
      }
    ])
  ) satisfies ChartConfig;
  const chartData = Array.from({ length: 12 }, (_, index) => ({
    interval: String(index + 1).padStart(2, "0"),
    ...Object.fromEntries(series.map((item) => [item.key, item.values[index] ?? 0]))
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.55fr)]">
      <Card className="bg-card/80 shadow-xs">
        <CardHeader className="border-b">
          <CardDescription>{t("Local Traefik companion", "本地 Traefik 伴侣面板")}</CardDescription>
          <CardTitle className="text-2xl">{t("Reverse proxy traffic", "反代域名流量")}</CardTitle>
          <CardAction>
            <Badge variant="outline" className="gap-1 border-cyan-300/40 bg-cyan-300/10 text-cyan-100">
              <Activity className="size-3.5" />
              {hasPrometheusTraffic ? t("Prometheus metrics", "Prometheus 指标") : dashboard?.runtime.connected ? t("Preview data", "预览数据") : loading ? t("Connecting", "连接中") : t("Offline", "离线")}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="pt-4">
          <ChartContainer config={chartConfig} className="h-[260px] w-full">
            <LineChart accessibilityLayer data={chartData} margin={{ left: 8, right: 18, top: 12, bottom: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="interval" tickLine={false} axisLine={false} tickMargin={8} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
              {series.map((item) => (
                <Line key={item.key} dataKey={item.key} type="monotone" stroke={`var(--color-${item.key})`} strokeWidth={2.5} dot={false} />
              ))}
            </LineChart>
          </ChartContainer>
          <div className="mt-4 flex flex-wrap gap-2" aria-label={t("Domains in traffic chart", "流量图中的域名")}>
            {series.map((item) => (
              <Badge key={item.key} variant="outline" className="gap-2 bg-background/40">
                <span className="size-2 rounded-full" style={{ background: item.color }} />
                {item.domain}
                <span className="text-muted-foreground">{item.total}</span>
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <MetricCard icon={Globe2} label={t("Domains", "域名")} value={String(domains.length)} caption={t(`${services.length} managed services`, `${services.length} 个托管服务`)} />
        <MetricCard icon={Route} label={t("Routers", "路由")} value={`${routeTotals.online}/${routeTotals.total}`} caption={t("online in Traefik", "在 Traefik 中在线")} />
        <MetricCard icon={ShieldCheck} label={t("TLS coverage", "TLS 覆盖")} value={`${tlsCoverage.secured}/${tlsCoverage.total}`} caption={t("domains with TLS mode", "个域名启用 TLS 模式")} />
        <MetricCard icon={ChartSpline} label={t("Certificate runway", "证书有效期")} value={String(certSummary.valid)} caption={t(`${certSummary.expiring + certSummary.expired + certSummary.pending} need attention`, `${certSummary.expiring + certSummary.expired + certSummary.pending} 个需要关注`)} />
        <Card className="bg-card/70 sm:col-span-2 lg:col-span-1">
          <CardHeader className="flex-row items-center gap-3">
            <Clock3 className="size-4 text-muted-foreground" />
            <div>
              <CardDescription>{t("Entrypoint presets", "入口点预设")}</CardDescription>
              <CardTitle className="text-base">{entryPoints.length ? entryPoints.join(" / ") : "web / websecure"}</CardTitle>
            </div>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  caption
}: {
  icon: typeof Globe2;
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <Card className="bg-card/70">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon className="size-4" />
          {label}
        </CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
        <CardDescription>{caption}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function uniqueDomains(services: WebServiceWithRuntime[]) {
  return Array.from(new Set(services.flatMap((service) => service.domains))).filter(Boolean);
}

function buildTrafficSeries(services: WebServiceWithRuntime[], traffic: TrafficOverviewData | undefined): Series[] {
  if (traffic?.connected && traffic.series.length) {
    return traffic.series.slice(0, 5).map((item, index) => ({
      key: `series${index + 1}`,
      domain: item.domain,
      color: palette[index % palette.length],
      values: normalizeMeasuredValues(item.points.map((point) => point.value), item.totalRequests),
      total: item.totalRequests,
      source: "prometheus"
    }));
  }

  const domains = uniqueDomains(services).slice(0, 5);
  const visibleDomains = domains.length ? domains : ["whoami.localhost", "secure.localhost"];

  return visibleDomains.map((domain, domainIndex) => {
    const service = services.find((candidate) => candidate.domains.includes(domain));
    const seed = hashDomain(domain) + (service?.listenPort || 80) + domainIndex * 17;
    const enabledFactor = service?.enabled === false ? 0.42 : 1;
    const tlsFactor = service?.tls.mode && service.tls.mode !== "none" ? 1.18 : 1;
    const values = Array.from({ length: 12 }, (_, point) => {
      const wave = Math.sin((point + seed % 9) / 1.8) * 10;
      const pulse = ((seed * (point + 5)) % 27) + point * (domainIndex + 2);
      return Math.max(6, Math.round((28 + wave + pulse + domainIndex * 9) * enabledFactor * tlsFactor));
    });

    return {
      key: `series${domainIndex + 1}`,
      domain,
      color: palette[domainIndex % palette.length],
      values,
      total: values.reduce((sum, value) => sum + value, 0),
      source: "preview"
    };
  });
}

function normalizeMeasuredValues(values: number[], total: number): number[] {
  const measured = values.length ? values : [total];
  if (measured.length >= 12) return measured.slice(-12).map((value) => Math.max(0, Math.round(value)));
  return Array.from({ length: 12 }, (_, index) => {
    const sourceIndex = Math.min(measured.length - 1, Math.floor((index / 12) * measured.length));
    return Math.max(0, Math.round(measured[sourceIndex] ?? 0));
  });
}

function hashDomain(domain: string) {
  return domain.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function getRouteTotals(dashboard: DashboardPayload | null) {
  const total = dashboard?.runtime.routers.length || 0;
  const online = dashboard?.runtime.routers.filter((router) => router.status === "online").length || 0;
  return { total, online };
}

function getTlsCoverage(services: WebServiceWithRuntime[], domainCount: number) {
  const secured = uniqueDomains(services.filter((service) => service.tls.mode !== "none")).length;
  return { secured, total: domainCount };
}

function getCertificateSummary(certificates: CertificateWithBindings[]) {
  return certificates.reduce(
    (summary, certificate) => {
      summary.total += 1;
      summary[certificate.status] += 1;
      return summary;
    },
    { total: 0, valid: 0, expiring: 0, expired: 0, pending: 0, invalid: 0 } as Record<CertificateWithBindings["status"] | "total", number>
  );
}
