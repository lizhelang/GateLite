import { ChartSpline, Clock3, Gauge, Globe2, Route, ShieldCheck } from "lucide-react";
import type { CertificateWithBindings, DashboardPayload, WebServiceWithRuntime } from "../../shared/types";

interface TrafficOverviewProps {
  dashboard: DashboardPayload | null;
  loading: boolean;
}

type Series = {
  domain: string;
  color: string;
  values: number[];
  total: number;
};

const palette = ["#37d6c2", "#f39c12", "#e94560", "#8fb7ff", "#63d471"];
const chartWidth = 760;
const chartHeight = 254;
const chartPadding = { top: 20, right: 28, bottom: 34, left: 38 };

export function TrafficOverview({ dashboard, loading }: TrafficOverviewProps) {
  const services = dashboard?.webServices || [];
  const certificates = dashboard?.certificates || [];
  const domains = uniqueDomains(services);
  const series = buildTrafficSeries(services);
  const chart = buildChart(series);
  const routeTotals = getRouteTotals(dashboard);
  const tlsCoverage = getTlsCoverage(services, domains.length);
  const certSummary = getCertificateSummary(certificates);
  const entryPoints = Array.from(new Set(services.flatMap((service) => service.entryPoints))).filter(Boolean);

  return (
    <section className="visual-stage" aria-label="GateLite overview">
      <div className="overview-panel traffic-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Local Traefik companion</p>
            <h2>Reverse proxy traffic</h2>
          </div>
          <span className={dashboard?.runtime.connected ? "live-pill online" : "live-pill offline"}>
            <Gauge size={15} />
            {dashboard?.runtime.connected ? "Live runtime" : loading ? "Connecting" : "Offline"}
          </span>
        </div>

        <svg className="traffic-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Preset traffic line chart for managed domains">
          <defs>
            <linearGradient id="trafficFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#37d6c2" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#37d6c2" stopOpacity="0" />
            </linearGradient>
          </defs>
          {chart.gridY.map((y) => (
            <line key={`y-${y}`} className="chart-grid-line" x1={chartPadding.left} x2={chartWidth - chartPadding.right} y1={y} y2={y} />
          ))}
          {chart.gridX.map((x) => (
            <line key={`x-${x}`} className="chart-grid-line soft" x1={x} x2={x} y1={chartPadding.top} y2={chartHeight - chartPadding.bottom} />
          ))}
          {chart.primaryArea ? <path className="chart-area" d={chart.primaryArea} /> : null}
          {chart.lines.map((line) => (
            <path key={line.domain} className="chart-line" d={line.path} stroke={line.color} />
          ))}
          {chart.dots.map((dot) => (
            <circle key={`${dot.domain}-${dot.x}-${dot.y}`} className="chart-dot" cx={dot.x} cy={dot.y} r="3.4" fill={dot.color} />
          ))}
          <text className="axis-label" x={chartPadding.left} y={chartHeight - 10}>
            last 12 intervals
          </text>
          <text className="axis-label" x={chartWidth - chartPadding.right} y={chartHeight - 10} textAnchor="end">
            req/min preview
          </text>
        </svg>

        <div className="chart-legend" aria-label="Domains in traffic preset">
          {series.map((item) => (
            <span key={item.domain} className="legend-chip">
              <i style={{ background: item.color }} />
              {item.domain}
              <strong>{item.total}</strong>
            </span>
          ))}
        </div>
      </div>

      <div className="overview-stack">
        <VisualStat icon={Globe2} label="Domains" value={String(domains.length)} caption={`${services.length} managed services`} />
        <VisualStat icon={Route} label="Routers" value={`${routeTotals.online}/${routeTotals.total}`} caption="online in Traefik" progress={routeTotals.total ? routeTotals.online / routeTotals.total : 0} />
        <VisualStat icon={ShieldCheck} label="TLS coverage" value={`${tlsCoverage.secured}/${tlsCoverage.total}`} caption="domains with TLS mode" progress={tlsCoverage.total ? tlsCoverage.secured / tlsCoverage.total : 0} />
        <CertificateRunway summary={certSummary} />
        <div className="preset-strip" aria-label="Entrypoint presets">
          <Clock3 size={16} />
          <span>{entryPoints.length ? entryPoints.join(" / ") : "web / websecure"}</span>
        </div>
      </div>
    </section>
  );
}

function VisualStat({
  icon: Icon,
  label,
  value,
  caption,
  progress
}: {
  icon: typeof Globe2;
  label: string;
  value: string;
  caption: string;
  progress?: number;
}) {
  return (
    <article className="visual-stat">
      <div className="visual-stat-top">
        <Icon size={17} />
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <p>{caption}</p>
      {typeof progress === "number" ? (
        <div className="mini-meter" aria-hidden="true">
          <i style={{ width: `${Math.max(6, Math.min(100, progress * 100))}%` }} />
        </div>
      ) : null}
    </article>
  );
}

