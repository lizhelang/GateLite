import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  GripVertical,
  Layers,
  Link2,
  Pencil,
  Plus,
  Power,
  Save,
  Trash2,
  Upload
} from "lucide-react";
import { FormEvent, useMemo, useState, type ReactNode } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "../i18n";

interface WebServicesPageProps {
  dashboard: DashboardPayload;
  onRefresh: () => Promise<void>;
}

type DraftService = {
  name: string;
  enabled: boolean;
  matchMode: "host" | "custom" | "default";
  groupId: string;
  domainRoot: string;
  subdomainsText: string;
  customRule: string;
  listenPort: number;
  entryPointsText: string;
  targetUrl: string;
  passHostHeader: boolean;
  middlewaresText: string;
  tlsMode: "none" | "file-certificate" | "resolver";
  certificateId: string;
  resolver: string;
  notes: string;
};

type DomainRoute = {
  routeId: string;
  service: WebServiceWithRuntime;
  root: string;
  primaryDomain: string;
  labels: string[];
  groupName: string;
  isDefault: boolean;
};

type DomainZone = {
  root: string;
  routes: DomainRoute[];
};

const emptyDraft: DraftService = {
  name: "",
  enabled: true,
  matchMode: "host",
  groupId: "local",
  domainRoot: "localhost",
  subdomainsText: "",
  customRule: "",
  listenPort: 18080,
  entryPointsText: "web",
  targetUrl: "http://whoami:80",
  passHostHeader: true,
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
  const [createMode, setCreateMode] = useState<"rule" | "subrule" | "default">("rule");
  const [draftPreset, setDraftPreset] = useState<Partial<DraftService> | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>([]);
  const [activeRoot, setActiveRoot] = useState("__all");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedServices = useMemo(() => [...dashboard.webServices].sort((a, b) => a.order - b.order), [dashboard.webServices]);
  const groupsById = useMemo(() => new Map(dashboard.groups.map((group) => [group.id, group])), [dashboard.groups]);
  const serviceCountByGroup = useMemo(() => countServicesByGroup(sortedServices), [sortedServices]);
  const zones = useMemo(() => buildDomainZones(sortedServices, groupsById), [groupsById, sortedServices]);
  const allRoutes = zones.flatMap((zone) => zone.routes);
  const routeCount = allRoutes.length;
  const activeRoutes = (activeRoot === "__all" ? allRoutes : zones.find((zone) => zone.root === activeRoot)?.routes || allRoutes).filter((route) => !groupsById.get(route.service.groupId)?.collapsed);
  const canCreateSubrule = !["__all", "__default", "__custom"].includes(activeRoot);
  const selectedServices = useMemo(() => {
    const selectedServiceIds = new Set(activeRoutes.filter((route) => selectedRouteIds.includes(route.routeId)).map((route) => route.service.id));
    return sortedServices.filter((service) => selectedServiceIds.has(service.id));
  }, [activeRoutes, selectedRouteIds, sortedServices]);

  const openCreate = (mode: "rule" | "subrule" | "default" = "rule") => {
    setEditing(null);
    setDraftPreset(null);
    setCreateMode(mode);
    setShowForm(true);
  };

  const openEdit = (service: WebServiceWithRuntime) => {
    setEditing(service);
    setDraftPreset(null);
    setCreateMode(service.matchMode === "default" ? "default" : "subrule");
    setShowForm(true);
  };

  const openDuplicate = (route: DomainRoute) => {
    if (route.isDefault) return;
    const domains = domainsToDraft([route.primaryDomain]);
    const label = domainToLabel(route.primaryDomain, domains.domainRoot);
    const copiedLabel = copyDomainLabel(label);
    const copiedDomain = composeDomains(domains.domainRoot, copiedLabel)[0] || "";
    const customRule = route.service.matchMode === "custom" ? copyCustomRule(route.service.customRule || "", route.primaryDomain, copiedDomain) : "";
    setEditing(null);
    setCreateMode(label === "@" ? "rule" : "subrule");
    setDraftPreset({
      name: `${displayRouteName(route, t)} ${t("copy", "副本")}`,
      enabled: route.service.matchMode === "custom" ? Boolean(customRule) : true,
      matchMode: route.service.matchMode === "custom" ? "custom" : "host",
      groupId: route.service.groupId,
      domainRoot: domains.domainRoot,
      subdomainsText: copiedLabel,
      customRule: route.service.customRule || "",
      ...(customRule ? { customRule } : {}),
      listenPort: route.service.listenPort,
      entryPointsText: route.service.entryPoints.join(", "),
      targetUrl: route.service.targetUrl,
      passHostHeader: route.service.passHostHeader ?? true,
      middlewaresText: route.service.middlewares.join(", "),
      tlsMode: route.service.tls.mode,
      certificateId: route.service.tls.certificateId || "",
      resolver: route.service.tls.resolver || "letsencrypt",
      notes: route.service.notes || ""
    });
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
    const label = displayServiceName({ service, primaryDomain: service.domains[0] || service.id });
    if (!window.confirm(t(`Delete reverse proxy rule "${label}"?`, `删除反代规则「${label}」？`))) return;
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
    if (!group.collapsed) {
      setSelectedRouteIds((ids) => ids.filter((id) => !activeRoutes.some((route) => route.routeId === id && route.service.groupId === group.id)));
    }
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
      setError(t("Move or delete rules before deleting this group.", "删除分组前请先移动或删除其中的规则。"));
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

  const handleSelectRoute = (routeId: string, checked: boolean) => {
    setSelectedRouteIds((ids) => {
      if (checked) return ids.includes(routeId) ? ids : [...ids, routeId];
      return ids.filter((id) => id !== routeId);
    });
  };

  const handleSelectVisibleRoutes = (checked: boolean) => {
    setSelectedRouteIds(checked ? activeRoutes.map((route) => route.routeId) : []);
  };

  const handleBulkToggle = async (enabled: boolean) => {
    if (!selectedServices.length) return;
    setError(null);
    try {
      for (const service of selectedServices) {
        if (service.enabled !== enabled) {
          await toggleWebService(service.id, enabled);
        }
      }
      setSelectedRouteIds([]);
      await onRefresh();
    } catch (bulkError) {
      setError(bulkError instanceof Error ? bulkError.message : t("Bulk update failed.", "批量更新失败。"));
    }
  };

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border bg-muted/45 p-1">
          <Button type="button" variant={activeRoot === "__all" ? "outline" : "ghost"} size="sm" onClick={() => setActiveRoot("__all")}>
            {t("All rules", "全部规则")}
            <Badge variant="secondary" className="ml-1 rounded-full px-1.5 py-0 text-[10px]">
              {routeCount}
            </Badge>
          </Button>
          {zones.map((zone) => (
            <Button key={zone.root} type="button" variant={activeRoot === zone.root ? "outline" : "ghost"} size="sm" onClick={() => setActiveRoot(zone.root)}>
              {rootLabel(zone.root, t)}
              <Badge variant="secondary" className="ml-1 rounded-full px-1.5 py-0 text-[10px]">
                {zone.routes.length}
              </Badge>
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={handleAddGroup}>
            <Layers className="size-4" />
            {t("Groups", "分组")}
          </Button>
          <Button type="button" variant="outline" onClick={() => openCreate("subrule")} disabled={!canCreateSubrule} title={!canCreateSubrule ? t("Select a root domain before adding a sub-rule.", "先选择一个根域名，再添加子规则。") : undefined}>
            <Plus className="size-4" />
            {t("New sub-rule", "新建子规则")}
          </Button>
          <Button type="button" variant="outline" onClick={() => openCreate("default")}>
            <Plus className="size-4" />
            {t("Default rule", "默认规则")}
          </Button>
          <Button type="button" onClick={() => openCreate("rule")}>
            <Plus className="size-4" />
            {t("New reverse proxy rule", "新建反代规则")}
          </Button>
        </div>
      </div>

      <GroupStrip
        groups={dashboard.groups}
        counts={serviceCountByGroup}
        onToggle={handleGroupToggle}
        onRename={handleRenameGroup}
        onDelete={handleDeleteGroup}
      />

      {error ? <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

      <RouteDataTable
        routes={activeRoutes}
        selectedRouteIds={selectedRouteIds}
        draggingId={draggingId}
        onDragStart={setDraggingId}
        onDrop={handleDrop}
        onSelect={handleSelectRoute}
        onSelectAll={handleSelectVisibleRoutes}
        onToggle={handleToggle}
        onBulkToggle={handleBulkToggle}
        onDuplicate={openDuplicate}
        onEdit={openEdit}
        onDelete={handleDelete}
      />

      {showForm ? (
        <ServiceForm
          service={editing}
          mode={createMode}
          activeRoot={activeRoot}
          groups={dashboard.groups}
          certificates={dashboard.certificates}
          draftPreset={draftPreset}
          saving={saving}
          onClose={() => {
            setShowForm(false);
            setDraftPreset(null);
          }}
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
              setDraftPreset(null);
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

function RouteDataTable({
  routes,
  selectedRouteIds,
  draggingId,
  onDragStart,
  onDrop,
  onSelect,
  onSelectAll,
  onToggle,
  onBulkToggle,
  onDuplicate,
  onEdit,
  onDelete
}: {
  routes: DomainRoute[];
  selectedRouteIds: string[];
  draggingId: string | null;
  onDragStart: (id: string) => void;
  onDrop: (id: string) => void;
  onSelect: (id: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
  onToggle: (service: WebServiceWithRuntime) => Promise<void>;
  onBulkToggle: (enabled: boolean) => Promise<void>;
  onDuplicate: (route: DomainRoute) => void;
  onEdit: (service: WebServiceWithRuntime) => void;
  onDelete: (service: WebServiceWithRuntime) => Promise<void>;
}) {
  const { t } = useLanguage();
  const selectedCount = routes.filter((route) => selectedRouteIds.includes(route.routeId)).length;
  const allVisibleSelected = routes.length > 0 && selectedCount === routes.length;

  return (
    <div className="overflow-hidden rounded-xl border bg-card/70">
      <div className="overflow-x-auto">
        <Table className="min-w-[1120px]">
          <TableHeader className="bg-muted/50">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-8" />
              <TableHead className="w-9">
                <Checkbox aria-label={t("Select visible rules", "选择当前规则")} checked={allVisibleSelected} onCheckedChange={(checked) => onSelectAll(Boolean(checked))} />
              </TableHead>
              <TableHead className="w-[15rem]">{t("Rule", "规则")}</TableHead>
              <TableHead className="w-[20rem]">{t("Frontend domain", "前端域名")}</TableHead>
              <TableHead className="w-[20rem]">{t("Backend IP:port", "后端 IP:端口")}</TableHead>
              <TableHead className="w-28">
                <span className="inline-flex items-center gap-1">
                  <Download className="size-3.5" />
                  {t("Down", "下行")}
                </span>
              </TableHead>
              <TableHead className="w-28">
                <span className="inline-flex items-center gap-1">
                  <Upload className="size-3.5" />
                  {t("Up", "上行")}
                </span>
              </TableHead>
              <TableHead className="w-24">
                <span className="inline-flex items-center gap-1">
                  <Link2 className="size-3.5" />
                  {t("Conn.", "连接")}
                </span>
              </TableHead>
              <TableHead className="w-28">{t("Status", "状态")}</TableHead>
              <TableHead className="w-32">TLS</TableHead>
              <TableHead className="w-32 text-right">{t("Actions", "操作")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {routes.map((route) => {
              const service = route.service;
              const selected = selectedRouteIds.includes(route.routeId);
              const frontend = formatFrontendEndpoint(route, service, t);
              const backend = formatBackendTarget(service.targetUrl);
              const traffic = service.traffic;
              const isRootRule = route.labels.some((label) => label === "@");
              const displayName = displayRouteName(route, t);
              return (
                <TableRow
                  key={route.routeId}
                  data-state={selected ? "selected" : undefined}
                  className={`${draggingId === service.id ? "outline outline-1 outline-cyan-300/70" : ""} h-14`}
                  draggable
                  onDragStart={() => onDragStart(service.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => void onDrop(service.id)}
                  onClick={() => onSelect(route.routeId, !selected)}
                >
                  <TableCell className="px-2">
                    <Button variant="ghost" size="icon-xs" aria-label={t("Drag to reorder", "拖拽排序")}>
                      <GripVertical className="size-3.5" />
                    </Button>
                  </TableCell>
                  <TableCell className="px-2">
                    <Checkbox checked={selected} aria-label={t(`Select ${displayName}`, `选择 ${displayName}`)} onClick={(event) => event.stopPropagation()} onCheckedChange={(checked) => onSelect(route.routeId, Boolean(checked))} />
                  </TableCell>
                  <TableCell>
                    <div className="grid min-w-0 gap-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[10px]">
                          {routeKindLabel(route, isRootRule, t)}
                        </Badge>
                        <span className="truncate font-medium">{displayName}</span>
                      </div>
                      <span className="truncate text-xs text-muted-foreground">{rootLabel(route.root, t)} · {route.groupName}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {frontend.href ? (
                      <a className="inline-flex max-w-full items-center gap-1 truncate font-mono text-sm text-cyan-100 hover:text-cyan-200" href={frontend.href} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                        <span className="truncate">{frontend.label}</span>
                        <ExternalLink className="size-3.5 shrink-0" />
                      </a>
                    ) : (
                      <span className="inline-flex max-w-full truncate font-mono text-sm text-amber-100">{frontend.label}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2">
                      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate font-mono text-sm text-foreground">{backend.hostPort}</span>
                      <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[10px] text-muted-foreground">
                        {backend.scheme}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <TrafficValue value={traffic?.responseBytes || 0} tone="down" />
                  </TableCell>
                  <TableCell>
                    <TrafficValue value={traffic?.requestBytes || 0} tone="up" />
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-sm">{traffic?.openConnections ?? 0}</span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={service.runtime?.status || (service.enabled ? "unknown" : "offline")} label={service.enabled ? undefined : t("Disabled", "停用")} />
                  </TableCell>
                  <TableCell>
                    <div className="grid gap-0.5 text-xs">
                      <span className="font-medium">{service.tls.mode === "none" ? "HTTP" : "TLS"}</span>
                      <span className="truncate text-muted-foreground">{service.entryPoints.join(", ")}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
                      <Button variant="outline" size="icon-xs" onClick={() => void onToggle(service)} aria-label={t("Toggle rule", "切换规则启用状态")}>
                        <Power className="size-3.5" />
                      </Button>
                      <Button variant="outline" size="icon-xs" onClick={() => onDuplicate(route)} disabled={route.isDefault} aria-label={t("Copy as new rule", "复制为新规则")}>
                        <Copy className="size-3.5" />
                      </Button>
                      <Button variant="outline" size="icon-xs" onClick={() => onEdit(service)} aria-label={t("Edit rule", "编辑规则")}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button variant="destructive" size="icon-xs" onClick={() => void onDelete(service)} aria-label={t("Delete rule", "删除规则")}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {routes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="h-24 text-center text-sm text-muted-foreground">
                  {t("No visible rules in this domain view. Expand groups or add a rule.", "这个域名视图里没有可见规则。可以展开分组或新增规则。")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
        <span>{t(`${selectedCount} of ${routes.length} row(s) selected.`, `已选择 ${selectedCount} / ${routes.length} 行。`)}</span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={selectedCount === 0} onClick={() => void onBulkToggle(true)}>
            <Power className="size-3.5" />
            {t("Enable", "启用")}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={selectedCount === 0} onClick={() => void onBulkToggle(false)}>
            <Power className="size-3.5" />
            {t("Disable", "停用")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TrafficValue({ value, tone }: { value: number; tone: "down" | "up" }) {
  const toneClass = tone === "down" ? "text-cyan-100" : "text-amber-100";
  return <span className={`font-mono text-sm ${toneClass}`}>{formatBytes(value)}</span>;
}

function formatFrontendEndpoint(
  route: DomainRoute,
  service: WebServiceWithRuntime,
  t: (english: string, chinese: string) => string
): { label: string; href?: string } {
  if (route.isDefault) {
    return { label: t("Unmatched domains", "未匹配域名") };
  }
  if (!isOpenableDomain(route.primaryDomain)) {
    return {
      label: service.matchMode === "custom" ? service.customRule || t("Custom Traefik rule", "自定义 Traefik 规则") : route.primaryDomain
    };
  }
  const scheme = service.tls.mode === "none" ? "http" : "https";
  const label = `${scheme}://${route.primaryDomain}:${service.listenPort}`;
  return { label, href: label };
}

function GroupStrip({
  groups,
  counts,
  onToggle,
  onRename,
  onDelete
}: {
  groups: ServiceGroup[];
  counts: Map<string, number>;
  onToggle: (group: ServiceGroup) => Promise<void>;
  onRename: (group: ServiceGroup) => Promise<void>;
  onDelete: (group: ServiceGroup, serviceCount: number) => Promise<void>;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-wrap gap-2 rounded-xl border bg-card/45 p-2">
      {groups.map((group) => {
        const serviceCount = counts.get(group.id) || 0;
        return (
          <div key={group.id} className="flex items-center gap-1 rounded-lg border bg-background/45 px-1.5 py-1">
            <Button type="button" variant="ghost" size="xs" className="gap-1 px-1.5" onClick={() => void onToggle(group)}>
              {group.collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              <span className="max-w-36 truncate">{group.name}</span>
              <span className="text-muted-foreground">{serviceCount}</span>
            </Button>
            <Button type="button" variant="ghost" size="icon-xs" onClick={() => void onRename(group)} aria-label={t(`Rename group ${group.name}`, `重命名分组 ${group.name}`)}>
              <Pencil className="size-3.5" />
            </Button>
            <Button type="button" variant="destructive" size="icon-xs" onClick={() => void onDelete(group, serviceCount)} disabled={serviceCount > 0 || groups.length <= 1} aria-label={t(`Delete group ${group.name}`, `删除分组 ${group.name}`)}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function ServiceForm({
  service,
  mode,
  activeRoot,
  groups,
  certificates,
  draftPreset,
  saving,
  onClose,
  onSubmit
}: {
  service: WebServiceWithRuntime | null;
  mode: "rule" | "subrule" | "default";
  activeRoot: string;
  groups: ServiceGroup[];
  certificates: DashboardPayload["certificates"];
  draftPreset: Partial<DraftService> | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: WebServiceInput) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<DraftService>(() => {
    const createRoot = mode === "subrule" && activeRoot !== "__all" && activeRoot !== "__default" ? activeRoot : emptyDraft.domainRoot;
    const domains = service ? domainsToDraft(service.domains) : { domainRoot: createRoot, subdomainsText: "" };
    const matchMode = service?.matchMode || (mode === "default" ? "default" : "host");
    return service
      ? {
          name: service.name,
          enabled: service.enabled,
          matchMode,
          groupId: service.groupId,
          domainRoot: domains.domainRoot,
          subdomainsText: domains.subdomainsText,
          customRule: service.customRule || "",
          listenPort: service.listenPort,
          entryPointsText: service.entryPoints.join(", "),
          targetUrl: service.targetUrl,
          passHostHeader: service.passHostHeader ?? true,
          middlewaresText: service.middlewares.join(", "),
          tlsMode: service.tls.mode,
          certificateId: service.tls.certificateId || "",
          resolver: service.tls.resolver || "letsencrypt",
          notes: service.notes || ""
        }
      : {
          ...emptyDraft,
          matchMode,
          groupId: groups[0]?.id || "local",
          domainRoot: createRoot,
          subdomainsText: mode === "rule" ? "@" : "",
          ...(draftPreset || {})
        };
  });
  const isDefaultRule = draft.matchMode === "default";
  const isCustomRule = draft.matchMode === "custom";
  const domainPreview = isDefaultRule ? [] : composeDomains(draft.domainRoot, draft.subdomainsText);
  const title = service
    ? isDefaultRule
      ? t("Edit default rule", "编辑默认规则")
      : isCustomRule
      ? t("Edit custom rule", "编辑自定义规则")
      : t("Edit sub-rule", "编辑子规则")
    : mode === "default"
      ? t("New default rule", "新建默认规则")
      : isCustomRule
      ? t("New custom rule", "新建自定义规则")
      : mode === "subrule"
      ? t("New sub-rule", "新建子规则")
      : t("New reverse proxy rule", "新建反代规则");
  const subtitle =
    isDefaultRule
      ? t("Fallback frontend traffic to one backend.", "把未匹配的前端请求转发到一个后端。")
      : isCustomRule
      ? t("Custom Traefik match, managed backend and TLS.", "自定义 Traefik 匹配，后端和 TLS 仍由 GateLite 管理。")
      : mode === "subrule"
      ? t("Add a subdomain under the selected root domain.", "在当前根域名下添加一个子域名反代。")
      : t("Frontend domain to backend IP:port.", "前端域名指向后端 IP:端口。");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onSubmit({
      name: draft.name,
      enabled: draft.enabled,
      matchMode: draft.matchMode,
      groupId: draft.groupId,
      domains: domainPreview,
      customRule: draft.matchMode === "custom" ? draft.customRule : undefined,
      listenPort: Number(draft.listenPort),
      entryPoints: splitList(draft.entryPointsText),
      targetUrl: draft.targetUrl,
      passHostHeader: draft.passHostHeader,
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
    <Modal title={title} subtitle={subtitle} onClose={onClose}>
      <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => void submit(event)}>
        {!isDefaultRule ? (
          <>
            <Field label={mode === "subrule" ? t("Parent domain", "所属域名") : t("Root domain", "根域名")}>
              <Input value={draft.domainRoot} onChange={(event) => setDraft({ ...draft, domainRoot: event.target.value })} placeholder="1804.surfacer.cc" disabled={mode === "subrule" && activeRoot !== "__all" && !service} />
            </Field>
            <Field label={mode === "subrule" ? t("Sub-rule domain", "子规则域名") : t("Frontend domain", "前端域名")}>
              <Input value={draft.subdomainsText} onChange={(event) => setDraft({ ...draft, subdomainsText: event.target.value })} placeholder={isCustomRule ? "optional display domain" : mode === "subrule" ? "qb" : "@, www"} required={draft.matchMode === "host" && mode === "subrule" && !service} />
            </Field>
          </>
        ) : null}
        <Field className="md:col-span-2" label={t("Backend IP:port", "后端 IP:端口")}>
          <Input value={draft.targetUrl} onChange={(event) => setDraft({ ...draft, targetUrl: event.target.value })} placeholder="http://192.168.31.26:8081" required />
        </Field>
        <RoutePairPreview
          frontends={domainPreview}
          backend={draft.targetUrl}
          isDefaultRule={isDefaultRule}
        />
        <Field label={t("Rule name", "规则名称")}>
          <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={t("Optional", "可留空")} />
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
        <Field label={t("Rule type", "规则类型")}>
          <select className={selectClass} value={draft.matchMode} onChange={(event) => setDraft({ ...draft, matchMode: event.target.value as DraftService["matchMode"] })}>
            <option value="host">{t("Domain rule", "域名规则")}</option>
            <option value="custom">{t("Custom Traefik rule", "自定义 Traefik 规则")}</option>
            <option value="default">{t("Default fallback", "默认规则")}</option>
          </select>
        </Field>
        <div className="flex items-center gap-3 self-end rounded-lg border bg-background/35 px-3 py-2">
          <Switch checked={draft.passHostHeader} onCheckedChange={(checked) => setDraft({ ...draft, passHostHeader: checked })} />
          <span className="text-sm">{t("Forward Host", "转发 Host")}</span>
        </div>
        {isCustomRule ? (
          <Field className="md:col-span-2" label={t("Traefik rule", "Traefik 规则")}>
            <Textarea value={draft.customRule} onChange={(event) => setDraft({ ...draft, customRule: event.target.value })} rows={3} placeholder="Host(`app.localhost`) && PathPrefix(`/api`)" required />
          </Field>
        ) : null}
        <Field label={t("Listen port", "监听端口")}>
          <Input type="number" min="1" max="65535" value={draft.listenPort} onChange={(event) => setDraft({ ...draft, listenPort: Number(event.target.value) })} />
        </Field>
        <Field label={t("Entrypoints", "入口点")}>
          <Input value={draft.entryPointsText} onChange={(event) => setDraft({ ...draft, entryPointsText: event.target.value })} placeholder="web, websecure" required />
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
          <Button type="submit" disabled={saving || (draft.matchMode === "host" && domainPreview.length === 0) || (isCustomRule && !draft.customRule.trim()) || !draft.targetUrl.trim() || (draft.matchMode === "host" && mode === "subrule" && !service && !draft.subdomainsText.trim())}>
            <Save className="size-4" />
            {saving ? t("Saving...", "保存中...") : t("Save rule", "保存规则")}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <Label className={`grid gap-2 text-sm ${className || ""}`}>
      <span>{label}</span>
      {children}
    </Label>
  );
}

function RoutePairPreview({
  frontends,
  backend,
  isDefaultRule
}: {
  frontends: string[];
  backend: string;
  isDefaultRule: boolean;
}) {
  const { t } = useLanguage();
  const backendTarget = formatBackendTarget(backend);
  const visibleFrontends = isDefaultRule ? [t("Unmatched domains", "未匹配域名")] : frontends.length ? frontends : [t("No domain yet", "还没有域名")];
  const frontendLabel = visibleFrontends.length > 1 ? `${visibleFrontends[0]} +${visibleFrontends.length - 1}` : visibleFrontends[0];
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-background/40 px-3 py-2 text-xs md:col-span-2">
      <span className="min-w-0 truncate font-mono text-cyan-100">{frontendLabel}</span>
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate font-mono text-amber-100">{backendTarget.hostPort || t("No backend yet", "还没有后端")}</span>
      <Badge variant="outline" className="ml-auto h-5 rounded-md px-1.5 text-[10px] text-muted-foreground">
        {backendTarget.scheme}
      </Badge>
    </div>
  );
}

function buildDomainZones(services: WebServiceWithRuntime[], groupsById: Map<string, ServiceGroup>): DomainZone[] {
  const zones = new Map<string, DomainRoute[]>();
  for (const service of services) {
    const isDefault = service.matchMode === "default";
    if (isDefault) {
      const route: DomainRoute = {
        routeId: `${service.id}:default`,
        service,
        root: "__default",
        primaryDomain: "default rule",
        labels: ["*"],
        groupName: groupsById.get(service.groupId)?.name || "Ungrouped",
        isDefault: true
      };
      zones.set(route.root, [...(zones.get(route.root) || []), route]);
      continue;
    }

    const domains = service.domains.length ? service.domains : service.matchMode === "custom" ? extractHostDomains(service.customRule || "") : [service.name.toLowerCase().replace(/\s+/g, "-") || service.id];
    if (domains.length === 0) {
      const route: DomainRoute = {
        routeId: `${service.id}:custom`,
        service,
        root: "__custom",
        primaryDomain: service.customRule?.trim() || service.name || service.id,
        labels: ["custom"],
        groupName: groupsById.get(service.groupId)?.name || "Ungrouped",
        isDefault: false
      };
      zones.set(route.root, [...(zones.get(route.root) || []), route]);
      continue;
    }
    for (const [index, domain] of domains.entries()) {
      const primaryDomain = domain;
      const root = inferRootDomain(primaryDomain);
      const route: DomainRoute = {
        routeId: `${service.id}:${index}:${primaryDomain}`,
        service,
        root,
        primaryDomain,
        labels: [domainToLabel(primaryDomain, root)],
        groupName: groupsById.get(service.groupId)?.name || "Ungrouped",
        isDefault: false
      };
      zones.set(root, [...(zones.get(root) || []), route]);
    }
  }
  return Array.from(zones.entries()).map(([root, routes]) => ({ root, routes }));
}

function displayServiceName(route: Pick<DomainRoute, "service" | "primaryDomain">): string {
  return route.service.name.trim() || route.primaryDomain;
}

function displayRouteName(route: Pick<DomainRoute, "service" | "primaryDomain" | "isDefault">, t: (english: string, chinese: string) => string): string {
  return route.service.name.trim() || (route.isDefault ? t("Default fallback", "默认规则") : route.primaryDomain);
}

function rootLabel(root: string, t: (english: string, chinese: string) => string): string {
  if (root === "__custom") return t("Custom", "自定义");
  return root === "__default" ? t("Default", "默认") : root;
}

function routeKindLabel(route: DomainRoute, isRootRule: boolean, t: (english: string, chinese: string) => string): string {
  if (route.isDefault) return t("Default", "默认");
  if (route.service.matchMode === "custom") return t("Custom", "自定义");
  return isRootRule ? t("Rule", "规则") : t("Sub-rule", "子规则");
}

function isOpenableDomain(value: string): boolean {
  return /^[a-z0-9.-]+$/i.test(value) && !value.includes("..") && !value.startsWith(".") && !value.endsWith(".");
}

function extractHostDomains(rule: string): string[] {
  const domains = new Set<string>();
  const hostCallPattern = /\bHost(?:SNI)?\(([^)]*)\)/g;
  for (const match of rule.matchAll(hostCallPattern)) {
    const args = match[1] || "";
    for (const arg of args.split(",")) {
      const domain = normalizeDomain(arg.replace(/^[`'"]|[`'"]$/g, ""));
      if (domain) domains.add(domain);
    }
  }
  return Array.from(domains);
}

function copyCustomRule(rule: string, sourceDomain: string, copiedDomain: string): string {
  if (!rule.trim() || !isOpenableDomain(sourceDomain) || !isOpenableDomain(copiedDomain)) return "";
  return rule.split(sourceDomain).join(copiedDomain);
}

function copyDomainLabel(label: string): string {
  const clean = normalizeDomain(label);
  if (!clean || clean === "@") return "copy";
  if (clean.startsWith("copy-")) return clean;
  return `copy-${clean}`;
}

function countServicesByGroup(services: WebServiceWithRuntime[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const service of services) {
    counts.set(service.groupId, (counts.get(service.groupId) || 0) + 1);
  }
  return counts;
}

function domainsToDraft(domains: string[]) {
  if (domains.length === 0) return { domainRoot: "localhost", subdomainsText: "" };
  const roots = Array.from(new Set(domains.map(inferRootDomain)));
  if (roots.length !== 1) return { domainRoot: "", subdomainsText: domains.join(", ") };
  const root = roots[0];
  return {
    domainRoot: root,
    subdomainsText: domains.map((domain) => domainToLabel(domain, root)).join(", ")
  };
}

function composeDomains(rootInput: string, labelsInput: string): string[] {
  const root = normalizeDomain(rootInput);
  const labels = splitList(labelsInput);
  if (!root) return labels.map(normalizeDomain).filter(Boolean);
  if (labels.length === 0) return [root];
  return Array.from(
    new Set(
      labels
        .map((label) => {
          const normalizedLabel = normalizeDomain(label);
          if (!normalizedLabel || normalizedLabel === "@") return root;
          if (normalizedLabel === root || normalizedLabel.endsWith(`.${root}`)) return normalizedLabel;
          return `${normalizedLabel}.${root}`;
        })
        .filter(Boolean)
    )
  );
}

function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function inferRootDomain(domainInput: string): string {
  const domain = normalizeDomain(domainInput);
  const labels = domain.split(".").filter(Boolean);
  if (labels.length <= 1) return domain || "localhost";
  if (domain.endsWith(".localhost")) return "localhost";
  if (labels.length >= 4) return labels.slice(-3).join(".");
  return labels.slice(-2).join(".");
}

function domainToLabel(domainInput: string, rootInput: string): string {
  const domain = normalizeDomain(domainInput);
  const root = normalizeDomain(rootInput);
  if (!domain || domain === root) return "@";
  if (domain.endsWith(`.${root}`)) return domain.slice(0, -(root.length + 1));
  return domain;
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^\.+|\.+$/g, "");
}

function formatBackendTarget(value: string): { hostPort: string; scheme: string } {
  const authority = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/)[0];
  try {
    const url = new URL(value);
    return {
      hostPort: authority || url.host,
      scheme: url.protocol.replace(":", "") || value
    };
  } catch {
    return {
      hostPort: authority || value.replace(/^https?:\/\//, ""),
      scheme: value.startsWith("https://") ? "https" : value.startsWith("http://") ? "http" : "custom"
    };
  }
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const precision = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}
