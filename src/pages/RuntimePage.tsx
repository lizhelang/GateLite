import { Activity, Boxes, FileCode2, Network, Server } from "lucide-react";
import type { TraefikRuntime } from "../../shared/types";
import { StatusBadge } from "../components/StatusBadge";

interface RuntimePageProps {
  runtime: TraefikRuntime;
}

export function RuntimePage({ runtime }: RuntimePageProps) {
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

function RuntimeStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="runtime-stat">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

