import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GripVertical,
  Layers,
  Pencil,
  Plus,
  Power,
  Route,
  Save,
  Server,
  Trash2
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import type { DashboardPayload, ServiceGroup, WebServiceWithRuntime } from "../../shared/types";
import {
  createGroup,
  createWebService,
  deleteWebService,
  reorderWebServices,
  toggleWebService,
  updateGroup,
  updateWebService,
  type WebServiceInput
} from "../api";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";

interface WebServicesPageProps {
  dashboard: DashboardPayload;
  onRefresh: () => Promise<void>;
}

type DraftService = {
  name: string;
  enabled: boolean;
  groupId: string;
  domainsText: string;
  listenPort: number;
  entryPointsText: string;
  targetUrl: string;
  middlewaresText: string;
  tlsMode: "none" | "file-certificate" | "resolver";
  certificateId: string;
  resolver: string;
  notes: string;
};

const emptyDraft: DraftService = {
  name: "",
  enabled: true,
  groupId: "local",
  domainsText: "",
  listenPort: 18080,
  entryPointsText: "web",
  targetUrl: "http://whoami:80",
  middlewaresText: "",
  tlsMode: "none",
  certificateId: "",
  resolver: "letsencrypt",
  notes: ""
};

export function WebServicesPage({ dashboard, onRefresh }: WebServicesPageProps) {
  const [editing, setEditing] = useState<WebServiceWithRuntime | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState(dashboard.webServices[0]?.id || "");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = dashboard.webServices.find((service) => service.id === selectedId) || dashboard.webServices[0];
  const sortedServices = [...dashboard.webServices].sort((a, b) => a.order - b.order);

  const grouped = useMemo(() => {
    const byGroup = new Map<string, WebServiceWithRuntime[]>();
    for (const service of sortedServices) {
      const key = service.groupId || "__none__";
      byGroup.set(key, [...(byGroup.get(key) || []), service]);
    }
    return dashboard.groups.map((group) => ({ group, services: byGroup.get(group.id) || [] }));
  }, [dashboard.groups, sortedServices]);

  const openCreate = () => {
    setEditing(null);
    setShowForm(true);
  };

  const openEdit = (service: WebServiceWithRuntime) => {
    setEditing(service);
    setShowForm(true);
  };

  const handleToggle = async (service: WebServiceWithRuntime) => {
    setError(null);
    try {
      await toggleWebService(service.id, !service.enabled);
      await onRefresh();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Toggle failed.");
    }
  };

  const handleDelete = async (service: WebServiceWithRuntime) => {
    if (!window.confirm(`Delete Web service "${service.name}"?`)) return;
    setError(null);
    try {
      await deleteWebService(service.id);
      await onRefresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Delete failed.");
    }
  };

  const handleGroupToggle = async (group: ServiceGroup) => {
    await updateGroup(group.id, { collapsed: !group.collapsed });
    await onRefresh();
  };

  const handleAddGroup = async () => {
    const name = window.prompt("New group name");
    if (!name?.trim()) return;
    await createGroup(name.trim());
    await onRefresh();
  };

  const handleDrop = async (targetId: string) => {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      return;
    }
    const ids = sortedServices.map((service) => service.id);
    const from = ids.indexOf(draggingId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    setDraggingId(null);
    await reorderWebServices(ids);
    await onRefresh();
  };

  return (
    <section className="workspace-section">
      <header className="section-heading sticky-story">
        <div>
          <p className="eyebrow">01 Web Services</p>
          <h2>Domain-first routing control</h2>
          <p>Lucky-style service operations mapped to Traefik file-provider routers and live dashboard status.</p>
        </div>
        <div className="toolbar">
          <button type="button" className="secondary-button" onClick={handleAddGroup}>
            <Layers size={16} />
            Group
          </button>
          <button type="button" className="primary-button" onClick={openCreate}>
            <Plus size={16} />
            New service
          </button>
        </div>
      </header>

      {error ? <div className="notice error">{error}</div> : null}

      <div className="content-grid">
        <div className="service-groups">
          {grouped.map(({ group, services }) => (
            <section className="group-band" key={group.id}>
              <button className="group-header" type="button" onClick={() => void handleGroupToggle(group)}>
                {group.collapsed ? <ChevronRight size={17} /> : <ChevronDown size={17} />}
                <strong>{group.name}</strong>
                <span>{services.length} services</span>
              </button>
              {!group.collapsed ? (
                <div className="service-list">
                  {services.map((service) => (
                    <article
                      key={service.id}
                      className={`service-card ${draggingId === service.id ? "dragging" : ""}`}
                      draggable
                      onDragStart={() => setDraggingId(service.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => void handleDrop(service.id)}
                      onClick={() => setSelectedId(service.id)}
                    >
                      <button className="drag-handle" aria-label="Drag to reorder" type="button">
                        <GripVertical size={18} />
                      </button>
                      <div className="service-main">
                        <div className="service-title">
                          <h3>{service.name}</h3>
                          <StatusBadge status={service.enabled ? "enabled" : "disabled"} label={service.enabled ? "Enabled" : "Disabled"} />
                          {service.runtime ? <StatusBadge status={service.runtime.status} label={service.runtime.status} /> : <StatusBadge status="unknown" label="Not seen" />}
                        </div>
                        <div className="domain-row">
                          {service.domains.map((domain) => (
                            <a key={domain} href={`http://${domain}:${service.listenPort}`} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                              {domain}
                              <ExternalLink size={12} />
                            </a>
                          ))}
                        </div>
                        <div className="service-meta">
                          <span>{service.entryPoints.join(", ")}</span>
                          <span>{service.targetUrl}</span>
                          <span>{service.tls.mode === "none" ? "No TLS" : service.tls.mode}</span>
                        </div>
                      </div>
                      <div className="row-actions" onClick={(event) => event.stopPropagation()}>
                        <button className="icon-button" type="button" onClick={() => void handleToggle(service)} aria-label="Toggle service">
                          <Power size={17} />
                        </button>
                        <button className="icon-button" type="button" onClick={() => openEdit(service)} aria-label="Edit service">
                          <Pencil size={17} />
                        </button>
                        <button className="icon-button danger" type="button" onClick={() => void handleDelete(service)} aria-label="Delete service">
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </article>
                  ))}
                  {services.length === 0 ? <div className="empty-inline">No services in this group yet.</div> : null}
                </div>
              ) : null}
            </section>
          ))}
        </div>

        <aside className="detail-panel">
          {selected ? (
            <>
              <p className="eyebrow">Selected route</p>
              <h3>{selected.name}</h3>
              <dl className="detail-list">
                <div>
                  <dt>
                    <Route size={15} />
                    Rule
                  </dt>
                  <dd>{selected.domains.map((domain) => `Host(${domain})`).join(" OR ")}</dd>
                </div>
                <div>
                  <dt>
                    <Server size={15} />
                    Backend
                  </dt>
                  <dd>{selected.targetUrl}</dd>
                </div>
                <div>
                  <dt>TLS</dt>
                  <dd>{selected.tls.mode === "file-certificate" ? `Certificate ${selected.tls.certificateId}` : selected.tls.mode}</dd>
                </div>
                <div>
                  <dt>Runtime</dt>
                  <dd>{selected.runtime ? `${selected.runtime.name} · ${selected.runtime.status}` : "Waiting for Traefik file provider"}</dd>
                </div>
                <div>
                  <dt>Notes</dt>
                  <dd>{selected.notes || "No notes"}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p>No service selected.</p>
          )}
        </aside>
      </div>

      {showForm ? (
        <ServiceForm
          service={editing}
          groups={dashboard.groups}
          certificates={dashboard.certificates}
          saving={saving}
          onClose={() => setShowForm(false)}
          onSubmit={async (input) => {
            setSaving(true);
            setError(null);
            try {
              if (editing) {
                await updateWebService(editing.id, input);
              } else {
                await createWebService(input);
              }
              setShowForm(false);
              await onRefresh();
            } catch (saveError) {
              setError(saveError instanceof Error ? saveError.message : "Save failed.");
            } finally {
              setSaving(false);
            }
          }}
        />
      ) : null}
    </section>
  );
}

function ServiceForm({
  service,
  groups,
  certificates,
  saving,
  onClose,
  onSubmit
}: {
  service: WebServiceWithRuntime | null;
  groups: ServiceGroup[];
  certificates: DashboardPayload["certificates"];
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: WebServiceInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<DraftService>(() =>
    service
      ? {
          name: service.name,
          enabled: service.enabled,
          groupId: service.groupId,
          domainsText: service.domains.join(", "),
          listenPort: service.listenPort,
          entryPointsText: service.entryPoints.join(", "),
          targetUrl: service.targetUrl,
          middlewaresText: service.middlewares.join(", "),
          tlsMode: service.tls.mode,
          certificateId: service.tls.certificateId || "",
          resolver: service.tls.resolver || "letsencrypt",
          notes: service.notes || ""
        }
      : { ...emptyDraft, groupId: groups[0]?.id || "local" }
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onSubmit({
      name: draft.name,
      enabled: draft.enabled,
      groupId: draft.groupId,
      domains: splitList(draft.domainsText),
      listenPort: Number(draft.listenPort),
      entryPoints: splitList(draft.entryPointsText),
      targetUrl: draft.targetUrl,
      middlewares: splitList(draft.middlewaresText),
      tls: {
        mode: draft.tlsMode,
        certificateId: draft.tlsMode === "file-certificate" ? draft.certificateId : undefined,
        resolver: draft.tlsMode === "resolver" ? draft.resolver : undefined
      },
      notes: draft.notes
    });
  };

  return (
    <Modal title={service ? "Edit Web service" : "New Web service"} subtitle="Generate Traefik routers and services without hand-writing YAML." onClose={onClose}>
      <form className="form-grid" onSubmit={(event) => void submit(event)}>
        <label>
          Service name
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
        </label>
        <label>
          Group
          <select value={draft.groupId} onChange={(event) => setDraft({ ...draft, groupId: event.target.value })}>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <label className="span-2">
          Domains
          <input value={draft.domainsText} onChange={(event) => setDraft({ ...draft, domainsText: event.target.value })} placeholder="app.localhost, www.example.com" required />
        </label>
        <label>
          Host port
          <input type="number" min="1" max="65535" value={draft.listenPort} onChange={(event) => setDraft({ ...draft, listenPort: Number(event.target.value) })} />
        </label>
        <label>
          Entrypoints
          <input value={draft.entryPointsText} onChange={(event) => setDraft({ ...draft, entryPointsText: event.target.value })} placeholder="web, websecure" required />
        </label>
        <label className="span-2">
          Forward target
          <input value={draft.targetUrl} onChange={(event) => setDraft({ ...draft, targetUrl: event.target.value })} placeholder="http://whoami:80" required />
        </label>
        <label>
          TLS mode
          <select value={draft.tlsMode} onChange={(event) => setDraft({ ...draft, tlsMode: event.target.value as DraftService["tlsMode"] })}>
            <option value="none">No TLS</option>
            <option value="file-certificate">File certificate</option>
            <option value="resolver">ACME resolver</option>
          </select>
        </label>
        {draft.tlsMode === "file-certificate" ? (
          <label>
            Certificate
            <select value={draft.certificateId} onChange={(event) => setDraft({ ...draft, certificateId: event.target.value })}>
              <option value="">Select certificate</option>
              {certificates.map((certificate) => (
                <option key={certificate.id} value={certificate.id}>
                  {certificate.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {draft.tlsMode === "resolver" ? (
          <label>
            Resolver
            <input value={draft.resolver} onChange={(event) => setDraft({ ...draft, resolver: event.target.value })} />
          </label>
        ) : null}
        <label className="span-2">
          Middlewares
          <input value={draft.middlewaresText} onChange={(event) => setDraft({ ...draft, middlewaresText: event.target.value })} placeholder="auth@file, compress@file" />
        </label>
        <label className="span-2">
          Notes
          <textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={3} />
        </label>
        <label className="switch-line span-2">
          <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
          Enabled
        </label>
        <footer className="form-actions span-2">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={saving}>
            <Save size={16} />
            {saving ? "Saving..." : "Save"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

