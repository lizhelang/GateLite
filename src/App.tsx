import { Activity, Globe2, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { getDashboard } from "./api";
import { TrafficOverview } from "./components/TrafficOverview";
import { CertificatesPage } from "./pages/CertificatesPage";
import { RuntimePage } from "./pages/RuntimePage";
import { WebServicesPage } from "./pages/WebServicesPage";
import type { DashboardPayload } from "../shared/types";

type ViewKey = "web" | "certificates" | "runtime";

const views: Array<{ key: ViewKey; label: string; icon: typeof Globe2 }> = [
  { key: "web", label: "Web Services", icon: Globe2 },
  { key: "certificates", label: "SSL/TLS", icon: ShieldCheck },
  { key: "runtime", label: "Traefik Runtime", icon: Activity }
];

export function App() {
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
      setError(loadError instanceof Error ? loadError.message : "Unable to load GateLite dashboard.");
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
            <p>Simple, agent-friendly control panel for Traefik</p>
          </div>
        </div>
        <button className="refresh-button" type="button" onClick={() => void load()}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </header>

      <div className="app-layout">
        <aside className="side-nav" aria-label="Primary">
          <p className="side-nav-label">Control planes</p>
          <nav>
            {views.map((view, index) => {
              const Icon = view.icon;
              return (
                <button key={view.key} className={activeView === view.key ? "nav-item active" : "nav-item"} onClick={() => setActiveView(view.key)}>
                  <span className="nav-index">{String(index + 1).padStart(2, "0")}</span>
                  <Icon size={18} />
                  <span>{view.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="story-main">
          <TrafficOverview dashboard={dashboard} loading={loading} />

          {error ? <div className="notice error">{error}</div> : null}
          {loading && !dashboard ? <div className="notice">Loading GateLite state and Traefik runtime...</div> : null}

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
