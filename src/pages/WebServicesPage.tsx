import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Copy,
  EllipsisVertical,
  ExternalLink,
  FileText,
  GripVertical,
  Info,
  Layers,
  Pencil,
  Plus,
  Power,
  Save,
  Trash2
} from "lucide-react";
import { Fragment, FormEvent, useMemo, useState, type ReactNode } from "react";
import type { DashboardPayload, DiscoveredRoute, ImportRoutePreview, ServiceGroup, WebServicePreview, WebServiceTrafficStats, WebServiceWithRuntime } from "../../shared/types";
import {
  createGroup,
  createWebService,
  deleteGroup,
  deleteWebService,
  importAllDiscoveredRoutes,
  importDiscoveredRoute,
  previewCreateWebService,
  previewImportDiscoveredRoute,
  previewUpdateWebService,
  reorderGroups,
  reorderWebServices,
  toggleWebService,
  updateGroup,
  updateWebService,
  type WebServiceInput
} from "../api";
import { ConfigPreviewPanel } from "../components/ConfigPreviewPanel";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";
import { frontendProtocolForService } from "../lib/frontend-endpoints";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  accessLogs: boolean;
  metrics: boolean;
  tracing: boolean;
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

type GroupEditorState = {
  mode: "create" | "rename";
  group?: ServiceGroup;
};

const emptyDraft: DraftService = {
  name: "",
  enabled: true,
  matchMode: "host",
  groupId: "local",
  domainRoot: "",
  subdomainsText: "",
  customRule: "",
  listenPort: 16666,
  entryPointsText: "websecure",
  targetUrl: "",
  passHostHeader: true,
  middlewaresText: "",
  tlsMode: "none",
  certificateId: "",
  resolver: "letsencrypt",
  accessLogs: true,
  metrics: true,
  tracing: false,
  notes: ""
};

