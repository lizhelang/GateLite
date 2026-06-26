import type { DashboardPayload } from "../../shared/types";
import { TrafficOverview } from "../components/TrafficOverview";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "../i18n";
import { RuntimePage } from "./RuntimePage";

interface DashboardPageProps {
  dashboard: DashboardPayload | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
}

export function DashboardPage({ dashboard, loading, onRefresh }: DashboardPageProps) {
  const { t } = useLanguage();
  const serviceCount = dashboard?.webServices.length || 0;
  const certificateCount = dashboard?.certificates.length || 0;
  const connected = dashboard?.runtime.connected;

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-cyan-700/80 dark:text-cyan-200/80">{t("Local Traefik companion", "本地 Traefik 伴侣面板")}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">GateLite</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge
            variant="outline"
            className={
              connected
                ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-200"
                : "border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:border-zinc-400/30 dark:bg-zinc-400/10 dark:text-zinc-300"
            }
          >
            {connected ? t("Traefik connected", "Traefik 已连接") : loading ? t("Connecting", "连接中") : t("Traefik offline", "Traefik 离线")}
          </Badge>
          <Badge variant="outline">{t(`${serviceCount} services`, `${serviceCount} 个服务`)}</Badge>
          <Badge variant="outline">{t(`${certificateCount} certificates`, `${certificateCount} 张证书`)}</Badge>
        </div>
      </div>

      <TrafficOverview dashboard={dashboard} loading={loading} />

      {dashboard ? <RuntimePage dashboard={dashboard} onRefresh={onRefresh} embedded /> : null}
    </section>
  );
}
