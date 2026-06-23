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
  deleteGroup,
  deleteWebService,
  reorderWebServices,
  toggleWebService,
  updateGroup,
  updateWebService,
  type WebServiceInput
} from "../api";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";
import { useLanguage } from "../i18n";

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
  const { t } = useLanguage();
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
      setError(toggleError instanceof Error ? toggleError.message : t("Toggle failed.", "切换失败。"));
    }
  };

  const handleDelete = async (service: WebServiceWithRuntime) => {
    if (!window.confirm(t(`Delete Web service "${service.name}"?`, `删除 Web 服务「${service.name}」？`))) return;
    setError(null);
    try {
      await deleteWebService(service.id);
      await onRefresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("Delete failed.", "删除失败。"));
    }
  };

  const handleGroupToggle = async (group: ServiceGroup) => {
    setError(null);
    try {
      await updateGroup(group.id, { collapsed: !group.collapsed });
      await onRefresh();
    } catch (groupError) {
      setError(groupError instanceof Error ? groupError.message : t("Group update failed.", "分组更新失败。"));
    }
  };

  const handleAddGroup = async () => {
    const name = window.prompt(t("New group name", "新分组名称"));
    if (!name?.trim()) return;
    setError(null);
    try {
      await createGroup(name.trim());
      await onRefresh();
    } catch (groupError) {
      setError(groupError instanceof Error ? groupError.message : t("Group create failed.", "分组创建失败。"));
    }
  };

  const handleRenameGroup = async (group: ServiceGroup) => {
    const name = window.prompt(t("Rename group", "重命名分组"), group.name);
    if (!name?.trim() || name.trim() === group.name) return;
    setError(null);
    try {
      await updateGroup(group.id, { name: name.trim() });
      await onRefresh();
    } catch (groupError) {
      setError(groupError instanceof Error ? groupError.message : t("Group rename failed.", "分组重命名失败。"));
    }
  };

  const handleDeleteGroup = async (group: ServiceGroup, serviceCount: number) => {
    if (serviceCount > 0) {
      setError(t("Move or delete services before deleting this group.", "删除分组前请先移动或删除其中的服务。"));
      return;
    }
    if (!window.confirm(t(`Delete empty group "${group.name}"?`, `删除空分组「${group.name}」？`))) return;
    setError(null);
    try {
      await deleteGroup(group.id);
      await onRefresh();
    } catch (groupError) {
      setError(groupError instanceof Error ? groupError.message : t("Group delete failed.", "分组删除失败。"));
    }
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
          <p className="eyebrow">{t("01 Web Services", "01 Web 服务")}</p>
          <h2>{t("Domain-first routing control", "以域名为中心的路由管理")}</h2>
          <p>{t("Lucky-style service operations mapped to Traefik file-provider routers and live dashboard status.", "把 Lucky 风格的服务操作映射到 Traefik file provider 路由和实时运行状态。")}</p>
        </div>
        <div className="toolbar">
          <button type="button" className="secondary-button" onClick={handleAddGroup}>
            <Layers size={16} />
            {t("Group", "分组")}
          </button>
          <button type="button" className="primary-button" onClick={openCreate}>
            <Plus size={16} />
            {t("New service", "新建服务")}
          </button>
        </div>
      </header>

      {error ? <div className="notice error">{error}</div> : null}

      <div className="content-grid">
        <div className="service-groups">
          {grouped.map(({ group, services }) => (
            <section className="group-band" key={group.id}>
              <div className="group-header">
                <button className="group-toggle" type="button" onClick={() => void handleGroupToggle(group)} aria-label={t(`${group.collapsed ? "Expand" : "Collapse"} ${group.name}`, `${group.collapsed ? "展开" : "折叠"} ${group.name}`)}>
                  {group.collapsed ? <ChevronRight size={17} /> : <ChevronDown size={17} />}
                  <strong>{group.name}</strong>
                  <span>{t(`${services.length} services`, `${services.length} 个服务`)}</span>
                </button>
                <div className="group-actions">
                  <button className="icon-button" type="button" onClick={() => void handleRenameGroup(group)} aria-label={t(`Rename group ${group.name}`, `重命名分组 ${group.name}`)}>
                    <Pencil size={16} />
                  </button>
                  <button className="icon-button danger" type="button" onClick={() => void handleDeleteGroup(group, services.length)} disabled={services.length > 0 || dashboard.groups.length <= 1} aria-label={t(`Delete group ${group.name}`, `删除分组 ${group.name}`)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
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
                      <button className="drag-handle" aria-label={t("Drag to reorder", "拖拽排序")} type="button">
                        <GripVertical size={18} />
                      </button>
                      <div className="service-main">
                        <div className="service-title">
                          <h3>{service.name}</h3>
                          <StatusBadge status={service.enabled ? "enabled" : "disabled"} />
                          {service.runtime ? <StatusBadge status={service.runtime.status} /> : <StatusBadge status="unknown" label={t("Not seen", "未发现")} />}
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
                          <span>{service.tls.mode === "none" ? t("No TLS", "无 TLS") : service.tls.mode}</span>
                        </div>
                      </div>
                      <div className="row-actions" onClick={(event) => event.stopPropagation()}>
                        <button className="icon-button" type="button" onClick={() => void handleToggle(service)} aria-label={t("Toggle service", "切换服务启用状态")}>
                          <Power size={17} />
                        </button>
                        <button className="icon-button" type="button" onClick={() => openEdit(service)} aria-label={t("Edit service", "编辑服务")}>
                          <Pencil size={17} />
                        </button>
                        <button className="icon-button danger" type="button" onClick={() => void handleDelete(service)} aria-label={t("Delete service", "删除服务")}>
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </article>
                  ))}
                  {services.length === 0 ? <div className="empty-inline">{t("No services in this group yet.", "这个分组里还没有服务。")}</div> : null}
                </div>
              ) : null}
            </section>
          ))}
        </div>

        <aside className="detail-panel">
          {selected ? (
            <>
              <p className="eyebrow">{t("Selected route", "选中路由")}</p>
              <h3>{selected.name}</h3>
              <dl className="detail-list">
                <div>
                  <dt>
                    <Route size={15} />
                    {t("Rule", "规则")}
                  </dt>
                  <dd>{selected.domains.map((domain) => `Host(${domain})`).join(" OR ")}</dd>
                </div>
                <div>
                  <dt>
                    <Server size={15} />
                    {t("Backend", "后端")}
                  </dt>
                  <dd>{selected.targetUrl}</dd>
                </div>
                <div>
                  <dt>TLS</dt>
                  <dd>{selected.tls.mode === "file-certificate" ? t(`Certificate ${selected.tls.certificateId}`, `证书 ${selected.tls.certificateId}`) : selected.tls.mode}</dd>
                </div>
                <div>
                  <dt>{t("Runtime", "运行时")}</dt>
                  <dd>{selected.runtime ? `${selected.runtime.name} · ${selected.runtime.status}` : t("Waiting for Traefik file provider", "等待 Traefik file provider 同步")}</dd>
                </div>
                <div>
                  <dt>{t("Notes", "备注")}</dt>
                  <dd>{selected.notes || t("No notes", "无备注")}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p>{t("No service selected.", "未选择服务。")}</p>
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
              setError(saveError instanceof Error ? saveError.message : t("Save failed.", "保存失败。"));
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
  const { t } = useLanguage();
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
    <Modal title={service ? t("Edit Web service", "编辑 Web 服务") : t("New Web service", "新建 Web 服务")} subtitle={t("Generate Traefik routers and services without hand-writing YAML.", "无需手写 YAML 即可生成 Traefik routers 和 services。")} onClose={onClose}>
      <form className="form-grid" onSubmit={(event) => void submit(event)}>
        <label>
          {t("Service name", "服务名称")}
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
        </label>
        <label>
          {t("Group", "分组")}
          <select value={draft.groupId} onChange={(event) => setDraft({ ...draft, groupId: event.target.value })}>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <label className="span-2">
          {t("Domains", "域名")}
          <input value={draft.domainsText} onChange={(event) => setDraft({ ...draft, domainsText: event.target.value })} placeholder="app.localhost, www.example.com" required />
        </label>
        <label>
          {t("Host port", "主机端口")}
          <input type="number" min="1" max="65535" value={draft.listenPort} onChange={(event) => setDraft({ ...draft, listenPort: Number(event.target.value) })} />
        </label>
        <label>
          {t("Entrypoints", "入口点")}
          <input value={draft.entryPointsText} onChange={(event) => setDraft({ ...draft, entryPointsText: event.target.value })} placeholder="web, websecure" required />
        </label>
        <label className="span-2">
          {t("Forward target", "转发目标")}
          <input value={draft.targetUrl} onChange={(event) => setDraft({ ...draft, targetUrl: event.target.value })} placeholder="http://whoami:80" required />
        </label>
        <label>
          {t("TLS mode", "TLS 模式")}
          <select value={draft.tlsMode} onChange={(event) => setDraft({ ...draft, tlsMode: event.target.value as DraftService["tlsMode"] })}>
            <option value="none">{t("No TLS", "无 TLS")}</option>
            <option value="file-certificate">{t("File certificate", "文件证书")}</option>
            <option value="resolver">{t("ACME resolver", "ACME 解析器")}</option>
          </select>
        </label>
        {draft.tlsMode === "file-certificate" ? (
          <label>
            {t("Certificate", "证书")}
            <select value={draft.certificateId} onChange={(event) => setDraft({ ...draft, certificateId: event.target.value })}>
              <option value="">{t("Select certificate", "选择证书")}</option>
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
            {t("Resolver", "解析器")}
            <input value={draft.resolver} onChange={(event) => setDraft({ ...draft, resolver: event.target.value })} />
          </label>
        ) : null}
        <label className="span-2">
          {t("Middlewares", "中间件")}
          <input value={draft.middlewaresText} onChange={(event) => setDraft({ ...draft, middlewaresText: event.target.value })} placeholder="auth@file, compress@file" />
        </label>
        <label className="span-2">
          {t("Notes", "备注")}
          <textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={3} />
        </label>
        <label className="switch-line span-2">
          <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
          {t("Enabled", "启用")}
        </label>
        <footer className="form-actions span-2">
          <button type="button" className="secondary-button" onClick={onClose}>
            {t("Cancel", "取消")}
          </button>
          <button type="submit" className="primary-button" disabled={saving}>
            <Save size={16} />
            {saving ? t("Saving...", "保存中...") : t("Save", "保存")}
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
