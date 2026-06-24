import { Activity, Globe2, Languages, LayoutDashboard, RefreshCw, ShieldCheck, TerminalSquare, type LucideIcon } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import type { DashboardPayload } from "../shared/types";
import { getDashboard } from "./api";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger
} from "@/components/ui/sidebar";
import { useLanguage } from "./i18n";
import { CertificatesPage } from "./pages/CertificatesPage";
import { DashboardPage } from "./pages/DashboardPage";
import { RuntimePage } from "./pages/RuntimePage";
import { WebServicesPage } from "./pages/WebServicesPage";

type ViewKey = "dashboard" | "web" | "certificates" | "runtime";

const views: Array<{ key: ViewKey; label: { en: string; zh: string }; description: { en: string; zh: string }; icon: LucideIcon }> = [
  {
    key: "dashboard",
    label: { en: "Dashboard", zh: "仪表盘" },
    description: { en: "Traffic, status, runtime summary", zh: "流量、状态、运行摘要" },
    icon: LayoutDashboard
  },
  {
    key: "web",
    label: { en: "Web Services", zh: "Web 服务" },
    description: { en: "Reverse proxy rules", zh: "反代规则" },
    icon: Globe2
  },
  {
    key: "certificates",
    label: { en: "SSL/TLS", zh: "SSL/TLS 证书" },
    description: { en: "Certificates and bindings", zh: "证书与绑定关系" },
    icon: ShieldCheck
  },
  {
    key: "runtime",
    label: { en: "Traefik Runtime", zh: "Traefik 运行时" },
    description: { en: "Routers, services, providers", zh: "路由、服务、Provider" },
    icon: Activity
  }
];

export function App() {
  const { language, t, toggleLanguage } = useLanguage();
  const [activeView, setActiveView] = useState<ViewKey>("dashboard");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setDashboard(await getDashboard());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("Unable to load GateLite dashboard.", "无法加载 GateLite 控制台。"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const active = views.find((view) => view.key === activeView) || views[0];

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "18rem",
          "--header-height": "3.5rem"
        } as CSSProperties
      }
    >
      <GateLiteSidebar activeView={activeView} onViewChange={setActiveView} dashboard={dashboard} />
      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background/80 backdrop-blur-xl">
          <div className="flex w-full items-center gap-2 px-4 lg:px-6">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">{t(active.description.en, active.description.zh)}</p>
              <h1 className="truncate text-base font-medium">{t(active.label.en, active.label.zh)}</h1>
            </div>
            <Button variant="outline" size="sm" onClick={toggleLanguage} aria-label={t("Switch language", "切换语言")}>
              <Languages className="size-4" />
              {language === "en" ? "中文" : "EN"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
              <span className="hidden sm:inline">{t("Refresh", "刷新")}</span>
            </Button>
          </div>
        </header>

        <main className="gate-grid @container/main flex min-h-svh flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
          {error ? <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
          {loading && !dashboard ? <div className="rounded-xl border bg-card/70 p-4 text-sm text-muted-foreground">{t("Loading GateLite state and Traefik runtime...", "正在加载 GateLite 状态和 Traefik 运行时...")}</div> : null}

          {activeView === "dashboard" ? <DashboardPage dashboard={dashboard} loading={loading} /> : null}
          {dashboard && activeView === "web" ? <WebServicesPage dashboard={dashboard} onRefresh={load} /> : null}
          {dashboard && activeView === "certificates" ? <CertificatesPage dashboard={dashboard} onRefresh={load} /> : null}
          {dashboard && activeView === "runtime" ? <RuntimePage runtime={dashboard.runtime} /> : null}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function GateLiteSidebar({
  activeView,
  onViewChange,
  dashboard
}: {
  activeView: ViewKey;
  onViewChange: (view: ViewKey) => void;
  dashboard: DashboardPayload | null;
}) {
  const { t } = useLanguage();
  return (
    <Sidebar collapsible="offcanvas" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="gap-3">
              <span className="flex size-9 items-center justify-center rounded-lg border border-cyan-300/40 bg-cyan-300/10 text-sm font-black text-cyan-100">GL</span>
              <span className="grid min-w-0">
                <span className="truncate text-base font-semibold">GateLite</span>
                <span className="truncate text-xs text-muted-foreground">{t("Traefik control plane", "Traefik 控制面")}</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {views.map((view, index) => {
            const Icon = view.icon;
            return (
              <SidebarMenuItem key={view.key}>
                <SidebarMenuButton isActive={activeView === view.key} onClick={() => onViewChange(view.key)} tooltip={t(view.label.en, view.label.zh)}>
                  <span className="w-5 text-xs font-semibold text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                  <Icon />
                  <span>{t(view.label.en, view.label.zh)}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <div className="rounded-xl border bg-card/60 p-3 text-xs text-muted-foreground">
          <div className="mb-2 flex items-center gap-2 text-foreground">
            <TerminalSquare className="size-4" />
            {t("Local runtime", "本地运行时")}
          </div>
          <div className="grid gap-1">
            <span>{dashboard?.runtime.version ? `Traefik ${dashboard.runtime.version}` : t("Waiting for API", "等待 API")}</span>
            <span>{dashboard?.runtime.apiUrl || "http://localhost:18081"}</span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
