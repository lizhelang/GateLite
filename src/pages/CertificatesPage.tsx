import { ArrowRight, CalendarClock, Copy, Download, FileKey2, GripVertical, KeyRound, Pencil, Plus, Power, Save, Trash2, Upload } from "lucide-react";
import { FormEvent, useMemo, useState, type ReactNode } from "react";
import type { CertificateWithBindings, DashboardPayload } from "../../shared/types";
import { createCertificate, deleteCertificate, reorderCertificates, toggleCertificate, updateCertificate, type CertificateInput } from "../api";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  const [initialSource, setInitialSource] = useState<CertificateInput["source"]>("self-signed");
  const [draftPreset, setDraftPreset] = useState<Partial<DraftCertificate> | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filter, setFilter] = useState<CertificateFilter>("all");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const certificates = useMemo(() => [...dashboard.certificates].sort((a, b) => a.order - b.order), [dashboard.certificates]);
  const filteredCertificates = useMemo(() => certificates.filter((certificate) => matchesFilter(certificate, filter)), [certificates, filter]);
  const selected = certificates.find((certificate) => selectedIds.includes(certificate.id));
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

  const handleSelectCertificate = (id: string, checked: boolean) => {
    setSelectedIds((ids) => {
      if (checked) return ids.includes(id) ? ids : [...ids, id];
      return ids.filter((selectedId) => selectedId !== id);
    });
  };

  const handleSelectVisibleCertificates = (checked: boolean) => {
    setSelectedIds(checked ? filteredCertificates.map((certificate) => certificate.id) : []);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border bg-muted/45 p-1">
          {([
            ["all", t("All certificates", "全部证书"), counts.all],
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
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => openCreate("upload")}>
            <Upload className="size-4" />
            {t("Upload PEM", "上传 PEM")}
          </Button>
          <Button type="button" onClick={() => openCreate("self-signed")}>
            <Plus className="size-4" />
            {t("New certificate", "新建证书")}
          </Button>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

      <CertificateDataTable
        certificates={filteredCertificates}
        selected={selected}
        selectedIds={selectedIds}
        draggingId={draggingId}
        onDragStart={setDraggingId}
        onDrop={handleDrop}
        onSelect={handleSelectCertificate}
        onSelectAll={handleSelectVisibleCertificates}
        onToggle={handleToggle}
        onBulkToggle={handleBulkToggle}
        onDuplicate={openDuplicate}
        onDownload={handleDownload}
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
                await createCertificate(input);
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

function CertificateDataTable({
  certificates,
  selected,
  selectedIds,
  draggingId,
  onDragStart,
  onDrop,
  onSelect,
  onSelectAll,
  onToggle,
  onBulkToggle,
  onDuplicate,
  onDownload,
  onEdit,
  onDelete
}: {
  certificates: CertificateWithBindings[];
  selected?: CertificateWithBindings;
  selectedIds: string[];
  draggingId: string | null;
  onDragStart: (id: string) => void;
  onDrop: (id: string) => Promise<void>;
  onSelect: (id: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
  onToggle: (certificate: CertificateWithBindings) => Promise<void>;
  onBulkToggle: (enabled: boolean) => Promise<void>;
  onDuplicate: (certificate: CertificateWithBindings) => void;
  onDownload: (certificate: CertificateWithBindings) => void;
  onEdit: (certificate: CertificateWithBindings) => void;
  onDelete: (certificate: CertificateWithBindings) => Promise<void>;
}) {
  const { t } = useLanguage();
  const selectedCount = certificates.filter((certificate) => selectedIds.includes(certificate.id)).length;
  const allVisibleSelected = certificates.length > 0 && selectedCount === certificates.length;

  return (
    <Card className="overflow-hidden bg-card/70">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table className="min-w-[980px]">
            <TableHeader className="bg-muted/45">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10" />
                <TableHead className="w-10">
                  <Checkbox aria-label={t("Select visible certificates", "选择当前证书")} checked={allVisibleSelected} onCheckedChange={(checked) => onSelectAll(Boolean(checked))} />
                </TableHead>
                <TableHead>{t("Certificate", "证书")}</TableHead>
                <TableHead>{t("Source", "来源")}</TableHead>
                <TableHead>{t("Domains / SANs", "域名 / SAN")}</TableHead>
                <TableHead>{t("Status", "状态")}</TableHead>
                <TableHead>{t("Expires", "过期时间")}</TableHead>
                <TableHead>{t("Bindings", "绑定")}</TableHead>
                <TableHead>{t("Storage", "存储")}</TableHead>
                <TableHead className="w-36 text-right">{t("Actions", "操作")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {certificates.map((certificate) => {
                const rowSelected = selectedIds.includes(certificate.id);
                return (
                  <TableRow
                    key={certificate.id}
                    className={`${rowSelected ? "bg-muted/50" : ""} ${draggingId === certificate.id ? "outline outline-1 outline-cyan-300/70" : ""}`}
                    draggable
                    onDragStart={() => onDragStart(certificate.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => void onDrop(certificate.id)}
                    onClick={() => onSelect(certificate.id, !rowSelected)}
                  >
                    <TableCell>
                      <Button variant="ghost" size="icon-xs" aria-label={t("Drag to reorder", "拖拽排序")}>
                        <GripVertical className="size-3.5" />
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Checkbox checked={rowSelected} aria-label={t(`Select ${certificate.name}`, `选择 ${certificate.name}`)} onClick={(event) => event.stopPropagation()} onCheckedChange={(checked) => onSelect(certificate.id, Boolean(checked))} />
                    </TableCell>
                    <TableCell>
                      <div className="grid min-w-0 gap-0.5">
                        <span className="truncate font-medium">{certificate.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{certificate.subject || certificate.issuer || t("No subject metadata", "无主体元数据")}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{sourceLabel(certificate.source, t)}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-72 flex-wrap gap-1">
                        {certificate.domains.length ? (
                          <>
                            {certificate.domains.slice(0, 2).map((domain) => (
                              <span key={domain} className="rounded-md border bg-background/55 px-2 py-1 text-xs text-cyan-100">
                                {domain}
                              </span>
                            ))}
                            {certificate.domains.length > 2 ? <span className="rounded-md border bg-background/40 px-2 py-1 text-xs text-muted-foreground">+{certificate.domains.length - 2}</span> : null}
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">{t("No domains", "未记录域名")}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <StatusBadge status={certificate.status} />
                        <StatusBadge status={certificate.enabled ? "enabled" : "disabled"} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="grid gap-0.5 text-xs leading-tight">
                        <span className="font-medium">{certificate.notAfter ? formatDate(certificate.notAfter) : t("Unknown", "未知")}</span>
                        <span className="text-muted-foreground">{expiryText(certificate.notAfter, t)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="grid gap-0.5 text-xs leading-tight">
                        <span className="font-mono text-foreground">{certificate.boundServices.length}</span>
                        <span className="truncate text-muted-foreground">{bindingSummary(certificate, t)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="grid max-w-52 gap-0.5 text-xs leading-tight">
                        <span className="truncate font-mono text-foreground">{storagePrimary(certificate, t)}</span>
                        <span className="truncate text-muted-foreground">{storageSecondary(certificate, t)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
                        <Button variant="outline" size="icon-xs" onClick={() => void onToggle(certificate)} aria-label={t("Toggle certificate", "切换证书启用状态")}>
                          <Power className="size-3.5" />
                        </Button>
                        <Button variant="outline" size="icon-xs" onClick={() => onDuplicate(certificate)} aria-label={t("Copy as new certificate", "复制为新证书")}>
                          <Copy className="size-3.5" />
                        </Button>
                        <Button variant="outline" size="icon-xs" onClick={() => onDownload(certificate)} disabled={!certificate.certPath} aria-label={t("Download PEM", "下载 PEM")}>
                          <Download className="size-3.5" />
                        </Button>
                        <Button variant="outline" size="icon-xs" onClick={() => onEdit(certificate)} aria-label={t("Edit certificate", "编辑证书")}>
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button variant="destructive" size="icon-xs" onClick={() => void onDelete(certificate)} disabled={certificate.boundServices.length > 0} aria-label={t("Delete certificate", "删除证书")}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
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
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="sm" disabled={selectedCount === 0} onClick={() => void onBulkToggle(true)}>
              <Power className="size-3.5" />
              {t("Enable selected", "启用所选")}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={selectedCount === 0} onClick={() => void onBulkToggle(false)}>
              <Power className="size-3.5" />
              {t("Disable selected", "停用所选")}
            </Button>
            <span>{t("Rows per page", "每页行数")} 10</span>
            <span>{t("Page 1 of 1", "第 1 / 1 页")}</span>
          </div>
        </div>
        {selected ? <CertificateDetails certificate={selected} /> : null}
      </CardContent>
    </Card>
  );
}

function CertificateDetails({ certificate }: { certificate: CertificateWithBindings }) {
  const { t } = useLanguage();
  const bindingRows = buildCertificateBindingRows(certificate);
  return (
    <div className="border-t bg-background/30">
      <div className="grid gap-3 p-4 text-sm md:grid-cols-4">
        <DetailCell icon={<FileKey2 className="size-4" />} label={t("Issuer", "签发者")} value={certificate.issuer || t("Unknown", "未知")} />
        <DetailCell icon={<CalendarClock className="size-4" />} label={t("Validity", "有效期")} value={`${certificate.notBefore ? formatDate(certificate.notBefore) : t("Unknown", "未知")} ${t("to", "至")} ${certificate.notAfter ? formatDate(certificate.notAfter) : t("Unknown", "未知")}`} />
        <DetailCell label={t("Bound rules", "绑定规则")} value={bindingSummary(certificate, t)} />
        <DetailCell label={t("Status detail", "状态详情")} value={certificate.statusMessage || certificate.status} />
      </div>
      <div className="border-t p-4">
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
          <div className="overflow-x-auto rounded-lg border">
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
                {bindingRows.map((row) => (
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
        ) : (
          <div className="rounded-lg border bg-background/35 p-4 text-sm text-muted-foreground">
            {t("No Web service is currently bound to this certificate.", "当前没有 Web 服务绑定到这张证书。")}
          </div>
        )}
      </div>
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
  onSubmit: (input: CertificateInput) => Promise<void>;
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
          days: 365,
          resolver: certificate.acme?.resolver || "letsencrypt",
          email: certificate.acme?.email || "",
          dnsProvider: certificate.acme?.dnsProvider || "cloudflare",
          syncTarget: certificate.sync?.target || ""
        }
      : { ...emptyDraft, source: initialSource, ...(draftPreset || {}) }
  );
  const uploadPemStarted = draft.source === "upload" && (draft.certPem.trim().length > 0 || draft.keyPem.trim().length > 0);
  const uploadPemRequired = draft.source === "upload" && (!certificate || certificate.source !== "upload" || uploadPemStarted);
  const submitDisabled =
    saving ||
    (uploadPemRequired && (!draft.certPem.trim() || !draft.keyPem.trim())) ||
    (draft.source === "path" && (!draft.certPath.trim() || !draft.keyPath.trim())) ||
    (draft.source === "sync" && !draft.syncTarget.trim());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onSubmit({
      name: draft.name,
      enabled: draft.enabled,
      source: draft.source,
      domains: splitList(draft.domainsText),
      certPem: draft.certPem || undefined,
      keyPem: draft.keyPem || undefined,
      certPath: draft.certPath || undefined,
      keyPath: draft.keyPath || undefined,
      days: draft.days,
      acme:
        draft.source === "acme"
          ? {
              resolver: draft.resolver,
              email: draft.email,
              dnsProvider: draft.dnsProvider
            }
          : undefined,
      sync: draft.source === "sync" ? { target: draft.syncTarget } : undefined
    });
  };

  return (
    <Modal title={certificate ? t("Edit certificate", "编辑证书") : draft.source === "upload" ? t("Upload certificate", "上传证书") : t("New certificate", "新建证书")} subtitle={t("Register file, path, ACME, or sync certificates for Traefik TLS without writing YAML.", "无需手写 YAML，即可为 Traefik TLS 登记文件、路径、ACME 或同步证书。")} onClose={onClose}>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void submit(event)}>
        <Field label={t("Certificate name", "证书名称")}>
          <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
        </Field>
        <Field label={t("Source", "来源")}>
          <select className={selectClass} value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value as DraftCertificate["source"] })}>
            <option value="self-signed">{t("File: self-signed", "文件：本地自签")}</option>
            <option value="upload">{t("File: upload PEM", "文件：上传 PEM")}</option>
            <option value="path">{t("Existing path", "已有路径")}</option>
            <option value="acme">{t("ACME resolver reference", "ACME 解析器引用")}</option>
            <option value="sync">{t("Sync target", "同步目标")}</option>
          </select>
        </Field>
        <Field className="md:col-span-2" label={t("Domains / SANs", "域名 / SAN")}>
          <Input value={draft.domainsText} onChange={(event) => setDraft({ ...draft, domainsText: event.target.value })} placeholder="secure.localhost, app.example.com" />
        </Field>

        {draft.source === "self-signed" ? (
          <Field label={t("Valid days", "有效天数")}>
            <Input type="number" min="1" max="3980" value={draft.days} onChange={(event) => setDraft({ ...draft, days: Number(event.target.value) })} />
          </Field>
        ) : null}

        {draft.source === "upload" ? (
          <>
            <Field className="md:col-span-2" label={certificate?.source === "upload" ? t("Certificate PEM replacement", "替换证书 PEM") : t("Certificate PEM", "证书 PEM")}>
              <Textarea value={draft.certPem} onChange={(event) => setDraft({ ...draft, certPem: event.target.value })} rows={6} placeholder="-----BEGIN CERTIFICATE-----" />
            </Field>
            <Field className="md:col-span-2" label={certificate?.source === "upload" ? t("Private key PEM replacement", "替换私钥 PEM") : t("Private key PEM", "私钥 PEM")}>
              <Textarea value={draft.keyPem} onChange={(event) => setDraft({ ...draft, keyPem: event.target.value })} rows={6} placeholder="-----BEGIN PRIVATE KEY-----" />
            </Field>
          </>
        ) : null}

        {draft.source === "path" ? (
          <>
            <Field label={t("Certificate path", "证书路径")}>
              <Input value={draft.certPath} onChange={(event) => setDraft({ ...draft, certPath: event.target.value })} placeholder="/absolute/path/fullchain.pem" />
            </Field>
            <Field label={t("Private key path", "私钥路径")}>
              <Input value={draft.keyPath} onChange={(event) => setDraft({ ...draft, keyPath: event.target.value })} placeholder="/absolute/path/privkey.pem" />
            </Field>
          </>
        ) : null}

        {draft.source === "acme" ? (
          <>
            <Field label={t("Resolver name", "解析器名称")}>
              <Input value={draft.resolver} onChange={(event) => setDraft({ ...draft, resolver: event.target.value })} />
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
            <Input value={draft.syncTarget} onChange={(event) => setDraft({ ...draft, syncTarget: event.target.value })} placeholder="https://peer.example.com/api/ssl/sync" />
          </Field>
        ) : null}

        <div className="flex items-center gap-3 md:col-span-2">
          <Switch checked={draft.enabled} onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked })} />
          <span className="text-sm">{t("Enabled", "启用")}</span>
        </div>
        <Separator className="md:col-span-2" />
        <footer className="flex justify-end gap-2 md:col-span-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("Cancel", "取消")}
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

function buildCertificateBindingRows(certificate: CertificateWithBindings) {
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

function storageSecondary(certificate: CertificateWithBindings, t: (english: string, chinese: string) => string): string {
  if (certificate.source === "acme") return certificate.acme?.dnsProvider || t("Traefik runtime", "Traefik 运行时");
  if (certificate.source === "sync") return certificate.sync?.lastSyncTime ? `${t("Last sync", "最近同步")} ${certificate.sync.lastSyncTime}` : t("Waiting for sync", "等待同步");
  if (certificate.keyPath) return tailPath(certificate.keyPath);
  return certificate.statusMessage || "";
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

function expiryText(value: string | undefined, t: (english: string, chinese: string) => string): string {
  if (!value) return t("No expiry metadata", "无过期元数据");
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (Number.isNaN(days)) return t("Invalid expiry", "过期时间无效");
  if (days < 0) return t(`${Math.abs(days)} days ago`, `${Math.abs(days)} 天前`);
  if (days === 0) return t("today", "今天");
  return t(`${days} days left`, `剩余 ${days} 天`);
}
