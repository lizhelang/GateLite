import { ArrowRight, CalendarClock, ChevronDown, ChevronRight, Copy, Download, EllipsisVertical, FileKey2, FileText, GripVertical, KeyRound, Pencil, Plus, Power, RefreshCw, Trash2, Upload } from "lucide-react";
import { Fragment, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import type { CertificatePreview, CertificateWithBindings, DashboardPayload, RuntimeTlsBinding } from "../../shared/types";
import { createCertificate, deleteCertificate, previewCreateCertificate, previewUpdateCertificate, receiveCertificateSync, refreshCertificate, reorderCertificates, toggleCertificate, updateCertificate, type CertificateInput, type CertificateSyncInput } from "../api";
import { ConfigPreviewPanel } from "../components/ConfigPreviewPanel";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";
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
import { useLanguage } from "../i18n";

interface CertificatesPageProps {
  dashboard: DashboardPayload;
  onRefresh: () => Promise<void>;
}

type DraftCertificate = {
  name: string;
  enabled: boolean;
  source: CertificateInput["source"];
  domainsText: string;
  certPem: string;
  keyPem: string;
  certPath: string;
  keyPath: string;
  days: number;
  resolver: string;
  email: string;
  dnsProvider: string;
  syncTarget: string;
};

type CertificateFilter = "all" | "file" | "path" | "acme" | "sync" | "bound";

type CertificateBindingRow = {
  id: string;
  domain: string;
  backend: {
    hostPort: string;
    scheme: string;
  };
  serviceName: string;
  entryPoints: string;
  tlsMode: string;
  covered: boolean;
};

const emptyDraft: DraftCertificate = {
  name: "",
  enabled: true,
  source: "self-signed",
  domainsText: "secure.localhost",
  certPem: "",
  keyPem: "",
  certPath: "",
  keyPath: "",
  days: 365,
  resolver: "letsencrypt",
  email: "",
  dnsProvider: "cloudflare",
  syncTarget: ""
};

const selectClass = "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function CertificatesPage({ dashboard, onRefresh }: CertificatesPageProps) {
  const { t } = useLanguage();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CertificateWithBindings | null>(null);
  const [details, setDetails] = useState<CertificateWithBindings | null>(null);
  const [syncReceiving, setSyncReceiving] = useState<CertificateWithBindings | null>(null);
  const [initialSource, setInitialSource] = useState<CertificateInput["source"]>("self-signed");
  const [draftPreset, setDraftPreset] = useState<Partial<DraftCertificate> | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedBindingIds, setExpandedBindingIds] = useState<string[]>([]);
  const [filter, setFilter] = useState<CertificateFilter>("all");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncSaving, setSyncSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const certificates = useMemo(() => [...dashboard.certificates].sort((a, b) => a.order - b.order), [dashboard.certificates]);
  const filteredCertificates = useMemo(() => certificates.filter((certificate) => matchesFilter(certificate, filter)), [certificates, filter]);
  const selectedCertificates = useMemo(() => certificates.filter((certificate) => selectedIds.includes(certificate.id)), [certificates, selectedIds]);
  const counts = useMemo(
    () => ({
      all: certificates.length,
      file: certificates.filter((certificate) => sourceGroup(certificate.source) === "file").length,
      path: certificates.filter((certificate) => certificate.source === "path").length,
      acme: certificates.filter((certificate) => certificate.source === "acme").length,
      sync: certificates.filter((certificate) => certificate.source === "sync").length,
      bound: certificates.filter((certificate) => certificate.boundServices.length > 0).length
    }),
    [certificates]
  );

  const openCreate = (source: CertificateInput["source"] = "self-signed") => {
    setEditing(null);
    setDraftPreset(null);
    setInitialSource(source);
    setShowForm(true);
  };

  const openEdit = (certificate: CertificateWithBindings) => {
    setEditing(certificate);
    setDraftPreset(null);
    setInitialSource(certificate.source);
    setShowForm(true);
  };

  const openDuplicate = (certificate: CertificateWithBindings) => {
    const source = copyCertificateSource(certificate);
    setEditing(null);
    setInitialSource(source);
    setDraftPreset({
      name: `${certificate.name} ${t("copy", "副本")}`,
      enabled: false,
      source,
      domainsText: certificate.domains.join(", "),
      certPem: "",
      keyPem: "",
      certPath: source === "path" ? certificate.certPath || "" : "",
      keyPath: source === "path" ? certificate.keyPath || "" : "",
      days: certificateValidityDays(certificate),
      resolver: certificate.acme?.resolver || "letsencrypt",
      email: certificate.acme?.email || "",
      dnsProvider: certificate.acme?.dnsProvider || "cloudflare",
      syncTarget: certificate.sync?.target || ""
    });
    setShowForm(true);
  };

  const handleToggle = async (certificate: CertificateWithBindings) => {
    setError(null);
    try {
      await toggleCertificate(certificate.id, !certificate.enabled);
      await onRefresh();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : t("Toggle failed.", "切换失败。"));
    }
  };

  const handleDelete = async (certificate: CertificateWithBindings) => {
    if (!window.confirm(t(`Delete certificate "${certificate.name}"?`, `删除证书「${certificate.name}」？`))) return;
    setError(null);
    try {
      await deleteCertificate(certificate.id);
      await onRefresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("Delete failed.", "删除失败。"));
    }
  };

  const handleDrop = async (targetId: string) => {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      return;
    }
    const ids = certificates.map((certificate) => certificate.id);
    const from = ids.indexOf(draggingId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) {
      setDraggingId(null);
      return;
    }
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    setDraggingId(null);
    setError(null);
    try {
      await reorderCertificates(ids);
      await onRefresh();
    } catch (reorderError) {
      setError(reorderError instanceof Error ? reorderError.message : t("Reorder failed.", "排序失败。"));
    }
  };

  const handleDownload = (certificate: CertificateWithBindings) => {
    window.location.href = `/api/certificates/${certificate.id}/download`;
  };

  const handleRefresh = async (certificate: CertificateWithBindings) => {
    setError(null);
    try {
      await refreshCertificate(certificate.id);
      await onRefresh();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : t("Refresh failed.", "刷新失败。"));
    }
  };

  const handleSelectCertificate = (id: string, checked: boolean) => {
    setSelectedIds((ids) => {
      if (checked) return ids.includes(id) ? ids : [...ids, id];
      return ids.filter((selectedId) => selectedId !== id);
    });
  };

  const handleSelectVisibleCertificates = (checked: boolean) => {
    setSelectedIds(checked ? filteredCertificates.map((certificate) => certificate.id) : []);
  };

  const handleToggleBindings = (id: string) => {
    setExpandedBindingIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));
  };

  const handleBulkToggle = async (enabled: boolean) => {
    if (!selectedCertificates.length) return;
    setError(null);
    try {
      for (const certificate of selectedCertificates) {
        if (certificate.enabled !== enabled) {
          await toggleCertificate(certificate.id, enabled);
        }
      }
      setSelectedIds([]);
      await onRefresh();
    } catch (bulkError) {
      setError(bulkError instanceof Error ? bulkError.message : t("Bulk update failed.", "批量更新失败。"));
    }
  };

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/60 p-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{t("SSL/TLS certificate list", "SSL/TLS 证书列表")}</div>
          <div className="mt-1 text-lg font-semibold">{t("Certificates", "证书管理")}</div>
        </div>
        <div className="flex min-w-0 flex-1 justify-start md:justify-center">
          <div className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border bg-muted/45 p-1">
            {([
              ["all", t("All", "全部"), counts.all],
              ["file", t("File", "文件"), counts.file],
              ["path", t("Path", "路径"), counts.path],
              ["acme", "ACME", counts.acme],
              ["sync", t("Sync", "同步"), counts.sync],
              ["bound", t("Bound", "已绑定"), counts.bound]
            ] as Array<[CertificateFilter, string, number]>).map(([key, label, count]) => (
              <Button key={key} type="button" variant={filter === key ? "outline" : "ghost"} size="sm" onClick={() => setFilter(key)}>
                {label}
                <Badge variant="secondary" className="ml-1 rounded-full px-1.5 py-0 text-[10px]">
                  {count}
                </Badge>
              </Button>
            ))}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button">
              <Plus className="size-4" />
              {t("Add certificate", "添加证书")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{t("Certificate source", "证书来源")}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => openCreate("self-signed")}>
              <KeyRound className="size-4" />
              {t("Local self-signed", "本地自签")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openCreate("upload")}>
              <Upload className="size-4" />
              {t("Upload PEM", "上传 PEM")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openCreate("path")}>
              <FileKey2 className="size-4" />
              {t("Existing path", "已有路径")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openCreate("acme")}>
              <RefreshCw className="size-4" />
              {t("ACME resolver", "ACME 解析器")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openCreate("sync")}>
              <Download className="size-4" />
              {t("Sync target", "同步目标")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {error ? <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

      <RuntimeTlsBindingTable bindings={dashboard.runtimeTlsBindings} />

      <CertificateDataTable
        certificates={filteredCertificates}
        selectedIds={selectedIds}
        expandedBindingIds={expandedBindingIds}
        draggingId={draggingId}
        onDragStart={setDraggingId}
        onDrop={handleDrop}
        onSelect={handleSelectCertificate}
        onSelectAll={handleSelectVisibleCertificates}
        onToggleBindings={handleToggleBindings}
        onToggle={handleToggle}
        onBulkToggle={handleBulkToggle}
        onDuplicate={openDuplicate}
        onDownload={handleDownload}
        onRefreshStatus={handleRefresh}
        onReceiveSync={setSyncReceiving}
        onDetails={setDetails}
        onEdit={openEdit}
        onDelete={handleDelete}
      />

      {showForm ? (
        <CertificateForm
          certificate={editing}
          initialSource={initialSource}
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
                await updateCertificate(editing.id, input);
              } else {
                await createCertificate(input as CertificateInput);
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

      {details ? (
        <Modal title={details.name} subtitle={t("Certificate metadata, SAN coverage, and bound reverse proxy rules.", "证书元数据、SAN 覆盖和已绑定反代规则。")} onClose={() => setDetails(null)}>
          <CertificateDetails certificate={details} />
        </Modal>
      ) : null}

      {syncReceiving ? (
        <SyncReceiveForm
          certificate={syncReceiving}
          saving={syncSaving}
          onClose={() => setSyncReceiving(null)}
          onSubmit={async (input) => {
            setSyncSaving(true);
            setError(null);
            try {
              await receiveCertificateSync(syncReceiving.id, input);
              setSyncReceiving(null);
              await onRefresh();
            } catch (syncError) {
              setError(syncError instanceof Error ? syncError.message : t("Sync receive failed.", "接收同步证书失败。"));
            } finally {
              setSyncSaving(false);
            }
          }}
        />
      ) : null}
    </section>
  );
}

function RuntimeTlsBindingTable({ bindings }: { bindings: RuntimeTlsBinding[] }) {
  const { t } = useLanguage();
  return (
    <div className="overflow-hidden rounded-xl border bg-card/80">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{t("Discovered from Traefik TLS routers", "从 Traefik TLS 路由发现")}</div>
          <h2 className="truncate text-base font-semibold">{t("Runtime TLS coverage", "运行时 TLS 覆盖")}</h2>
        </div>
        <Badge variant="secondary" className="rounded-md">
          {t(`${bindings.length} TLS routers`, `${bindings.length} 个 TLS 路由`)}
        </Badge>
      </div>
      <div className="overflow-x-auto">
        <Table className="min-w-[900px]">
          <TableHeader className="bg-muted/65">
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-[240px]">{t("Domain", "域名")}</TableHead>
              <TableHead className="min-w-[220px]">{t("Traefik router", "Traefik 路由")}</TableHead>
              <TableHead className="w-36">{t("TLS source", "TLS 来源")}</TableHead>
              <TableHead className="w-36">{t("GateLite mapping", "GateLite 映射")}</TableHead>
              <TableHead className="w-28">{t("Status", "状态")}</TableHead>
              <TableHead className="min-w-[220px]">{t("Import note", "导入说明")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bindings.map((binding) => (
              <TableRow key={binding.id} className="h-11">
                <TableCell>
                  <DomainList domains={binding.domains} />
                </TableCell>
                <TableCell>
                  <div className="grid min-w-0 gap-0.5 text-xs leading-tight">
                    <span className="truncate font-mono text-foreground">{binding.routerName}</span>
                    <span className="truncate text-muted-foreground">{binding.provider || "unknown provider"}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {binding.tlsResolver ? <Badge variant="outline" className="rounded-md">ACME {binding.tlsResolver}</Badge> : null}
                    {binding.tlsOptions ? <Badge variant="outline" className="rounded-md">{binding.tlsOptions}</Badge> : null}
                    {!binding.tlsResolver && !binding.tlsOptions ? <Badge variant="outline" className="rounded-md">{t("Router TLS", "路由 TLS")}</Badge> : null}
                  </div>
                </TableCell>
                <TableCell>
                  {binding.managedCertificateId || binding.managedServiceId ? (
                    <Badge variant="secondary" className="rounded-md">
                      {binding.managedCertificateId ? t("Certificate mapped", "证书已映射") : t("Route mapped", "路由已映射")}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="rounded-md">
                      {t("Runtime only", "仅运行时")}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge status={binding.status} className="h-5 rounded-md px-1.5 text-[10px]" />
                </TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground">
                    {binding.importable
                      ? t("Can be represented as an ACME resolver certificate.", "可映射为 ACME 解析器证书。")
                      : binding.importWarnings.join(" ") || t("Traefik did not expose certificate material.", "Traefik 没有暴露证书材料。")}
                  </span>
                </TableCell>
              </TableRow>
            ))}
            {bindings.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                  {t("No TLS routers were exposed by Traefik runtime.", "Traefik 运行时没有暴露 TLS 路由。")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CertificateDataTable({
  certificates,
  selectedIds,
  expandedBindingIds,
  draggingId,
  onDragStart,
  onDrop,
  onSelect,
  onSelectAll,
  onToggleBindings,
  onToggle,
  onBulkToggle,
  onDuplicate,
  onDownload,
  onRefreshStatus,
  onReceiveSync,
  onDetails,
  onEdit,
  onDelete
}: {
  certificates: CertificateWithBindings[];
  selectedIds: string[];
  expandedBindingIds: string[];
  draggingId: string | null;
  onDragStart: (id: string) => void;
  onDrop: (id: string) => Promise<void>;
  onSelect: (id: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
  onToggleBindings: (id: string) => void;
  onToggle: (certificate: CertificateWithBindings) => Promise<void>;
  onBulkToggle: (enabled: boolean) => Promise<void>;
  onDuplicate: (certificate: CertificateWithBindings) => void;
  onDownload: (certificate: CertificateWithBindings) => void;
  onRefreshStatus: (certificate: CertificateWithBindings) => Promise<void>;
  onReceiveSync: (certificate: CertificateWithBindings) => void;
  onDetails: (certificate: CertificateWithBindings) => void;
  onEdit: (certificate: CertificateWithBindings) => void;
  onDelete: (certificate: CertificateWithBindings) => Promise<void>;
}) {
  const { t } = useLanguage();
  const selectedCount = certificates.filter((certificate) => selectedIds.includes(certificate.id)).length;
  const allVisibleSelected = certificates.length > 0 && selectedCount === certificates.length;
  const hasBoundEnabledSelection = certificates.some((certificate) => selectedIds.includes(certificate.id) && certificate.enabled && certificate.boundServices.length > 0);

  return (
    <div className="overflow-hidden rounded-xl border bg-card/80">
      <div className="overflow-x-auto">
        <Table className="min-w-[1000px]">
          <TableHeader className="bg-muted/65">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-8" />
              <TableHead className="w-9">
                <Checkbox aria-label={t("Select visible certificates", "选择当前证书")} checked={allVisibleSelected} onCheckedChange={(checked) => onSelectAll(Boolean(checked))} />
              </TableHead>
              <TableHead className="w-44">{t("Certificate", "证书")}</TableHead>
              <TableHead className="w-32">{t("Source", "来源")}</TableHead>
              <TableHead className="w-48">{t("Domains / SANs", "域名 / SAN")}</TableHead>
              <TableHead className="w-40">{t("CA / DNS", "CA / DNS")}</TableHead>
              <TableHead className="w-32">{t("Expires", "过期时间")}</TableHead>
              <TableHead className="w-28">{t("Bindings", "绑定")}</TableHead>
              <TableHead className="w-28">{t("Status", "状态")}</TableHead>
              <TableHead className="w-12 text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {certificates.map((certificate) => {
              const rowSelected = selectedIds.includes(certificate.id);
              const disableProtected = certificate.enabled && certificate.boundServices.length > 0;
              const bindingRows = buildCertificateBindingRows(certificate);
              const bindingsExpanded = expandedBindingIds.includes(certificate.id);
              return (
                <Fragment key={certificate.id}>
                  <TableRow
                    aria-expanded={bindingsExpanded}
                    data-state={rowSelected ? "selected" : undefined}
                    className={`${draggingId === certificate.id ? "outline outline-1 outline-cyan-300/70" : ""} h-12`}
                    draggable
                    onDragStart={() => onDragStart(certificate.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => void onDrop(certificate.id)}
                    onClick={() => onSelect(certificate.id, !rowSelected)}
                  >
                    <TableCell className="px-2">
                      <Button variant="ghost" size="icon-xs" aria-label={t("Drag to reorder", "拖拽排序")}>
                        <GripVertical className="size-3.5" />
                      </Button>
                    </TableCell>
                    <TableCell className="px-2">
                      <Checkbox checked={rowSelected} aria-label={t(`Select ${certificate.name}`, `选择 ${certificate.name}`)} onClick={(event) => event.stopPropagation()} onCheckedChange={(checked) => onSelect(certificate.id, Boolean(checked))} />
                    </TableCell>
                    <TableCell>
                      <div className="grid min-w-0 gap-1">
                        <span className="truncate font-medium">{certificate.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{certificate.subject || t("No subject metadata", "无主体元数据")}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="grid min-w-0 gap-1">
                        <Badge variant="outline" className="w-fit rounded-md">{sourceLabel(certificate.source, t)}</Badge>
                        <span className="truncate font-mono text-xs text-muted-foreground">{storagePrimary(certificate, t)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <DomainList domains={certificate.domains} />
                    </TableCell>
                    <TableCell>
                      <div className="grid min-w-0 gap-0.5 text-xs leading-tight">
                        <span className="truncate text-sm text-foreground">{certificate.issuer || t("Unknown", "未知")}</span>
                        {certificate.acme?.dnsProvider ? <span className="truncate text-muted-foreground">{certificate.acme.dnsProvider}</span> : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="grid gap-0.5 text-xs leading-tight">
                        <span className="font-medium">{certificate.notAfter ? formatDate(certificate.notAfter) : t("Unknown", "未知")}</span>
                        <span className="text-muted-foreground">{expiryText(certificate.notAfter, t)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="flex max-w-32 items-center gap-1 rounded-md px-1 py-0.5 text-left text-xs leading-tight text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
                        disabled={!bindingRows.length}
                        aria-expanded={bindingsExpanded}
                        aria-label={t(`Show bindings for ${certificate.name}`, `展开 ${certificate.name} 的绑定明细`)}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleBindings(certificate.id);
                        }}
                      >
                        {bindingsExpanded ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
                        <span className="min-w-0">
                          <span className="block font-mono text-foreground">{certificate.boundServices.length}</span>
                          <span className="block truncate">{bindingSummary(certificate, t)}</span>
                        </span>
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <StatusBadge status={certificate.status} />
                        <StatusBadge status={certificate.enabled ? "enabled" : "disabled"} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-xs" aria-label={t("Certificate actions", "证书操作")}>
                              <EllipsisVertical className="size-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuLabel>{t("Certificate actions", "证书操作")}</DropdownMenuLabel>
                            <DropdownMenuItem onSelect={() => onDetails(certificate)}>
                              <FileKey2 className="size-4" />
                              {t("Details", "详情")}
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={disableProtected} onSelect={() => void onToggle(certificate)}>
                              <Power className="size-4" />
                              {certificate.enabled ? t("Disable", "停用") : t("Enable", "启用")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onDuplicate(certificate)}>
                              <Copy className="size-4" />
                              {t("Copy", "复制")}
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={!certificate.certPath} onSelect={() => onDownload(certificate)}>
                              <Download className="size-4" />
                              {t("Download PEM", "下载 PEM")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void onRefreshStatus(certificate)}>
                              <RefreshCw className="size-4" />
                              {t("Refresh status", "刷新状态")}
                            </DropdownMenuItem>
                            {certificate.source === "sync" ? (
                              <DropdownMenuItem onSelect={() => onReceiveSync(certificate)}>
                                <Upload className="size-4" />
                                {t("Receive synced PEM", "接收同步 PEM")}
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem onSelect={() => onEdit(certificate)}>
                              <Pencil className="size-4" />
                              {t("Edit", "编辑")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" disabled={certificate.boundServices.length > 0} onSelect={() => void onDelete(certificate)}>
                              <Trash2 className="size-4" />
                              {t("Delete", "删除")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                  {bindingsExpanded ? (
                    <TableRow className="bg-muted/20 hover:bg-muted/20">
                      <TableCell colSpan={10} className="p-0">
                        <InlineCertificateBindings rows={bindingRows} />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
            {certificates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="h-24 text-center text-sm text-muted-foreground">
                  {t("No certificates in this view.", "这个视图里没有证书。")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
        <span>{t(`${selectedCount} of ${certificates.length} row(s) selected.`, `已选择 ${selectedCount} / ${certificates.length} 行。`)}</span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={selectedCount === 0} onClick={() => void onBulkToggle(true)}>
            <Power className="size-3.5" />
            {t("Enable", "启用")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={selectedCount === 0 || hasBoundEnabledSelection}
            title={hasBoundEnabledSelection ? t("Unbind selected certificates before disabling them.", "停用前请先解除所选证书绑定。") : undefined}
            onClick={() => void onBulkToggle(false)}
          >
            <Power className="size-3.5" />
            {t("Disable", "停用")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CertificateDetails({ certificate }: { certificate: CertificateWithBindings }) {
  const { t } = useLanguage();
  const bindingRows = buildCertificateBindingRows(certificate);
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-xl border bg-background/35 p-4 text-sm md:grid-cols-4">
        <DetailCell icon={<FileKey2 className="size-4" />} label={t("Issuer", "签发者")} value={certificate.issuer || t("Unknown", "未知")} />
        <DetailCell icon={<CalendarClock className="size-4" />} label={t("Validity", "有效期")} value={`${certificate.notBefore ? formatDate(certificate.notBefore) : t("Unknown", "未知")} ${t("to", "至")} ${certificate.notAfter ? formatDate(certificate.notAfter) : t("Unknown", "未知")}`} />
        <DetailCell label={t("Bound rules", "绑定规则")} value={bindingSummary(certificate, t)} />
        <DetailCell label={t("Status detail", "状态详情")} value={certificate.statusMessage || certificate.status} />
        <DetailCell label={t("Source detail", "来源详情")} value={sourceDetail(certificate, t)} />
      </div>
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">{t("Domain bindings", "域名绑定明细")}</h3>
            <p className="text-xs text-muted-foreground">{t("Each bound Web service domain is checked against this certificate's SAN list.", "逐行检查已绑定 Web 服务域名是否被当前证书 SAN 覆盖。")}</p>
          </div>
          <Badge variant="outline" className="rounded-md">
            {t(`${bindingRows.length} domain rows`, `${bindingRows.length} 个域名行`)}
          </Badge>
        </div>
        {bindingRows.length ? (
          <CertificateBindingRowsTable rows={bindingRows} />
        ) : (
          <div className="rounded-lg border bg-background/35 p-4 text-sm text-muted-foreground">
            {t("No Web service is currently bound to this certificate.", "当前没有 Web 服务绑定到这张证书。")}
          </div>
        )}
      </div>
    </div>
  );
}

function InlineCertificateBindings({ rows }: { rows: CertificateBindingRow[] }) {
  const { t } = useLanguage();
  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium text-foreground">{t("Bound reverse proxy rules", "已绑定反代规则")}</div>
        <Badge variant="outline" className="rounded-md">
          {t(`${rows.length} domain rows`, `${rows.length} 个域名行`)}
        </Badge>
      </div>
      <CertificateBindingRowsTable rows={rows} />
    </div>
  );
}

function CertificateBindingRowsTable({ rows }: { rows: CertificateBindingRow[] }) {
  const { t } = useLanguage();
  return (
    <div className="overflow-x-auto rounded-lg border bg-background/45">
      <Table className="min-w-[760px]">
        <TableHeader className="bg-muted/45">
          <TableRow className="hover:bg-transparent">
            <TableHead>{t("Frontend domain", "前端域名")}</TableHead>
            <TableHead>{t("Backend IP:port", "后端 IP:端口")}</TableHead>
            <TableHead>{t("Rule", "规则")}</TableHead>
            <TableHead>{t("Coverage", "覆盖")}</TableHead>
            <TableHead>TLS</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <span className="rounded-md border bg-background/55 px-2 py-1 font-mono text-xs text-cyan-100">{row.domain}</span>
              </TableCell>
              <TableCell>
                <div className="grid max-w-64 grid-cols-[1rem_minmax(0,1fr)] items-center gap-1 text-xs leading-tight">
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                  <span className="truncate font-mono text-foreground">{row.backend.hostPort}</span>
                  <span />
                  <span className="truncate text-muted-foreground">{row.backend.scheme}</span>
                </div>
              </TableCell>
              <TableCell>
                <div className="grid gap-0.5 text-xs">
                  <span className="font-medium">{row.serviceName}</span>
                  <span className="text-muted-foreground">{row.entryPoints}</span>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={row.covered ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" : "border-amber-400/40 bg-amber-400/10 text-amber-200"}>
                  {row.covered ? t("covered", "已覆盖") : t("not covered", "未覆盖")}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{row.tlsMode}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function DomainList({ domains }: { domains: string[] }) {
  const { t } = useLanguage();
  if (!domains.length) {
    return <span className="text-xs text-muted-foreground">{t("No domains", "未记录域名")}</span>;
  }
  return (
    <div className="flex max-w-72 flex-wrap gap-1">
      {domains.slice(0, 2).map((domain) => (
        <span key={domain} className="rounded-md border bg-background/55 px-2 py-1 text-xs text-cyan-100">
          {domain}
        </span>
      ))}
      {domains.length > 2 ? <span className="rounded-md border bg-background/40 px-2 py-1 text-xs text-muted-foreground">+{domains.length - 2}</span> : null}
    </div>
  );
}

function DetailCell({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="break-words font-medium">{value}</dd>
    </div>
  );
}

function CertificateForm({
  certificate,
  initialSource,
  draftPreset,
  saving,
  onClose,
  onSubmit
}: {
  certificate: CertificateWithBindings | null;
  initialSource: CertificateInput["source"];
  draftPreset: Partial<DraftCertificate> | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: Partial<CertificateInput>) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<DraftCertificate>(() =>
    certificate
      ? {
          name: certificate.name,
          enabled: certificate.enabled,
          source: certificate.source,
          domainsText: certificate.domains.join(", "),
          certPem: "",
          keyPem: "",
          certPath: certificate.certPath || "",
          keyPath: certificate.keyPath || "",
          days: certificateValidityDays(certificate),
          resolver: certificate.acme?.resolver || "letsencrypt",
          email: certificate.acme?.email || "",
          dnsProvider: certificate.acme?.dnsProvider || "cloudflare",
          syncTarget: certificate.sync?.target || ""
        }
      : { ...emptyDraft, source: initialSource, ...(draftPreset || {}) }
  );
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<CertificatePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const uploadPemStarted = draft.source === "upload" && (draft.certPem.trim().length > 0 || draft.keyPem.trim().length > 0);
  const uploadPemRequired = draft.source === "upload" && (!certificate || certificate.source !== "upload" || uploadPemStarted);
  const boundServiceCount = certificate?.boundServices.length || 0;
  const bindingLocked = boundServiceCount > 0;
  const submitDisabled =
    saving ||
    (uploadPemRequired && (!draft.certPem.trim() || !draft.keyPem.trim())) ||
    (draft.source === "path" && (!draft.certPath.trim() || !draft.keyPath.trim())) ||
    (draft.source === "sync" && !draft.syncTarget.trim());

  const buildInput = (): Partial<CertificateInput> => {
    if (bindingLocked && certificate) {
      return {
        name: draft.name,
        ...(draft.source === "acme"
          ? {
              acme: {
                resolver: certificate.acme?.resolver || draft.resolver,
                email: draft.email,
                dnsProvider: draft.dnsProvider
              }
            }
          : {})
      };
    }

    const input: CertificateInput = {
      name: draft.name,
      enabled: draft.enabled,
      source: draft.source,
      domains: splitList(draft.domainsText),
      certPem: draft.certPem || undefined,
      keyPem: draft.keyPem || undefined,
      certPath: draft.certPath || undefined,
      keyPath: draft.keyPath || undefined,
      acme:
        draft.source === "acme"
          ? {
              resolver: draft.resolver,
              email: draft.email,
              dnsProvider: draft.dnsProvider
            }
          : undefined,
      sync: draft.source === "sync" ? { target: draft.syncTarget } : undefined
    };

    if (draft.source === "self-signed" && (!certificate || certificate.source !== "self-signed" || draft.days !== certificateValidityDays(certificate))) {
      input.days = draft.days;
    }

    return input;
  };

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
      const result = certificate ? await previewUpdateCertificate(certificate.id, input) : await previewCreateCertificate(input as CertificateInput);
      setPreview(result);
    } catch (requestError) {
      setPreviewError(requestError instanceof Error ? requestError.message : t("Preview failed.", "预览失败。"));
    } finally {
      setPreviewing(false);
    }
  };

  const handlePemFile = async (event: ChangeEvent<HTMLInputElement>, field: "certPem" | "keyPem") => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setFileError(null);
    try {
      const text = await file.text();
      setDraft((current) => ({ ...current, [field]: text }));
    } catch {
      setFileError(t("Unable to read selected PEM file.", "无法读取选择的 PEM 文件。"));
    } finally {
      input.value = "";
    }
  };

  return (
    <Modal title={certificate ? t("Edit certificate", "编辑证书") : draft.source === "upload" ? t("Upload certificate", "上传证书") : t("New certificate", "新建证书")} subtitle={t("Register file, path, ACME, or sync certificates for Traefik TLS without writing YAML.", "无需手写 YAML，即可为 Traefik TLS 登记文件、路径、ACME 或同步证书。")} onClose={onClose}>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void submit(event)}>
        {bindingLocked ? (
          <div className="md:col-span-2 rounded-lg border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-100">
            <div className="font-medium">{t("Bound certificate fields are protected", "已绑定证书的关键字段已保护")}</div>
            <div className="mt-1 text-xs text-amber-100/75">
              {t(`This certificate is used by ${boundServiceCount} Web service rule(s). Unbind those rules before changing source, domains, files, resolver, or enabled state.`, `这张证书正在被 ${boundServiceCount} 条 Web 服务规则使用。修改来源、域名、文件、解析器或启用状态前，请先解除这些规则绑定。`)}
            </div>
          </div>
        ) : null}
        <Field label={t("Certificate name", "证书名称")}>
          <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
        </Field>
        <Field label={t("Source", "来源")}>
          <select className={selectClass} value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value as DraftCertificate["source"] })} disabled={bindingLocked}>
            <option value="self-signed">{t("File: self-signed", "文件：本地自签")}</option>
            <option value="upload">{t("File: upload PEM", "文件：上传 PEM")}</option>
            <option value="path">{t("Existing path", "已有路径")}</option>
            <option value="acme">{t("ACME resolver reference", "ACME 解析器引用")}</option>
            <option value="sync">{t("Sync target", "同步目标")}</option>
          </select>
        </Field>
        <Field className="md:col-span-2" label={t("Domains / SANs", "域名 / SAN")}>
          <Input value={draft.domainsText} onChange={(event) => setDraft({ ...draft, domainsText: event.target.value })} placeholder="secure.localhost, app.example.com" disabled={bindingLocked} />
        </Field>

        {draft.source === "self-signed" ? (
          <Field label={t("Valid days", "有效天数")}>
            <Input type="number" min="1" max="3980" value={draft.days} onChange={(event) => setDraft({ ...draft, days: Number(event.target.value) })} disabled={bindingLocked} />
          </Field>
        ) : null}

        {draft.source === "upload" ? (
          <>
            <div className="grid gap-3 md:col-span-2 md:grid-cols-2">
              <Field label={t("Certificate file", "证书文件")}>
                <Input
                  type="file"
                  accept=".pem,.crt,.cer,.cert,text/plain,application/x-pem-file"
                  onChange={(event) => void handlePemFile(event, "certPem")}
                  disabled={bindingLocked}
                  className="cursor-pointer text-xs file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs file:font-medium"
                />
              </Field>
              <Field label={t("Private key file", "私钥文件")}>
                <Input
                  type="file"
                  accept=".pem,.key,text/plain,application/x-pem-file"
                  onChange={(event) => void handlePemFile(event, "keyPem")}
                  disabled={bindingLocked}
                  className="cursor-pointer text-xs file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs file:font-medium"
                />
              </Field>
            </div>
            {fileError ? <p className="md:col-span-2 text-xs text-destructive">{fileError}</p> : null}
            <Field className="md:col-span-2" label={certificate?.source === "upload" ? t("Certificate PEM replacement", "替换证书 PEM") : t("Certificate PEM", "证书 PEM")}>
              <Textarea value={draft.certPem} onChange={(event) => setDraft({ ...draft, certPem: event.target.value })} rows={4} placeholder="-----BEGIN CERTIFICATE-----" disabled={bindingLocked} />
            </Field>
            <Field className="md:col-span-2" label={certificate?.source === "upload" ? t("Private key PEM replacement", "替换私钥 PEM") : t("Private key PEM", "私钥 PEM")}>
              <Textarea value={draft.keyPem} onChange={(event) => setDraft({ ...draft, keyPem: event.target.value })} rows={4} placeholder="-----BEGIN PRIVATE KEY-----" disabled={bindingLocked} />
            </Field>
          </>
        ) : null}

        {draft.source === "path" ? (
          <>
            <Field label={t("Certificate path", "证书路径")}>
              <Input value={draft.certPath} onChange={(event) => setDraft({ ...draft, certPath: event.target.value })} placeholder="runtime/certs/fullchain.pem" disabled={bindingLocked} />
            </Field>
            <Field label={t("Private key path", "私钥路径")}>
              <Input value={draft.keyPath} onChange={(event) => setDraft({ ...draft, keyPath: event.target.value })} placeholder="runtime/certs/privkey.pem" disabled={bindingLocked} />
            </Field>
          </>
        ) : null}

        {draft.source === "acme" ? (
          <>
            <Field label={t("Resolver name", "解析器名称")}>
              <Input value={draft.resolver} onChange={(event) => setDraft({ ...draft, resolver: event.target.value })} disabled={bindingLocked} />
            </Field>
            <Field label={t("Email", "邮箱")}>
              <Input value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder="admin@example.com" />
            </Field>
            <Field label={t("DNS provider", "DNS 提供商")}>
              <Input value={draft.dnsProvider} onChange={(event) => setDraft({ ...draft, dnsProvider: event.target.value })} />
            </Field>
          </>
        ) : null}

        {draft.source === "sync" ? (
          <Field className="md:col-span-2" label={t("Sync target", "同步目标")}>
            <Input value={draft.syncTarget} onChange={(event) => setDraft({ ...draft, syncTarget: event.target.value })} placeholder="https://peer.example.com/api/ssl/sync" disabled={bindingLocked} />
          </Field>
        ) : null}

        <div className="flex items-center gap-3 md:col-span-2">
          <Switch checked={draft.enabled} onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked })} disabled={bindingLocked} />
          <span className="text-sm">{t("Enabled", "启用")}</span>
        </div>
        <Separator className="md:col-span-2" />
        {previewError ? (
          <div className="md:col-span-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {previewError}
          </div>
        ) : null}
        {preview ? (
          <div className="md:col-span-2">
            <ConfigPreviewPanel
              title={t("Configuration preview", "配置预览")}
              description={t("Dry-run result only. Certificate preview never writes GateLite state or Traefik file-provider config.", "这里只是 dry-run 结果，证书预览不会写入 GateLite 状态或 Traefik file-provider 配置。")}
              actionLabel={preview.action === "create" ? t("create", "新增") : t("update", "更新")}
              targetLabel={preview.certificate.name}
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
          </div>
        ) : null}
        <footer className="flex justify-end gap-2 md:col-span-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("Cancel", "取消")}
          </Button>
          <Button type="button" variant="outline" disabled={submitDisabled || previewing} onClick={() => void handlePreview()}>
            <FileText className="size-4" />
            {previewing ? t("Previewing...", "预览中...") : t("Preview config", "预览配置")}
          </Button>
          <Button type="submit" disabled={submitDisabled}>
            {draft.source === "upload" ? <Upload className="size-4" /> : <KeyRound className="size-4" />}
            {saving ? t("Saving...", "保存中...") : t("Save", "保存")}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

function SyncReceiveForm({
  certificate,
  saving,
  onClose,
  onSubmit
}: {
  certificate: CertificateWithBindings;
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: CertificateSyncInput) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [certPem, setCertPem] = useState("");
  const [keyPem, setKeyPem] = useState("");
  const [domainsText, setDomainsText] = useState(certificate.domains.join(", "));
  const [fileError, setFileError] = useState<string | null>(null);
  const boundCount = certificate.boundServices.length;

  const handlePemFile = async (event: ChangeEvent<HTMLInputElement>, field: "certPem" | "keyPem") => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setFileError(null);
    try {
      const text = await file.text();
      if (field === "certPem") {
        setCertPem(text);
      } else {
        setKeyPem(text);
      }
    } catch {
      setFileError(t("Unable to read selected PEM file.", "无法读取选择的 PEM 文件。"));
    } finally {
      input.value = "";
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onSubmit({
      certPem,
      keyPem,
      domains: splitList(domainsText)
    });
  };

  return (
    <Modal title={t("Receive synced certificate", "接收同步证书")} subtitle={t("Import a synced PEM bundle into the local Docker-mounted certificate store.", "把同步过来的 PEM 证书包导入本地 Docker 可读证书目录。")} onClose={onClose}>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void submit(event)}>
        {boundCount > 0 ? (
          <div className="md:col-span-2 rounded-lg border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-100">
            <div className="font-medium">{t("Bound domains must stay covered", "已绑定域名必须保持覆盖")}</div>
            <div className="mt-1 text-xs text-amber-100/75">
              {t(`This sync certificate is used by ${boundCount} Web service rule(s). The received PEM must still cover those frontend domains.`, `这张同步证书正在被 ${boundCount} 条 Web 服务规则使用。接收的新 PEM 必须继续覆盖这些前端域名。`)}
            </div>
          </div>
        ) : null}
        <Field className="md:col-span-2" label={t("Domains / SAN hint", "域名 / SAN 提示")}>
          <Input value={domainsText} onChange={(event) => setDomainsText(event.target.value)} placeholder="secure.localhost, app.example.com" />
        </Field>
        <div className="grid gap-3 md:col-span-2 md:grid-cols-2">
          <Field label={t("Certificate file", "证书文件")}>
            <Input
              type="file"
              accept=".pem,.crt,.cer,.cert,text/plain,application/x-pem-file"
              onChange={(event) => void handlePemFile(event, "certPem")}
              className="cursor-pointer text-xs file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs file:font-medium"
            />
          </Field>
          <Field label={t("Private key file", "私钥文件")}>
            <Input
              type="file"
              accept=".pem,.key,text/plain,application/x-pem-file"
              onChange={(event) => void handlePemFile(event, "keyPem")}
              className="cursor-pointer text-xs file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs file:font-medium"
            />
          </Field>
        </div>
        {fileError ? <p className="md:col-span-2 text-xs text-destructive">{fileError}</p> : null}
        <Field className="md:col-span-2" label={t("Certificate PEM", "证书 PEM")}>
          <Textarea value={certPem} onChange={(event) => setCertPem(event.target.value)} rows={5} placeholder="-----BEGIN CERTIFICATE-----" required />
        </Field>
        <Field className="md:col-span-2" label={t("Private key PEM", "私钥 PEM")}>
          <Textarea value={keyPem} onChange={(event) => setKeyPem(event.target.value)} rows={5} placeholder="-----BEGIN PRIVATE KEY-----" required />
        </Field>
        <Separator className="md:col-span-2" />
        <footer className="flex justify-end gap-2 md:col-span-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("Cancel", "取消")}
          </Button>
          <Button type="submit" disabled={saving || !certPem.trim() || !keyPem.trim()}>
            <Upload className="size-4" />
            {saving ? t("Receiving...", "接收中...") : t("Receive PEM", "接收 PEM")}
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

function matchesFilter(certificate: CertificateWithBindings, filter: CertificateFilter): boolean {
  if (filter === "all") return true;
  if (filter === "file") return sourceGroup(certificate.source) === "file";
  if (filter === "bound") return certificate.boundServices.length > 0;
  return certificate.source === filter;
}

function sourceGroup(source: CertificateInput["source"]): CertificateFilter {
  if (source === "self-signed" || source === "upload") return "file";
  return source;
}

function sourceLabel(source: CertificateInput["source"], t: (english: string, chinese: string) => string): string {
  const labels: Record<CertificateInput["source"], string> = {
    "self-signed": t("File: self-signed", "文件：自签"),
    upload: t("File: uploaded", "文件：上传"),
    path: t("Path", "路径"),
    acme: "ACME",
    sync: t("Sync", "同步")
  };
  return labels[source];
}

function copyCertificateSource(certificate: CertificateWithBindings): CertificateInput["source"] {
  if (certificate.source === "upload") return "path";
  return certificate.source;
}

function certificateValidityDays(certificate: CertificateWithBindings): number {
  if (!certificate.notBefore || !certificate.notAfter) return 365;
  const days = Math.round((new Date(certificate.notAfter).getTime() - new Date(certificate.notBefore).getTime()) / (24 * 60 * 60 * 1000));
  return Number.isFinite(days) && days > 0 ? Math.min(days, 3980) : 365;
}

function bindingSummary(certificate: CertificateWithBindings, t: (english: string, chinese: string) => string): string {
  if (!certificate.boundServices.length) return t("Not bound", "未绑定");
  return certificate.boundServices.map((service) => service.domains[0] || service.name).join(", ");
}

function buildCertificateBindingRows(certificate: CertificateWithBindings): CertificateBindingRow[] {
  return certificate.boundServices.flatMap((service) => {
    const domains = service.matchMode === "default" ? ["*"] : service.domains.length ? service.domains : [service.name || service.id];
    return domains.map((domain, index) => ({
      id: `${service.id}:${index}:${domain}`,
      domain,
      backend: formatBackendTarget(service.targetUrl),
      serviceName: service.name.trim() || domain,
      entryPoints: service.entryPoints.join(", "),
      tlsMode: service.tls.mode === "file-certificate" ? "file" : service.tls.mode,
      covered: domain === "*" ? false : isDomainCovered(domain, certificate.domains)
    }));
  });
}

function isDomainCovered(domain: string, certificateDomains: string[]): boolean {
  const normalizedDomain = domain.toLowerCase();
  return certificateDomains.some((candidate) => {
    const normalizedCandidate = candidate.toLowerCase();
    if (normalizedCandidate === normalizedDomain) return true;
    if (!normalizedCandidate.startsWith("*.")) return false;
    const suffix = normalizedCandidate.slice(1);
    const remainder = normalizedDomain.slice(0, -suffix.length);
    return normalizedDomain.endsWith(suffix) && remainder.length > 0 && !remainder.includes(".");
  });
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

function storagePrimary(certificate: CertificateWithBindings, t: (english: string, chinese: string) => string): string {
  if (certificate.source === "acme") return certificate.acme?.resolver || "letsencrypt";
  if (certificate.source === "sync") return certificate.sync?.target || t("Sync target", "同步目标");
  if (certificate.certPath) return tailPath(certificate.certPath);
  return t("Not readable", "不可读");
}

function sourceDetail(certificate: CertificateWithBindings, t: (english: string, chinese: string) => string): string {
  if (certificate.source === "sync") {
    const lastSync = certificate.sync?.lastSyncTime ? formatDateTime(certificate.sync.lastSyncTime) : t("Never refreshed", "尚未刷新");
    return `${certificate.sync?.target || t("Sync target", "同步目标")} · ${lastSync}`;
  }
  if (certificate.source === "acme") return `${certificate.acme?.resolver || "letsencrypt"} · ${certificate.acme?.dnsProvider || t("DNS provider not set", "未设置 DNS 提供商")}`;
  return storagePrimary(certificate, t);
}

function tailPath(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).slice(-2).join("/");
}

function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit"
  }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function expiryText(value: string | undefined, t: (english: string, chinese: string) => string): string {
  if (!value) return t("No expiry metadata", "无过期元数据");
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (Number.isNaN(days)) return t("Invalid expiry", "过期时间无效");
  if (days < 0) return t(`${Math.abs(days)} days ago`, `${Math.abs(days)} 天前`);
  if (days === 0) return t("today", "今天");
  return t(`${days} days left`, `剩余 ${days} 天`);
}
