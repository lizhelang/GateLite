import { Activity, Globe2, Languages, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { getDashboard } from "./api";
import { TrafficOverview } from "./components/TrafficOverview";
import { useLanguage } from "./i18n";
import { CertificatesPage } from "./pages/CertificatesPage";
import { RuntimePage } from "./pages/RuntimePage";
import { WebServicesPage } from "./pages/WebServicesPage";
import type { DashboardPayload } from "../shared/types";

type ViewKey = "web" | "certificates" | "runtime";

const views: Array<{ key: ViewKey; label: { en: string; zh: string }; icon: typeof Globe2 }> = [
  { key: "web", label: { en: "Web Services", zh: "Web 服务" }, icon: Globe2 },
  { key: "certificates", label: { en: "SSL/TLS", zh: "SSL/TLS 证书" }, icon: ShieldCheck },
  { key: "runtime", label: { en: "Traefik Runtime", zh: "Traefik 运行时" }, icon: Activity }
];

export function App() {
  const { language, t, toggleLanguage } = useLanguage();
  const [activeView, setActiveView] = useState<ViewKey>("web");
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

  return (
    <div className="app-shell">
      <div className="story-watermark">GATELITE</div>
      <div className="story-grid" />
      <header className="topbar">
        <div className="brand-mark">
          <span className="brand-glyph">GL</span>
          <div>
            <h1>GateLite</h1>
            <p>{t("Simple, agent-friendly control panel for Traefik", "简单、适合 agent 使用的 Traefik 控制面板")}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="refresh-button" type="button" onClick={toggleLanguage} aria-label={t("Switch language", "切换语言")}>
            <Languages size={16} />
            {language === "en" ? "中文" : "EN"}
          </button>
          <button className="refresh-button" type="button" onClick={() => void load()}>
            <RefreshCw size={16} />
            {t("Refresh", "刷新")}
          </button>
        </div>
      </header>

      <div className="app-layout">
        <aside className="side-nav" aria-label={t("Primary", "主导航")}>
          <p className="side-nav-label">{t("Control planes", "控制面")}</p>
          <nav>
            {views.map((view, index) => {
              const Icon = view.icon;
              return (
                <button key={view.key} className={activeView === view.key ? "nav-item active" : "nav-item"} onClick={() => setActiveView(view.key)}>
                  <span className="nav-index">{String(index + 1).padStart(2, "0")}</span>
                  <Icon size={18} />
                  <span>{t(view.label.en, view.label.zh)}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="story-main">
          <TrafficOverview dashboard={dashboard} loading={loading} />

          {error ? <div className="notice error">{error}</div> : null}
          {loading && !dashboard ? <div className="notice">{t("Loading GateLite state and Traefik runtime...", "正在加载 GateLite 状态和 Traefik 运行时...")}</div> : null}

          {dashboard ? (
            <>
              {activeView === "web" ? <WebServicesPage dashboard={dashboard} onRefresh={load} /> : null}
              {activeView === "certificates" ? <CertificatesPage dashboard={dashboard} onRefresh={load} /> : null}
              {activeView === "runtime" ? <RuntimePage runtime={dashboard.runtime} /> : null}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
