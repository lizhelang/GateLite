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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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

const selectClass = "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

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
    <section className="grid gap-4">
      <Card className="bg-card/80">
        <CardHeader>
          <div className="grid gap-3 md:flex md:items-center md:justify-between">
            <div className="grid min-w-0 gap-1">
              <CardDescription>{t("02 Web Services", "02 Web 服务")}</CardDescription>
              <CardTitle className="text-2xl">{t("Domain-first routing control", "以域名为中心的路由管理")}</CardTitle>
              <CardDescription>{t("Lucky-style service operations mapped to Traefik file-provider routers and live dashboard status.", "把 Lucky 风格的服务操作映射到 Traefik file provider 路由和实时运行状态。")}</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={handleAddGroup}>
                <Layers className="size-4" />
                {t("Group", "分组")}
              </Button>
              <Button type="button" onClick={openCreate}>
                <Plus className="size-4" />
                {t("New service", "新建服务")}
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {error ? <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-4">
          {grouped.map(({ group, services }) => (
            <Card key={group.id} className="bg-card/75">
              <CardHeader className="border-b">
                <div className="flex min-w-0 items-center gap-2">
                  <Button variant="ghost" className="min-w-0 flex-1 justify-start gap-2 px-0 text-base" onClick={() => void handleGroupToggle(group)} aria-label={t(`${group.collapsed ? "Expand" : "Collapse"} ${group.name}`, `${group.collapsed ? "展开" : "折叠"} ${group.name}`)}>
                    {group.collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                    <span className="truncate">{group.name}</span>
                  </Button>
                  <Badge variant="outline">{t(`${services.length} services`, `${services.length} 个服务`)}</Badge>
                  <Button variant="ghost" size="icon-sm" onClick={() => void handleRenameGroup(group)} aria-label={t(`Rename group ${group.name}`, `重命名分组 ${group.name}`)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="destructive" size="icon-sm" onClick={() => void handleDeleteGroup(group, services.length)} disabled={services.length > 0 || dashboard.groups.length <= 1} aria-label={t(`Delete group ${group.name}`, `删除分组 ${group.name}`)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </CardHeader>
              {!group.collapsed ? (
                <CardContent className="grid gap-3 pt-4">
                  {services.map((service) => (
                    <article
                      key={service.id}
                      className={`grid gap-3 rounded-xl border bg-background/35 p-3 transition-colors hover:bg-muted/40 md:grid-cols-[auto_minmax(0,1fr)_auto] ${draggingId === service.id ? "border-cyan-300/70" : ""}`}
                      draggable
                      onDragStart={() => setDraggingId(service.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => void handleDrop(service.id)}
                      onClick={() => setSelectedId(service.id)}
                    >
                      <Button variant="ghost" size="icon-sm" className="self-center" aria-label={t("Drag to reorder", "拖拽排序")}>
                        <GripVertical className="size-4" />
                      </Button>
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium">{service.name}</h3>
                          <StatusBadge status={service.enabled ? "enabled" : "disabled"} />
                          {service.runtime ? <StatusBadge status={service.runtime.status} /> : <StatusBadge status="unknown" label={t("Not seen", "未发现")} />}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {service.domains.map((domain) => (
                            <Button key={domain} asChild variant="outline" size="xs" onClick={(event) => event.stopPropagation()}>
                              <a href={`http://${domain}:${service.listenPort}`} target="_blank" rel="noreferrer">
                                {domain}
                                <ExternalLink className="size-3" />
                              </a>
                            </Button>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>{service.entryPoints.join(", ")}</span>
                          <span>{service.targetUrl}</span>
                          <span>{service.tls.mode === "none" ? t("No TLS", "无 TLS") : service.tls.mode}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                        <Button variant="outline" size="icon-sm" onClick={() => void handleToggle(service)} aria-label={t("Toggle service", "切换服务启用状态")}>
                          <Power className="size-4" />
                        </Button>
                        <Button variant="outline" size="icon-sm" onClick={() => openEdit(service)} aria-label={t("Edit service", "编辑服务")}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button variant="destructive" size="icon-sm" onClick={() => void handleDelete(service)} aria-label={t("Delete service", "删除服务")}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </article>
                  ))}
                  {services.length === 0 ? <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">{t("No services in this group yet.", "这个分组里还没有服务。")}</div> : null}
                </CardContent>
              ) : null}
            </Card>
          ))}
        </div>

        <Card className="h-fit bg-card/80">
          <CardHeader>
            <CardDescription>{t("Selected route", "选中路由")}</CardDescription>
            <CardTitle>{selected?.name || t("No service selected.", "未选择服务。")}</CardTitle>
          </CardHeader>
          <CardContent>
            {selected ? (
              <dl className="grid gap-4 text-sm">
                <DetailItem icon={<Route className="size-4" />} label={t("Rule", "规则")} value={selected.domains.map((domain) => `Host(${domain})`).join(" OR ")} />
                <DetailItem icon={<Server className="size-4" />} label={t("Backend", "后端")} value={selected.targetUrl} />
                <DetailItem label="TLS" value={selected.tls.mode === "file-certificate" ? t(`Certificate ${selected.tls.certificateId}`, `证书 ${selected.tls.certificateId}`) : selected.tls.mode} />
                <DetailItem label={t("Runtime", "运行时")} value={selected.runtime ? `${selected.runtime.name} · ${selected.runtime.status}` : t("Waiting for Traefik file provider", "等待 Traefik file provider 同步")} />
                <DetailItem label={t("Notes", "备注")} value={selected.notes || t("No notes", "无备注")} />
              </dl>
            ) : null}
          </CardContent>
        </Card>
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

function DetailItem({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="flex items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="break-words font-medium">{value}</dd>
    </div>
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
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void submit(event)}>
        <Field label={t("Service name", "服务名称")}>
          <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
        </Field>
        <Field label={t("Group", "分组")}>
          <select className={selectClass} value={draft.groupId} onChange={(event) => setDraft({ ...draft, groupId: event.target.value })}>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </Field>
        <Field className="md:col-span-2" label={t("Domains", "域名")}>
          <Input value={draft.domainsText} onChange={(event) => setDraft({ ...draft, domainsText: event.target.value })} placeholder="app.localhost, www.example.com" required />
        </Field>
        <Field label={t("Host port", "主机端口")}>
          <Input type="number" min="1" max="65535" value={draft.listenPort} onChange={(event) => setDraft({ ...draft, listenPort: Number(event.target.value) })} />
        </Field>
        <Field label={t("Entrypoints", "入口点")}>
          <Input value={draft.entryPointsText} onChange={(event) => setDraft({ ...draft, entryPointsText: event.target.value })} placeholder="web, websecure" required />
        </Field>
        <Field className="md:col-span-2" label={t("Forward target", "转发目标")}>
          <Input value={draft.targetUrl} onChange={(event) => setDraft({ ...draft, targetUrl: event.target.value })} placeholder="http://whoami:80" required />
        </Field>
        <Field label={t("TLS mode", "TLS 模式")}>
          <select className={selectClass} value={draft.tlsMode} onChange={(event) => setDraft({ ...draft, tlsMode: event.target.value as DraftService["tlsMode"] })}>
            <option value="none">{t("No TLS", "无 TLS")}</option>
            <option value="file-certificate">{t("File certificate", "文件证书")}</option>
            <option value="resolver">{t("ACME resolver", "ACME 解析器")}</option>
          </select>
        </Field>
        {draft.tlsMode === "file-certificate" ? (
          <Field label={t("Certificate", "证书")}>
            <select className={selectClass} value={draft.certificateId} onChange={(event) => setDraft({ ...draft, certificateId: event.target.value })}>
              <option value="">{t("Select certificate", "选择证书")}</option>
              {certificates.map((certificate) => (
                <option key={certificate.id} value={certificate.id}>
                  {certificate.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {draft.tlsMode === "resolver" ? (
          <Field label={t("Resolver", "解析器")}>
            <Input value={draft.resolver} onChange={(event) => setDraft({ ...draft, resolver: event.target.value })} />
          </Field>
        ) : null}
        <Field className="md:col-span-2" label={t("Middlewares", "中间件")}>
          <Input value={draft.middlewaresText} onChange={(event) => setDraft({ ...draft, middlewaresText: event.target.value })} placeholder="auth@file, compress@file" />
        </Field>
        <Field className="md:col-span-2" label={t("Notes", "备注")}>
          <Textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={3} />
        </Field>
        <div className="flex items-center gap-3 md:col-span-2">
          <Switch checked={draft.enabled} onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked })} />
          <span className="text-sm">{t("Enabled", "启用")}</span>
        </div>
        <Separator className="md:col-span-2" />
        <footer className="flex justify-end gap-2 md:col-span-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("Cancel", "取消")}
          </Button>
          <Button type="submit" disabled={saving}>
            <Save className="size-4" />
            {saving ? t("Saving...", "保存中...") : t("Save", "保存")}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <Label className={`grid gap-2 text-sm ${className || ""}`}>
      <span>{label}</span>
      {children}
    </Label>
  );
}

function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