const selectClass = "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function WebServicesPage({ dashboard, onRefresh }: WebServicesPageProps) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState<WebServiceWithRuntime | null>(null);
  const [detailsRoute, setDetailsRoute] = useState<DomainRoute | null>(null);
  const [createMode, setCreateMode] = useState<"rule" | "subrule" | "default">("rule");
  const [draftPreset, setDraftPreset] = useState<Partial<DraftService> | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [groupEditor, setGroupEditor] = useState<GroupEditorState | null>(null);
  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>([]);
  const [activeRoot, setActiveRoot] = useState("__all");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportRoutePreview | null>(null);
  const [importingRouterName, setImportingRouterName] = useState<string | null>(null);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [runtimeRoutesOpen, setRuntimeRoutesOpen] = useState(false);
  const [importSaving, setImportSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [groupSaving, setGroupSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sortedServices = useMemo(() => [...dashboard.webServices].sort((a, b) => a.order - b.order), [dashboard.webServices]);
  const groupsById = useMemo(() => new Map(dashboard.groups.map((group) => [group.id, group])), [dashboard.groups]);
  const serviceCountByGroup = useMemo(() => countServicesByGroup(sortedServices), [sortedServices]);
  const zones = useMemo(() => buildDomainZones(sortedServices, groupsById), [groupsById, sortedServices]);
  const allRoutes = zones.flatMap((zone) => zone.routes);
  const routeCount = allRoutes.length;
  const activeRoutes = (activeRoot === "__all" ? allRoutes : zones.find((zone) => zone.root === activeRoot)?.routes || allRoutes).filter((route) => !groupsById.get(route.service.groupId)?.collapsed);
  const selectedServices = useMemo(() => {
    const selectedServiceIds = new Set(activeRoutes.filter((route) => selectedRouteIds.includes(route.routeId)).map((route) => route.service.id));
    return sortedServices.filter((service) => selectedServiceIds.has(service.id));
  }, [activeRoutes, selectedRouteIds, sortedServices]);
  const activeRootTemplate = useMemo(
    () => domainTemplateService(activeRoutes) || domainTemplateService(zones.find((zone) => zone.root === activeRoot)?.routes || []),
    [activeRoot, activeRoutes, zones]
  );
  const canCreateSubruleFromToolbar = isConcreteDomainRoot(activeRoot);

  const openCreate = (mode: "rule" | "subrule" | "default" = "rule") => {
    setEditing(null);
    setDraftPreset(null);
    setCreateMode(mode);
    setShowForm(true);
  };

  const openCreateSubrule = (root = activeRoot, template = activeRootTemplate) => {
    if (["__all", "__default", "__custom"].includes(root)) return;
    setEditing(null);
    setCreateMode("subrule");
    setDraftPreset(
      template
        ? {
            groupId: template.groupId,
            domainRoot: root,
            subdomainsText: "",
            listenPort: template.listenPort,
            entryPointsText: template.entryPoints.join(", "),
            targetUrl: "",
            passHostHeader: template.passHostHeader ?? true,
            middlewaresText: template.middlewares.join(", "),
            tlsMode: template.tls.mode,
            certificateId: template.tls.certificateId || "",
            resolver: template.tls.resolver || "letsencrypt",
            accessLogs: template.observability?.accessLogs ?? true,
            metrics: template.observability?.metrics ?? true,
            tracing: template.observability?.tracing ?? false
          }
        : {
            domainRoot: root,
            subdomainsText: "",
            targetUrl: ""
          }
    );
    setShowForm(true);
  };

  const openEdit = (service: WebServiceWithRuntime) => {
    const domains = domainsToDraft(service);
    const labels = splitList(domains.subdomainsText);
    const isRootHostRule = service.matchMode !== "custom" && labels.length > 0 && labels.every((label) => normalizeDomain(label) === "@");
    setEditing(service);
    setDraftPreset(null);
    setCreateMode(service.matchMode === "default" ? "default" : isRootHostRule ? "rule" : "subrule");
    setShowForm(true);
  };

  const openDuplicate = (route: DomainRoute) => {
    if (route.isDefault) return;
    const domains = { domainRoot: route.root, subdomainsText: domainToLabel(route.primaryDomain, route.root) };
    const label = domains.subdomainsText;
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
      accessLogs: route.service.observability?.accessLogs ?? true,
      metrics: route.service.observability?.metrics ?? true,
      tracing: route.service.observability?.tracing ?? false,
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
    setGroupEditor({ mode: "create" });
  };

  const handleRenameGroup = async (group: ServiceGroup) => {
    setGroupEditor({ mode: "rename", group });
  };

  const handleSaveGroup = async (name: string) => {
    const trimmedName = name.trim();
    if (!groupEditor || !trimmedName) return;
    if (groupEditor.mode === "rename" && groupEditor.group && trimmedName === groupEditor.group.name) {
      setGroupEditor(null);
      return;
    }
    setGroupSaving(true);
    setError(null);
    try {
      if (groupEditor.mode === "create") {
        await createGroup(trimmedName);
      } else if (groupEditor.group) {
        await updateGroup(groupEditor.group.id, { name: trimmedName });
      }
      setGroupEditor(null);
      await onRefresh();
    } catch (groupError) {
      setError(groupError instanceof Error ? groupError.message : groupEditor.mode === "create" ? t("Group create failed.", "分组创建失败。") : t("Group rename failed.", "分组重命名失败。"));
    } finally {
      setGroupSaving(false);
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

  const handleGroupDrop = async (targetId: string) => {
    if (!draggingGroupId || draggingGroupId === targetId) {
      setDraggingGroupId(null);
      return;
    }
    const ids = dashboard.groups.map((group) => group.id);
    const from = ids.indexOf(draggingGroupId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) {
      setDraggingGroupId(null);
      return;
    }
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    setDraggingGroupId(null);
    setError(null);
    try {
      await reorderGroups(ids);
      await onRefresh();
    } catch (groupError) {
      setError(groupError instanceof Error ? groupError.message : t("Group reorder failed.", "分组排序失败。"));
    }
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

  const handlePreviewImport = async (route: DiscoveredRoute) => {
    setError(null);
    setNotice(null);
    setImportPreview(null);
    setImportingRouterName(route.routerName);
    try {
      setImportPreview(await previewImportDiscoveredRoute(route.routerName));
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : t("Import preview failed.", "导入预览失败。"));
    } finally {
      setImportingRouterName(null);
    }
  };

  const handleApplyImport = async () => {
    if (!importPreview) return;
    setImportSaving(true);
    setError(null);
    setNotice(null);
    try {
      await importDiscoveredRoute(importPreview.route.routerName, importPreview.service.groupId);
      setImportPreview(null);
      await onRefresh();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : t("Import failed.", "导入失败。"));
    } finally {
      setImportSaving(false);
    }
  };

  const handleBulkImport = async () => {
    setBulkImporting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await importAllDiscoveredRoutes();
      setNotice(t(`Mapped ${result.created.length} external read-only route(s). Skipped ${result.skipped.length}.`, `已映射 ${result.created.length} 条外部只读路由，跳过 ${result.skipped.length} 条。`));
      await onRefresh();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : t("Bulk import failed.", "批量映射失败。"));
    } finally {
      setBulkImporting(false);
    }
  };

  return (
    <section className="grid gap-3">
      {error ? <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 p-3 text-sm text-cyan-700 dark:border-cyan-300/35 dark:bg-cyan-300/10 dark:text-cyan-100">{notice}</div> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{t("GateLite managed mappings", "GateLite 托管映射")}</div>
            <h2 className="truncate text-base font-semibold">{t("Mapped and generated rules", "已映射和自建规则")}</h2>
          </div>
          <div className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border bg-muted/45 p-1">
            <Button type="button" variant={activeRoot === "__all" ? "outline" : "ghost"} size="sm" onClick={() => setActiveRoot("__all")}>
              {t("All", "全部")}
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
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={handleAddGroup}>
            <Layers className="size-4" />
            {t("Groups", "分组")}
          </Button>
          {canCreateSubruleFromToolbar ? (
            <Button type="button" variant="outline" onClick={() => openCreateSubrule(activeRoot, activeRootTemplate)}>
              <Plus className="size-4" />
              {t("New sub-rule", "新建子规则")}
            </Button>
          ) : null}
          <Button type="button" onClick={() => openCreate("rule")}>
            <Plus className="size-4" />
            {t("New rule", "新建规则")}
          </Button>
        </div>
      </div>

      <GroupStrip
        groups={dashboard.groups}
        counts={serviceCountByGroup}
        draggingGroupId={draggingGroupId}
        onDragStart={setDraggingGroupId}
        onDrop={handleGroupDrop}
        onToggle={handleGroupToggle}
        onRename={handleRenameGroup}
        onDelete={handleDeleteGroup}
      />

      <RouteDataTable
        routes={activeRoutes}
        activeRoot={activeRoot}
        selectedRouteIds={selectedRouteIds}
        draggingId={draggingId}
        onDragStart={setDraggingId}
        onDrop={handleDrop}
        onSelect={handleSelectRoute}
        onSelectAll={handleSelectVisibleRoutes}
        onToggle={handleToggle}
        onBulkToggle={handleBulkToggle}
        onDuplicate={openDuplicate}
        onCreateSubrule={(root, template) => openCreateSubrule(root, template)}
        onDetails={setDetailsRoute}
        onEdit={openEdit}
        onDelete={handleDelete}
      />

      <DiscoveredRouteTable
        routes={dashboard.discoveredRoutes}
        importingRouterName={importingRouterName}
        bulkImporting={bulkImporting}
        open={runtimeRoutesOpen}
        onOpenChange={setRuntimeRoutesOpen}
        onPreviewImport={handlePreviewImport}
        onBulkImport={handleBulkImport}
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

      {detailsRoute ? (
        <Modal title={displayRouteName(detailsRoute, t)} subtitle={t("Reverse proxy rule details, generated Traefik match, runtime state, and traffic.", "反代规则详情、生成的 Traefik 匹配、运行状态和流量。")} onClose={() => setDetailsRoute(null)}>
          <RouteDetails route={detailsRoute} />
        </Modal>
      ) : null}

      {groupEditor ? (
        <GroupEditor
          editor={groupEditor}
          saving={groupSaving}
          onClose={() => setGroupEditor(null)}
          onSubmit={handleSaveGroup}
        />
      ) : null}

      {importPreview ? (
        <Modal title={t("Map existing Traefik router", "映射已有 Traefik 路由")} subtitle={t("Create a GateLite-managed mapping without writing a duplicate file-provider router.", "创建 GateLite 管理映射，但不写出重复的 file-provider 路由。")} onClose={() => setImportPreview(null)}>
          <div className="grid gap-4">
            <div className="grid gap-3 rounded-lg border bg-background/35 p-3 text-sm md:grid-cols-3">
              <DetailCell label={t("Frontend domain", "前端域名")} value={importPreview.route.domains.join(", ")} mono />
              <DetailCell label={t("Backend IP:port", "后端 IP:端口")} value={formatBackendTarget(importPreview.route.backend.targetUrl || "").hostPort || importPreview.route.backend.targetUrl || ""} mono />
              <DetailCell label={t("Source", "来源")} value={sourceDetailLabel(importPreview.route.provider, t)} />
            </div>
            <ConfigPreviewPanel
              title={t("Mapping preview", "映射预览")}
              description={t("Mapped routes stay read-only in Traefik and do not generate duplicate YAML.", "映射路由保持读取现有 Traefik 对象，不生成重复 YAML。")}
              actionLabel={t("map", "映射")}
              targetLabel={importPreview.route.routerName}
              currentYaml={importPreview.currentYaml}
              nextYaml={importPreview.nextYaml}
              diff={importPreview.diff}
              clearLabel={t("Clear", "清除")}
              noChangesLabel={t("No generated YAML changes. This is expected for mapped imports.", "生成的 YAML 没有变化；映射导入就是这样。")}
              currentLabel={t("Current YAML", "当前 YAML")}
              nextLabel={t("Next YAML", "下一版 YAML")}
              addedLabel={t("added", "新增")}
              removedLabel={t("removed", "删除")}
              onClear={() => setImportPreview(null)}
            />
            <div className="rounded-lg border bg-muted/25 p-3 text-xs text-muted-foreground">
              {importPreview.warnings.map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
            <footer className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setImportPreview(null)}>
                {t("Cancel", "取消")}
              </Button>
              <Button type="button" disabled={importSaving} onClick={() => void handleApplyImport()}>
                <Save className="size-4" />
                {importSaving ? t("Mapping...", "映射中...") : t("Map into GateLite", "映射到 GateLite")}
              </Button>
            </footer>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function DiscoveredRouteTable({
  routes,
  importingRouterName,
  bulkImporting,
  open,
  onOpenChange,
  onPreviewImport,
  onBulkImport
}: {
  routes: DiscoveredRoute[];
  importingRouterName: string | null;
  bulkImporting: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPreviewImport: (route: DiscoveredRoute) => Promise<void>;
  onBulkImport: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const unmanagedCount = routes.filter((route) => route.managedMode === "unmanaged").length;
  const importableExternalCount = routes.filter((route) => route.importable && route.managedMode === "unmanaged" && route.provider !== "internal").length;
  return (
    <div className="overflow-hidden rounded-xl border bg-card/80">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <button type="button" className="flex min-w-0 items-center gap-2 text-left" onClick={() => onOpenChange(!open)} aria-expanded={open}>
          {open ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
          <span className="min-w-0">
            <span className="block text-xs text-muted-foreground">{t("Read-only reference from Traefik runtime", "来自 Traefik 运行时的只读参考")}</span>
            <span className="block truncate text-base font-semibold">{t("Discovered reverse proxy domains", "发现的反代域名")}</span>
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" className="rounded-md">
            {t(`${routes.length} routers`, `${routes.length} 个路由`)}
          </Badge>
          <Badge variant="outline" className="rounded-md">
            {t(`${unmanagedCount} unmapped`, `${unmanagedCount} 个未映射`)}
          </Badge>
          <Button type="button" variant="outline" size="sm" disabled={importableExternalCount === 0 || bulkImporting} onClick={() => void onBulkImport()}>
            <Plus className="size-3.5" />
            {bulkImporting ? t("Mapping...", "映射中...") : t("Map external read-only", "一键映射外部只读")}
            <Badge variant="secondary" className="ml-1 rounded-full px-1.5 py-0 text-[10px]">
              {importableExternalCount}
            </Badge>
          </Button>
        </div>
      </div>
      {open ? <div className="overflow-x-auto">
        <Table className="min-w-[1120px]">
          <TableHeader className="bg-muted/65">
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-[250px]">{t("Frontend domain", "前端域名")}</TableHead>
              <TableHead className="min-w-[230px]">{t("Backend IP:port", "后端 IP:端口")}</TableHead>
              <TableHead className="w-40">{t("Source", "来源")}</TableHead>
              <TableHead className="w-28">{t("Status", "状态")}</TableHead>
              <TableHead className="w-20 text-right">QPS</TableHead>
              <TableHead className="w-24 text-right">
                <span className="inline-flex items-center gap-1">
                  <MetricInfoTooltip />
                  {t("Down", "下行")}
                </span>
              </TableHead>
              <TableHead className="w-24 text-right">
                <span className="inline-flex items-center gap-1">
                  <MetricInfoTooltip />
                  {t("Up", "上行")}
                </span>
              </TableHead>
              <TableHead className="w-16 text-right">{t("Conn.", "实时连接")}</TableHead>
              <TableHead className="w-28 text-right">{t("Management", "管理")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {routes.map((route) => {
              const frontend = discoveredFrontend(route);
              const backend = formatBackendTarget(route.backend.targetUrl || route.backend.servers[0] || "");
              const canImport = route.importable && route.managedMode === "unmanaged";
              return (
                <TableRow key={route.routerName} className={`h-11 ${route.managedMode === "mapped" || route.managedMode === "unmanaged" ? "bg-amber-400/[0.06] dark:bg-amber-300/[0.025]" : ""}`}>
                  <TableCell className="py-1.5">
                    <div className="grid min-w-0 gap-0.5">
                      <span className="truncate font-mono text-xs font-medium text-cyan-700 dark:text-cyan-100">{frontend.label}</span>
                      <span className="truncate text-[10px] text-muted-foreground">{frontend.meta}</span>
                    </div>
                  </TableCell>
                  <TableCell className="py-1.5">
                    <div className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-1 text-xs leading-tight">
                      <ArrowRight className="size-3.5 text-muted-foreground" />
                      <span className="truncate font-mono text-foreground">{backend.hostPort || route.backend.targetUrl || t("No server URL", "无后端地址")}</span>
                      <span />
                      <span className="truncate text-muted-foreground">{backend.scheme || route.backend.serviceName || route.serviceName || "service"}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <SourceBadge provider={route.provider} mode={route.provider === "internal" ? "internal" : route.managedMode === "generated" ? "generated" : "external"} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge status={route.status} className="h-5 rounded-md px-1.5 text-[10px]" />
                      <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[10px]">
                        {route.tls ? "TLS" : "HTTP"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <QpsValue traffic={route.traffic} />
                  </TableCell>
                  <TableCell className="text-right">
                    <TrafficValue traffic={route.traffic} direction="down" />
                  </TableCell>
                  <TableCell className="text-right">
                    <TrafficValue traffic={route.traffic} direction="up" />
                  </TableCell>
                  <TableCell className="text-right">
                    <ConnectionValue traffic={route.traffic} readOnlyExternal={route.provider !== "internal" && route.managedMode !== "generated"} />
                  </TableCell>
                  <TableCell className="text-right">
                    {route.managedMode !== "unmanaged" ? (
                      route.managedMode === "mapped" ? <ReadOnlyBadge /> : <Badge variant="secondary" className="rounded-md">{t("Generated", "已生成")}</Badge>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!canImport || importingRouterName === route.routerName}
                        title={!route.importable ? route.importWarnings.join(" ") : undefined}
                        onClick={() => void onPreviewImport(route)}
                      >
                        <Plus className="size-3.5" />
                        {importingRouterName === route.routerName ? t("Previewing...", "预览中...") : t("Map", "映射")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {routes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-sm text-muted-foreground">
                  {t("No Traefik HTTP routers were discovered.", "没有发现 Traefik HTTP 路由。")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div> : null}
    </div>
  );
}

function RouteDataTable({
  routes,
  activeRoot,
  selectedRouteIds,
  draggingId,
  onDragStart,
  onDrop,
  onSelect,
  onSelectAll,
  onToggle,
  onBulkToggle,
  onDuplicate,
  onCreateSubrule,
  onDetails,
  onEdit,
  onDelete
}: {
  routes: DomainRoute[];
  activeRoot: string;
  selectedRouteIds: string[];
  draggingId: string | null;
  onDragStart: (id: string) => void;
  onDrop: (id: string) => void;
  onSelect: (id: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
  onToggle: (service: WebServiceWithRuntime) => Promise<void>;
  onBulkToggle: (enabled: boolean) => Promise<void>;
  onDuplicate: (route: DomainRoute) => void;
  onCreateSubrule: (root: string, template?: WebServiceWithRuntime) => void;
  onDetails: (route: DomainRoute) => void;
  onEdit: (service: WebServiceWithRuntime) => void;
  onDelete: (service: WebServiceWithRuntime) => Promise<void>;
}) {
  const { t } = useLanguage();
  const selectedCount = routes.filter((route) => selectedRouteIds.includes(route.routeId)).length;
  const allVisibleSelected = routes.length > 0 && selectedCount === routes.length;
  const sections = groupRoutesForTable(routes, activeRoot);

  return (
    <div className="overflow-hidden rounded-xl border bg-card/80">
      <div className="overflow-x-auto">
        <Table className="min-w-[1160px]">
          <TableHeader className="bg-muted/65">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-6 px-1" />
              <TableHead className="w-7 px-1">
                <Checkbox aria-label={t("Select visible rules", "选择当前规则")} checked={allVisibleSelected} onCheckedChange={(checked) => onSelectAll(Boolean(checked))} />
              </TableHead>
              <TableHead className="min-w-[180px]">{t("Title", "标题")}</TableHead>
              <TableHead className="min-w-[240px]">{t("Frontend domain", "前端域名")}</TableHead>
              <TableHead className="min-w-[210px]">{t("Backend IP:port", "后端 IP:端口")}</TableHead>
              <TableHead className="w-24">{t("Type", "类型")}</TableHead>
              <TableHead className="w-28">{t("Status", "状态")}</TableHead>
              <TableHead className="w-20 text-right">QPS</TableHead>
              <TableHead className="w-24 text-right">
                <span className="inline-flex items-center gap-1">
                  <MetricInfoTooltip />
                  {t("Down", "下行")}
                </span>
              </TableHead>
              <TableHead className="w-24 text-right">
                <span className="inline-flex items-center gap-1">
                  <MetricInfoTooltip />
                  {t("Up", "上行")}
                </span>
              </TableHead>
              <TableHead className="w-16 text-right">
                <span className="inline-flex items-center gap-1">
                  {t("Conn.", "实时连接")}
                </span>
              </TableHead>
              <TableHead className="w-8 px-1 text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sections.map((section) => (
              <Fragment key={section.root}>
                {section.showHeader ? (
                  <TableRow key={`${section.root}:heading`} className="bg-muted/25 hover:bg-muted/25">
                    <TableCell colSpan={12} className="h-9 px-3 py-1.5">
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="text-xs text-muted-foreground">{t("Main domain", "主域名")}</span>
                          <span className="truncate font-mono text-sm font-medium">{rootLabel(section.root, t)}</span>
                          <Badge variant="secondary" className="h-5 rounded-md px-1.5 text-[10px]">
                            {t(`${section.routes.length} rules`, `${section.routes.length} 条规则`)}
                          </Badge>
                        </div>
                        {!["__default", "__custom"].includes(section.root) ? (
                          <Button type="button" variant="outline" size="xs" onClick={() => onCreateSubrule(section.root, domainTemplateService(section.routes))}>
                            <Plus className="size-3.5" />
                            {t("New sub-rule", "新建子规则")}
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
                {section.routes.map((route) => (
                  <RouteTableRow
                    key={route.routeId}
                    route={route}
                    selected={selectedRouteIds.includes(route.routeId)}
                    dragging={draggingId === route.service.id}
                    onDragStart={onDragStart}
                    onDrop={onDrop}
                    onSelect={onSelect}
                    onToggle={onToggle}
                    onDuplicate={onDuplicate}
                    onDetails={onDetails}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                ))}
              </Fragment>
            ))}
            {routes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="h-24 text-center text-sm text-muted-foreground">
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

function RouteTableRow({
  route,
  selected,
  dragging,
  onDragStart,
  onDrop,
  onSelect,
  onToggle,
  onDuplicate,
  onDetails,
  onEdit,
  onDelete
}: {
  route: DomainRoute;
  selected: boolean;
  dragging: boolean;
  onDragStart: (id: string) => void;
  onDrop: (id: string) => void;
  onSelect: (id: string, checked: boolean) => void;
  onToggle: (service: WebServiceWithRuntime) => Promise<void>;
  onDuplicate: (route: DomainRoute) => void;
  onDetails: (route: DomainRoute) => void;
  onEdit: (service: WebServiceWithRuntime) => void;
  onDelete: (service: WebServiceWithRuntime) => Promise<void>;
}) {
  const { t } = useLanguage();
  const service = route.service;
  const frontend = formatFrontendEndpoint(route, service, t);
  const backend = formatBackendTarget(service.targetUrl);
  const traffic = service.traffic;
  const frontendProtocol = frontendProtocolForService(service);
  const isRootRule = route.labels.some((label) => label === "@");
  const displayName = displayRouteName(route, t);
  const isExternalReadOnly = service.managementMode === "mapped";

  return (
    <TableRow
      data-state={selected ? "selected" : undefined}
      className={`${dragging ? "outline outline-1 outline-cyan-600/60 dark:outline-cyan-300/70" : ""} ${isExternalReadOnly ? "bg-amber-400/[0.07] dark:bg-amber-300/[0.035]" : ""} h-10`}
      draggable
      onDragStart={() => onDragStart(service.id)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={() => void onDrop(service.id)}
      onClick={() => onSelect(route.routeId, !selected)}
    >
      <TableCell className="px-1">
        <Button variant="ghost" size="icon-xs" aria-label={t("Drag to reorder", "拖拽排序")}>
          <GripVertical className="size-3.5" />
        </Button>
      </TableCell>
      <TableCell className="px-1">
        <Checkbox checked={selected} aria-label={t(`Select ${displayName}`, `选择 ${displayName}`)} onClick={(event) => event.stopPropagation()} onCheckedChange={(checked) => onSelect(route.routeId, Boolean(checked))} />
      </TableCell>
      <TableCell className="py-1.5">
        <div className="grid min-w-0 gap-0.5 leading-tight">
          <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
          <span className="truncate text-[10px] text-muted-foreground">{route.groupName}</span>
        </div>
      </TableCell>
      <TableCell className="py-1.5">
        {frontend.href ? (
          <a className="grid min-w-0 max-w-full gap-0 font-mono text-xs font-medium leading-tight text-cyan-700 hover:text-cyan-800 dark:text-cyan-100 dark:hover:text-cyan-200" href={frontend.href} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
            <span className="inline-flex min-w-0 items-center gap-1">
              <span className="truncate">{frontend.label}</span>
              <ExternalLink className="size-3 shrink-0" />
            </span>
            <span className="truncate text-[10px] font-normal text-muted-foreground">{frontend.meta}</span>
          </a>
        ) : (
          <span className="grid min-w-0 gap-0 font-mono text-xs leading-tight text-cyan-700 dark:text-cyan-100">
            <span className="truncate">{frontend.label}</span>
            <span className="truncate text-[10px] text-muted-foreground">{frontend.meta}</span>
          </span>
        )}
      </TableCell>
      <TableCell className="py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
          <div className="grid min-w-0 gap-0 font-mono leading-tight">
            <span className="min-w-0 truncate text-xs text-foreground">{backend.hostPort || service.targetUrl}</span>
            <span className="text-[10px] text-muted-foreground">{backend.scheme}</span>
          </div>
        </div>
      </TableCell>
      <TableCell className="py-1.5">
        <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[10px]">
          {routeKindLabel(route, isRootRule, t)}
        </Badge>
      </TableCell>
      <TableCell className="py-1.5">
        <div className="flex min-w-0 items-center gap-1">
          <StatusBadge status={service.runtime?.status || (service.enabled ? "unknown" : "offline")} label={service.enabled ? undefined : t("Disabled", "停用")} className="h-5 rounded-md px-1.5 text-[10px]" />
          <Badge variant="outline" className="h-5 shrink-0 rounded-md px-1.5 text-[10px]">
            {frontendProtocol.toUpperCase()}
          </Badge>
          {isExternalReadOnly ? <ReadOnlyBadge compact /> : null}
        </div>
      </TableCell>
      <TableCell className="text-right">
        <QpsValue traffic={traffic} />
      </TableCell>
      <TableCell className="text-right">
        <TrafficValue traffic={traffic} direction="down" />
      </TableCell>
      <TableCell className="text-right">
        <TrafficValue traffic={traffic} direction="up" />
      </TableCell>
      <TableCell className="text-right">
        <ConnectionValue traffic={traffic} readOnlyExternal={isExternalReadOnly} />
      </TableCell>
      <TableCell className="px-1">
        <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label={t("Rule actions", "规则操作")}>
                <EllipsisVertical className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>{t("Rule actions", "规则操作")}</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => onDetails(route)}>
                <FileText className="size-4" />
                {t("Details", "详情")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void onToggle(service)}>
                <Power className="size-4" />
                {service.enabled ? t("Disable", "停用") : t("Enable", "启用")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={route.isDefault} onSelect={() => onDuplicate(route)}>
                <Copy className="size-4" />
                {t("Copy as rule", "复制规则")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onEdit(service)}>
                <Pencil className="size-4" />
                {t("Edit", "编辑")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => void onDelete(service)}>
                <Trash2 className="size-4" />
                {t("Delete", "删除")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  );
}

function groupRoutesForTable(routes: DomainRoute[], activeRoot: string): Array<{ root: string; routes: DomainRoute[]; showHeader: boolean }> {
  if (activeRoot !== "__all") {
    return [{ root: activeRoot, routes, showHeader: routes.length > 0 }];
  }
  const groups = new Map<string, DomainRoute[]>();
  for (const route of routes) {
    groups.set(route.root, [...(groups.get(route.root) || []), route]);
  }
  return Array.from(groups.entries()).map(([root, groupRoutes]) => ({
    root,
    routes: groupRoutes,
    showHeader: true
  }));
}

function domainTemplateService(routes: DomainRoute[]): WebServiceWithRuntime | undefined {
  return routes.find((route) => route.labels.includes("@") && !route.isDefault)?.service;
}

function MetricInfoTooltip() {
  const { t } = useLanguage();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex size-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("Traffic metric requirements", "流量指标说明")}
          onClick={(event) => event.stopPropagation()}
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="block max-w-sm text-left leading-relaxed">
        {t(
          "Imported read-only routes show QPS and up/down traffic when Traefik Prometheus metrics expose router or service counters and GateLite can read TRAEFIK_API_URL/metrics. Enable Prometheus metrics with router/service labels for the most detailed view, then refresh GateLite. Per-domain live connections are not exposed by Traefik; use the dashboard entrypoint connection count instead.",
          "导入的只读路由只有在 Traefik Prometheus metrics 暴露 router 或 service 计数器，且 GateLite 能读取 TRAEFIK_API_URL/metrics 后，才会显示 QPS 和上下行。想看最细的信息，请在 Traefik 的 traffic/metrics 中启用 Prometheus 指标和 router/service 标签后刷新 GateLite。实时连接数没有域名/路由维度，只能看仪表盘里的入口连接数。"
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function QpsValue({ traffic }: { traffic?: WebServiceTrafficStats }) {
  const { t } = useLanguage();

  if (!traffic || traffic.source === "unavailable") {
    return <UnavailableMetric caption={t("metrics not connected", "未接入指标")} />;
  }

  return (
    <span className="grid justify-items-end gap-0 leading-tight">
      <span className="font-mono text-[13px] text-emerald-700 dark:text-emerald-100">{formatNumber(traffic.requestsPerSecond, 2)}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{t(`${formatNumber(traffic.totalRequests, 0)} req`, `${formatNumber(traffic.totalRequests, 0)} 次`)}</span>
    </span>
  );
}

function TrafficValue({ traffic, direction }: { traffic?: WebServiceTrafficStats; direction: "down" | "up" }) {
  const { t } = useLanguage();

  if (!traffic || traffic.source === "unavailable") {
    return <UnavailableMetric caption={t("metrics not connected", "未接入指标")} />;
  }

  const value = direction === "down" ? traffic.responseBytes : traffic.requestBytes;
  const rate = direction === "down" ? traffic.responseBytesPerSecond : traffic.requestBytesPerSecond;
  const toneClass = direction === "down" ? "text-cyan-700 dark:text-cyan-100" : "text-amber-700 dark:text-amber-100";

  return (
    <span className="grid justify-items-end gap-0 leading-tight">
      <span className={`font-mono text-[13px] ${toneClass}`}>{formatBytes(value)}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{formatBytesPerSecond(rate)}</span>
    </span>
  );
}

function ConnectionValue({ traffic, readOnlyExternal = false }: { traffic?: WebServiceTrafficStats; readOnlyExternal?: boolean }) {
  const { t } = useLanguage();

  if (readOnlyExternal) {
    return <UnavailableMetric caption={t("entrypoint only", "入口级")} />;
  }

  if (!traffic || traffic.source === "unavailable" || traffic.openConnectionsScope === "unavailable") {
    return <UnavailableMetric caption={t("metrics not connected", "未接入指标")} />;
  }

  if (traffic.openConnectionsScope !== "service") {
    return <UnavailableMetric caption={t("dashboard", "看仪表盘")} />;
  }

  return <span className="font-mono text-sm text-foreground">{traffic.openConnections}</span>;
}

function UnavailableMetric({ caption }: { caption: string }) {
  return (
    <span className="grid justify-items-end gap-0 leading-tight">
      <span className="font-mono text-[13px] text-muted-foreground">N/A</span>
      <span className="text-[10px] text-muted-foreground">{caption}</span>
    </span>
  );
}

function RouteDetails({ route }: { route: DomainRoute }) {
  const { t } = useLanguage();
  const service = route.service;
  const traffic = service.traffic;
  const frontend = formatFrontendEndpoint(route, service, t);
  const backend = formatBackendTarget(service.targetUrl);
  const isRootRule = route.labels.some((label) => label === "@");
  const isExternalReadOnly = service.managementMode === "mapped";
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-xl border bg-background/35 p-4 text-sm md:grid-cols-3">
        <DetailCell label={t("Rule type", "规则类型")} value={routeKindLabel(route, isRootRule, t)} />
        <DetailCell label={t("Group", "分组")} value={route.groupName} />
        <DetailCell label={t("Status", "状态")} value={service.enabled ? service.runtime?.status || "unknown" : "disabled"} />
        <DetailCell label={t("Frontend domain", "前端域名")} value={`${frontend.label} · ${frontend.meta}`} mono />
        <DetailCell label={t("Backend IP:port", "后端 IP:端口")} value={`${backend.hostPort} (${backend.scheme})`} mono />
        <DetailCell label={t("Host header", "Host 头")} value={service.passHostHeader === false ? t("Backend host", "后端 Host") : t("Frontend host", "前端 Host")} />
      </div>

      <div className="grid gap-3 rounded-xl border bg-background/35 p-4 text-sm md:grid-cols-3">
        <DetailCell label={t("Traefik rule", "Traefik 规则")} value={service.runtime?.rule || fallbackRuleText(service)} mono className="md:col-span-2" />
        <DetailCell label={t("Runtime router", "运行时路由")} value={service.runtime?.name || t("Unmatched", "未匹配")} mono />
        <DetailCell label={t("Entrypoints", "入口点")} value={service.entryPoints.join(", ")} />
        <DetailCell label={t("Middlewares", "中间件")} value={service.middlewares.length ? service.middlewares.join(", ") : t("None", "无")} />
        <DetailCell label="TLS" value={tlsDetailText(service, t)} />
        <DetailCell label={t("Observability", "观测")} value={observabilityText(service, t)} />
      </div>

      <div className="grid gap-3 rounded-xl border bg-background/35 p-4 text-sm md:grid-cols-5">
        <DetailCell label={t("Requests", "请求数")} value={requestDetailText(traffic, t)} mono />
        <DetailCell label="QPS" value={qpsDetailText(traffic, t)} mono />
        <DetailCell label={t("Downstream", "下行")} value={trafficDetailText(traffic, "down", t)} mono />
        <DetailCell label={t("Upstream", "上行")} value={trafficDetailText(traffic, "up", t)} mono />
        <DetailCell label={t("Live connections", "实时连接")} value={connectionDetailText(traffic, t, isExternalReadOnly)} mono />
      </div>

      {service.notes ? (
        <div className="rounded-xl border bg-background/35 p-4 text-sm">
          <div className="mb-1 text-xs text-muted-foreground">{t("Notes", "备注")}</div>
          <div className="whitespace-pre-wrap break-words">{service.notes}</div>
        </div>
      ) : null}
    </div>
  );
}

function requestDetailText(traffic: WebServiceTrafficStats | undefined, t: (english: string, chinese: string) => string): string {
  if (!traffic || traffic.source === "unavailable") return t("N/A (metrics not connected)", "N/A（未接入指标）");
  return String(traffic.totalRequests);
}

function qpsDetailText(traffic: WebServiceTrafficStats | undefined, t: (english: string, chinese: string) => string): string {
  if (!traffic || traffic.source === "unavailable") return t("N/A (metrics not connected)", "N/A（未接入指标）");
  return formatNumber(traffic.requestsPerSecond, 2);
}

function trafficDetailText(traffic: WebServiceTrafficStats | undefined, direction: "down" | "up", t: (english: string, chinese: string) => string): string {
  if (!traffic || traffic.source === "unavailable") return t("N/A (metrics not connected)", "N/A（未接入指标）");
  const rate = direction === "down" ? traffic.responseBytesPerSecond : traffic.requestBytesPerSecond;
  const total = direction === "down" ? traffic.responseBytes : traffic.requestBytes;
  return `${formatBytesPerSecond(rate)} / ${formatBytes(total)}`;
}

function connectionDetailText(traffic: WebServiceTrafficStats | undefined, t: (english: string, chinese: string) => string, readOnlyExternal = false): string {
  if (readOnlyExternal) return t("N/A (entrypoint only in dashboard)", "N/A（只能看仪表盘入口连接数）");
  if (!traffic || traffic.source === "unavailable" || traffic.openConnectionsScope === "unavailable") return t("N/A (metrics not connected)", "N/A（未接入指标）");
  if (traffic.openConnectionsScope !== "service") return t("N/A (entrypoint only in dashboard)", "N/A（只能看仪表盘入口连接数）");
  return `${traffic.openConnections} (${connectionScopeLabel(traffic.openConnectionsScope, t)})`;
}

function connectionScopeLabel(scope: WebServiceTrafficStats["openConnectionsScope"], t: (english: string, chinese: string) => string): string {
  return scope === "service" ? t("rule", "规则") : t("entrypoint", "入口点");
}

function GroupEditor({
  editor,
  saving,
  onClose,
  onSubmit
}: {
  editor: GroupEditorState;
  saving: boolean;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState(editor.group?.name || "");
  const trimmedName = name.trim();
  const isRenameUnchanged = editor.mode === "rename" && trimmedName === editor.group?.name;
  const title = editor.mode === "create" ? t("New group", "新建分组") : t("Rename group", "重命名分组");
  const subtitle =
    editor.mode === "create"
      ? t("Create a Web service group for organizing reverse proxy rules.", "创建 Web 服务分组，用于整理反代规则。")
      : t("Rename this group without changing its rules or generated Traefik config.", "只重命名分组，不改变其中规则或生成的 Traefik 配置。");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onSubmit(trimmedName);
  };

  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose}>
      <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
        <Field label={t("Group name", "分组名称")}>
          <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus required />
        </Field>
        <Separator />
        <footer className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("Cancel", "取消")}
          </Button>
          <Button type="submit" disabled={saving || !trimmedName || isRenameUnchanged}>
            <Save className="size-4" />
            {saving ? t("Saving...", "保存中...") : t("Save", "保存")}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

function DetailCell({ label, value, mono, className }: { label: string; value: string; mono?: boolean; className?: string }) {
  return (
    <div className={`grid min-w-0 gap-1 ${className || ""}`}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`break-words font-medium ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}

function formatFrontendEndpoint(
  route: DomainRoute,
  service: WebServiceWithRuntime,
  t: (english: string, chinese: string) => string
): { label: string; meta: string; href?: string } {
  if (route.isDefault) {
    const label = t("Unmatched domains", "未匹配域名");
    return { label, meta: t("Default fallback", "默认规则") };
  }
  if (!isOpenableDomain(route.primaryDomain)) {
    const label = service.matchMode === "custom" ? service.customRule || t("Custom Traefik rule", "自定义 Traefik 规则") : route.primaryDomain;
    return {
      label,
      meta: service.matchMode === "custom" ? t("Custom match", "自定义匹配") : t("Not openable", "不可直接打开")
    };
  }
  const scheme = frontendProtocolForService(service);
  const href = `${scheme}://${route.primaryDomain}:${service.listenPort}`;
  return {
    label: route.primaryDomain,
    meta: `${scheme.toUpperCase()} :${service.listenPort}`,
    href
  };
}

function discoveredFrontend(route: DiscoveredRoute): { label: string; meta: string } {
  const domainLabel = route.domains.length > 1 ? `${route.domains[0]} +${route.domains.length - 1}` : route.domains[0] || route.rule || route.routerName;
  const entryPoints = route.entryPoints.length ? route.entryPoints.join(", ") : "no entrypoint";
  return {
    label: domainLabel,
    meta: `${route.routerName} · ${entryPoints}`
  };
}

function SourceBadge({ provider, mode }: { provider?: string; mode: "external" | "generated" | "internal" }) {
  const { t } = useLanguage();
  if (mode === "generated") {
    return (
      <div className="flex flex-wrap gap-1">
        <Badge variant="secondary" className="rounded-md border-cyan-500/35 bg-cyan-500/10 text-cyan-700 dark:border-cyan-300/35 dark:bg-cyan-300/10 dark:text-cyan-100">
          {t("GateLite", "GateLite")}
        </Badge>
        <Badge variant="outline" className="rounded-md text-muted-foreground">
          file provider
        </Badge>
      </div>
    );
  }
  if (mode === "internal") {
    return (
      <div className="flex flex-wrap gap-1">
        <Badge variant="outline" className="rounded-md border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:border-zinc-400/30 dark:bg-zinc-400/10 dark:text-zinc-300">
          {t("Traefik internal", "Traefik 内部")}
        </Badge>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      <ReadOnlyBadge />
      <Badge variant="outline" className="rounded-md border-amber-500/30 bg-amber-500/10 text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/5 dark:text-amber-100/85">
        {provider || "unknown"} provider
      </Badge>
    </div>
  );
}

function ReadOnlyBadge({ compact = false }: { compact?: boolean }) {
  const { t } = useLanguage();
  return (
    <Badge variant="outline" className={`rounded-md border-amber-500/35 bg-amber-500/10 text-amber-700 dark:border-amber-300/40 dark:bg-amber-300/10 dark:text-amber-100 ${compact ? "h-5 px-1.5 text-[10px]" : ""}`}>
      {compact ? t("Read-only", "只读") : t("External read-only", "外部只读")}
    </Badge>
  );
}

function sourceDetailLabel(provider: string | undefined, t: (english: string, chinese: string) => string): string {
  return `${t("External read-only", "外部只读")} · ${provider || "unknown"} provider`;
}

function GroupStrip({
  groups,
  counts,
  draggingGroupId,
  onDragStart,
  onDrop,
  onToggle,
  onRename,
  onDelete
}: {
  groups: ServiceGroup[];
  counts: Map<string, number>;
  draggingGroupId: string | null;
  onDragStart: (id: string) => void;
  onDrop: (id: string) => Promise<void>;
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
          <div
            key={group.id}
            className={`flex items-center gap-1 rounded-lg border bg-background/45 px-1.5 py-1 ${draggingGroupId === group.id ? "outline outline-1 outline-cyan-600/60 dark:outline-cyan-300/70" : ""}`}
            draggable
            onDragStart={() => onDragStart(group.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => void onDrop(group.id)}
          >
            <Button type="button" variant="ghost" size="icon-xs" aria-label={t(`Drag group ${group.name}`, `拖拽分组 ${group.name}`)}>
              <GripVertical className="size-3.5" />
            </Button>
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
    const domains = service ? domainsToDraft(service) : { domainRoot: createRoot, subdomainsText: "" };
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
          accessLogs: service.observability?.accessLogs ?? true,
          metrics: service.observability?.metrics ?? true,
          tracing: service.observability?.tracing ?? false,
          notes: service.notes || ""
        }
      : {
          ...emptyDraft,
          matchMode,
          groupId: groups[0]?.id || "local",
          domainRoot: createRoot,
          subdomainsText: "",
          ...(draftPreset || {})
        };
  });
  const [preview, setPreview] = useState<WebServicePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const isDefaultRule = draft.matchMode === "default";
  const isCustomRule = draft.matchMode === "custom";
  const domainPreview = isDefaultRule ? [] : composeDomains(draft.domainRoot, draft.subdomainsText);
  const hostDomainInvalid = draft.matchMode === "host" && domainPreview.length !== 1;
  const hostDomainTooMany = draft.matchMode === "host" && domainPreview.length > 1;
  const formInvalid = hostDomainInvalid || (isCustomRule && !draft.customRule.trim()) || !draft.targetUrl.trim() || (draft.matchMode === "host" && mode === "subrule" && !service && !draft.subdomainsText.trim());
  const title = service
    ? isDefaultRule
      ? t("Edit default rule", "编辑默认规则")
      : isCustomRule
      ? t("Edit custom rule", "编辑自定义规则")
      : mode === "subrule"
      ? t("Edit sub-rule", "编辑子规则")
      : t("Edit rule", "编辑规则")
    : mode === "default"
      ? t("New default rule", "新建默认规则")
      : isCustomRule
      ? t("New custom rule", "新建自定义规则")
      : mode === "subrule"
      ? t("New sub-rule", "新建子规则")
      : t("New rule", "新建规则");
  const subtitle =
    isDefaultRule
      ? t("Unmatched frontend traffic -> backend IP:port.", "未匹配前端流量 -> 后端 IP:端口。")
      : isCustomRule
      ? t("Custom match -> backend IP:port.", "自定义匹配 -> 后端 IP:端口。")
      : mode === "subrule"
      ? t("Sub-rule frontend domain -> backend IP:port.", "子规则前端域名 -> 后端 IP:端口。")
      : t("Frontend domain -> backend IP:port.", "前端域名 -> 后端 IP:端口。");

  const buildInput = (): WebServiceInput => ({
    name: draft.name,
    enabled: draft.enabled,
    matchMode: draft.matchMode,
    groupId: draft.groupId,
    domains: domainPreview,
    domainRoot: isDefaultRule ? undefined : normalizeDomain(draft.domainRoot),
    customRule: draft.matchMode === "custom" ? draft.customRule : undefined,
    listenPort: Number(draft.listenPort),
    entryPoints: splitList(draft.entryPointsText),
    targetUrl: normalizeBackendTargetInput(draft.targetUrl),
    passHostHeader: draft.passHostHeader,
    middlewares: splitList(draft.middlewaresText),
    tls: {
      mode: draft.tlsMode,
      certificateId: draft.tlsMode === "file-certificate" ? draft.certificateId : undefined,
      resolver: draft.tlsMode === "resolver" ? draft.resolver : undefined
    },
    observability: {
      accessLogs: draft.accessLogs,
      metrics: draft.metrics,
      tracing: draft.tracing
    },
    notes: draft.notes
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onSubmit(buildInput());
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setPreview(null);
    setPreviewError(null);
    try {
      const input = buildInput();
      const result = service ? await previewUpdateWebService(service.id, input) : await previewCreateWebService(input);
      setPreview(result);
    } catch (requestError) {
      setPreviewError(requestError instanceof Error ? requestError.message : t("Preview failed.", "预览失败。"));
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose}>
      <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
        <div className="grid gap-3 rounded-lg border bg-background/35 p-3 md:grid-cols-2">
          {!isDefaultRule ? (
            <>
              {mode === "subrule" || service ? (
                <Field label={mode === "subrule" ? t("Subdomain label", "子域名前缀") : t("Domain label", "域名前缀")}>
                  <Input value={draft.subdomainsText} onChange={(event) => setDraft({ ...draft, subdomainsText: event.target.value })} placeholder={isCustomRule ? "optional display domain" : mode === "subrule" ? "qb" : "@"} required={draft.matchMode === "host" && mode === "subrule" && !service} />
                </Field>
              ) : null}
              <Field label={mode === "subrule" ? t("Parent domain", "所属主域") : t("Frontend domain", "前端域名")}>
                <Input value={draft.domainRoot} onChange={(event) => setDraft({ ...draft, domainRoot: event.target.value })} placeholder="1804.surfacer.cc" disabled={mode === "subrule" && activeRoot !== "__all" && !service} />
              </Field>
            </>
          ) : null}
          <Field className="md:col-span-2" label={t("Backend IP:port", "后端 IP:端口")}>
            <Input value={draft.targetUrl} onChange={(event) => setDraft({ ...draft, targetUrl: event.target.value })} placeholder="192.168.31.26:8081" required />
          </Field>
          <RoutePairPreview
            frontends={domainPreview}
            backend={draft.targetUrl}
            isDefaultRule={isDefaultRule}
          />
          {hostDomainTooMany ? (
            <div className="md:col-span-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:border-amber-300/25 dark:bg-amber-300/10 dark:text-amber-100">
              {t("One reverse proxy rule maps one frontend domain to one backend. Create separate rules or sub-rules for additional domains.", "一条反代规则只对应一个前端域名和一个后端。多个域名请分别创建规则或子规则。")}
            </div>
          ) : null}
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
          <div className="flex items-center gap-3 self-end rounded-lg border bg-background/45 px-3 py-2">
            <Switch checked={draft.enabled} onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked })} />
            <span className="text-sm">{t("Enabled", "启用")}</span>
          </div>
        </div>

        <details className="rounded-lg border bg-background/25 p-3 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer select-none items-center justify-between gap-3 text-sm font-medium">
            <span>{t("Advanced Traefik settings", "高级 Traefik 设置")}</span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Field label={t("Match mode", "匹配方式")}>
              <select className={selectClass} value={draft.matchMode} onChange={(event) => setDraft({ ...draft, matchMode: event.target.value as DraftService["matchMode"] })}>
                <option value="host">{t("Reverse proxy", "反向代理")}</option>
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
              <Input value={draft.entryPointsText} onChange={(event) => setDraft({ ...draft, entryPointsText: event.target.value })} placeholder="websecure" required />
            </Field>
            <Field className="md:col-span-2" label={t("Middlewares", "中间件")}>
              <Input value={draft.middlewaresText} onChange={(event) => setDraft({ ...draft, middlewaresText: event.target.value })} placeholder="auth@file, compress@file" />
            </Field>
            <div className="grid gap-2 rounded-lg border bg-background/35 p-3 md:col-span-2">
              <div className="text-sm font-medium">{t("Logs and metrics", "日志与指标")}</div>
              <div className="grid gap-2 sm:grid-cols-3">
                <InlineSwitch
                  label={t("Access log", "访问日志")}
                  checked={draft.accessLogs}
                  onCheckedChange={(checked) => setDraft({ ...draft, accessLogs: checked })}
                />
                <InlineSwitch
                  label={t("Prometheus metrics", "Prometheus 指标")}
                  checked={draft.metrics}
                  onCheckedChange={(checked) => setDraft({ ...draft, metrics: checked })}
                />
                <InlineSwitch
                  label={t("Tracing", "链路追踪")}
                  checked={draft.tracing}
                  onCheckedChange={(checked) => setDraft({ ...draft, tracing: checked })}
                />
              </div>
            </div>
            <Field className="md:col-span-2" label={t("Notes", "备注")}>
              <Textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={3} />
            </Field>
          </div>
        </details>

        {previewError ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {previewError}
          </div>
        ) : null}

        {preview ? (
          <ConfigPreviewPanel
            title={t("Configuration preview", "配置预览")}
            description={t("Dry-run result only. Nothing has been written to GateLite state or Traefik file-provider config.", "这里只是 dry-run 结果，不会写入 GateLite 状态或 Traefik file-provider 配置。")}
            actionLabel={preview.action === "create" ? t("create", "新增") : t("update", "更新")}
            targetLabel={preview.service.domains[0] || preview.service.name || preview.service.id}
            currentYaml={preview.currentYaml}
            nextYaml={preview.nextYaml}
            diff={preview.diff}
            clearLabel={t("Clear", "清除")}
            noChangesLabel={t("No generated YAML changes.", "生成的 YAML 没有变化。")}
            currentLabel={t("Current YAML", "当前 YAML")}
            nextLabel={t("Next YAML", "下一版 YAML")}
            addedLabel={t("added", "新增")}
            removedLabel={t("removed", "删除")}
            onClear={() => setPreview(null)}
          />
        ) : null}

        <Separator />
        <footer className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("Cancel", "取消")}
          </Button>
          <Button type="button" variant="outline" disabled={saving || previewing || formInvalid} onClick={() => void handlePreview()}>
            <FileText className="size-4" />
            {previewing ? t("Previewing...", "预览中...") : t("Preview config", "预览配置")}
          </Button>
          <Button type="submit" disabled={saving || formInvalid}>
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

function InlineSwitch({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border bg-background/45 px-3 py-2 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
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
      <span className="min-w-0 truncate font-mono text-cyan-700 dark:text-cyan-100">{frontendLabel}</span>
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate font-mono text-amber-700 dark:text-amber-100">{backendTarget.hostPort || t("No backend yet", "还没有后端")}</span>
      {backendTarget.hostPort ? (
        <Badge variant="outline" className="ml-auto h-5 rounded-md px-1.5 text-[10px] text-muted-foreground">
          {backendTarget.scheme}
        </Badge>
      ) : null}
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
      const root = normalizeDomain(service.domainRoot || "") || inferRootDomain(primaryDomain);
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

function isConcreteDomainRoot(root: string): boolean {
  return root !== "__all" && root !== "__default" && root !== "__custom";
}

function routeKindLabel(route: DomainRoute, isRootRule: boolean, t: (english: string, chinese: string) => string): string {
  if (route.isDefault) return t("Default", "默认");
  if (route.service.matchMode === "custom") return t("Custom", "自定义");
  return isRootRule ? t("Rule", "规则") : t("Sub-rule", "子规则");
}

function fallbackRuleText(service: WebServiceWithRuntime): string {
  if (service.matchMode === "default") return "PathPrefix(`/`)";
  if (service.matchMode === "custom") return service.customRule || "";
  return service.domains.map((domain) => `Host(\`${domain}\`)`).join(" || ");
}

function tlsDetailText(service: WebServiceWithRuntime, t: (english: string, chinese: string) => string): string {
  if (service.tls.mode === "none") return frontendProtocolForService(service).toUpperCase();
  if (service.tls.mode === "resolver") return `${t("Resolver", "解析器")}: ${service.tls.resolver || "letsencrypt"}`;
  return `${t("File certificate", "文件证书")}: ${service.tls.certificateId || t("Not selected", "未选择")}`;
}

function observabilityText(service: WebServiceWithRuntime, t: (english: string, chinese: string) => string): string {
  const observability = service.observability;
  const enabled: string[] = [];
  if (observability?.accessLogs ?? true) enabled.push(t("access log", "访问日志"));
  if (observability?.metrics ?? true) enabled.push(t("metrics", "指标"));
  if (observability?.tracing ?? false) enabled.push(t("tracing", "追踪"));
  return enabled.length ? enabled.join(", ") : t("All disabled", "全部停用");
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

function domainsToDraft(service: Pick<WebServiceWithRuntime, "domains" | "domainRoot">) {
  const domains = service.domains;
  if (domains.length === 0) return { domainRoot: "localhost", subdomainsText: "" };
  const savedRoot = normalizeDomain(service.domainRoot || "");
  if (savedRoot) {
    return {
      domainRoot: savedRoot,
      subdomainsText: domains.map((domain) => domainToLabel(domain, savedRoot)).join(", ")
    };
  }
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

function normalizeBackendTargetInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

function formatBackendTarget(value: string): { hostPort: string; scheme: string } {
  const normalized = normalizeBackendTargetInput(value);
  const authority = normalized.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/)[0];
  try {
    const url = new URL(normalized);
    return {
      hostPort: authority || url.host,
      scheme: url.protocol.replace(":", "") || "http"
    };
  } catch {
    return {
      hostPort: authority || normalized.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""),
      scheme: normalized.startsWith("https://") ? "https" : normalized.startsWith("http://") ? "http" : "custom"
    };
  }
}

function formatNumber(value: number, maximumFractionDigits: number): string {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits,
    minimumFractionDigits: value > 0 && value < 1 ? Math.min(2, maximumFractionDigits) : 0
  }).format(value);
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

function formatBytesPerSecond(value: number): string {
  return `${formatBytes(value)}/s`;
}