function CertificateRunway({ summary }: { summary: ReturnType<typeof getCertificateSummary> }) {
  const total = Math.max(1, summary.total);
  return (
    <article className="visual-stat cert-runway">
      <div className="visual-stat-top">
        <ChartSpline size={17} />
        <span>Certificate runway</span>
      </div>
      <strong>{summary.valid}</strong>
      <p>{summary.expiring + summary.expired + summary.pending} need attention</p>
      <div className="runway-bars" aria-label="Certificate status distribution">
        <i className="valid" style={{ width: `${(summary.valid / total) * 100}%` }} />
        <i className="expiring" style={{ width: `${(summary.expiring / total) * 100}%` }} />
        <i className="expired" style={{ width: `${((summary.expired + summary.pending) / total) * 100}%` }} />
      </div>
    </article>
  );
}

function uniqueDomains(services: WebServiceWithRuntime[]) {
  return Array.from(new Set(services.flatMap((service) => service.domains))).filter(Boolean);
}

function buildTrafficSeries(services: WebServiceWithRuntime[]): Series[] {
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
      domain,
      color: palette[domainIndex % palette.length],
      values,
      total: values.reduce((sum, value) => sum + value, 0)
    };
  });
}

function buildChart(series: Series[]) {
  const allValues = series.flatMap((item) => item.values);
  const max = Math.max(80, ...allValues) + 10;
  const min = Math.max(0, Math.min(...allValues) - 10);
  const drawableWidth = chartWidth - chartPadding.left - chartPadding.right;
  const drawableHeight = chartHeight - chartPadding.top - chartPadding.bottom;
  const toPoint = (value: number, index: number, count: number) => {
    const x = chartPadding.left + (index / Math.max(1, count - 1)) * drawableWidth;
    const y = chartPadding.top + (1 - (value - min) / Math.max(1, max - min)) * drawableHeight;
    return { x, y };
  };
  const pointSets = series.map((item) => ({
    ...item,
    points: item.values.map((value, index) => toPoint(value, index, item.values.length))
  }));
  const lines = pointSets.map((item) => ({
    domain: item.domain,
    color: item.color,
    path: item.points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ")
  }));
  const firstSeries = pointSets[0];
  const primaryArea = firstSeries
    ? `${lines[0].path} L ${firstSeries.points[firstSeries.points.length - 1].x.toFixed(1)} ${(chartHeight - chartPadding.bottom).toFixed(1)} L ${firstSeries.points[0].x.toFixed(1)} ${(chartHeight - chartPadding.bottom).toFixed(1)} Z`
    : "";

  return {
    lines,
    primaryArea,
    dots: pointSets.flatMap((item) =>
      item.points
        .filter((_, index) => index === item.points.length - 1)
        .map((point) => ({ domain: item.domain, color: item.color, x: point.x, y: point.y }))
    ),
    gridY: [0, 1, 2, 3].map((step) => chartPadding.top + (step / 3) * drawableHeight),
    gridX: [0, 1, 2, 3, 4].map((step) => chartPadding.left + (step / 4) * drawableWidth)
  };
}

function getRouteTotals(dashboard: DashboardPayload | null) {
  const routers = dashboard?.runtime.routers || [];
  const total = routers.length || dashboard?.webServices.length || 0;
  const online = routers.length ? routers.filter((router) => router.status === "online").length : dashboard?.webServices.filter((service) => service.runtime?.status === "online").length || 0;
  return { total, online };
}

function getTlsCoverage(services: WebServiceWithRuntime[], domainTotal: number) {
  const secured = new Set(services.filter((service) => service.tls.mode !== "none").flatMap((service) => service.domains)).size;
  return { total: domainTotal, secured };
}

function getCertificateSummary(certificates: CertificateWithBindings[]) {
  return certificates.reduce(
    (summary, certificate) => {
      summary.total += 1;
      if (certificate.status === "valid") summary.valid += 1;
      if (certificate.status === "expiring") summary.expiring += 1;
      if (certificate.status === "expired" || certificate.status === "invalid") summary.expired += 1;
      if (certificate.status === "pending") summary.pending += 1;
      return summary;
    },
    { total: 0, valid: 0, expiring: 0, expired: 0, pending: 0 }
  );
}

function hashDomain(domain: string) {
  return domain.split("").reduce((value, character) => value + character.charCodeAt(0), 0);
}
