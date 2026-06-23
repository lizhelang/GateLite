import { CalendarClock, FileKey2, KeyRound, Pencil, Plus, Power, Save, ShieldAlert, ShieldCheck, Trash2, Upload } from "lucide-react";
import { FormEvent, useState } from "react";
import type { CertificateWithBindings, DashboardPayload } from "../../shared/types";
import { createCertificate, deleteCertificate, toggleCertificate, updateCertificate, type CertificateInput } from "../api";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
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
  dnsProvider: "cloudflare"
};

const selectClass = "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function CertificatesPage({ dashboard, onRefresh }: CertificatesPageProps) {
  const { t } = useLanguage();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CertificateWithBindings | null>(null);
  const [selectedId, setSelectedId] = useState(dashboard.certificates[0]?.id || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = dashboard.certificates.find((certificate) => certificate.id === selectedId) || dashboard.certificates[0];

  const openCreate = () => {
    setEditing(null);
    setShowForm(true);
  };

  const openEdit = (certificate: CertificateWithBindings) => {
    setEditing(certificate);
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

  return (
    <section className="grid gap-4">
      <Card className="bg-card/80">
        <CardHeader>
          <div className="grid gap-3 md:flex md:items-center md:justify-between">
            <div className="grid min-w-0 gap-1">
              <CardDescription>{t("02 SSL/TLS Certificates", "02 SSL/TLS 证书")}</CardDescription>
              <CardTitle className="text-2xl">{t("Certificate setup without YAML first", "无需先写 YAML 的证书配置")}</CardTitle>
              <CardDescription>{t("Track certificate source, expiry, SAN coverage, status, and which domains are bound to each certificate.", "跟踪证书来源、过期时间、SAN 覆盖、状态，以及每张证书绑定的域名。")}</CardDescription>
            </div>
            <Button type="button" onClick={openCreate} className="w-fit">
              <Plus className="size-4" />
              {t("New certificate", "新建证书")}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {error ? <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-3">
          {dashboard.certificates.map((certificate) => (
            <Card key={certificate.id} className="bg-card/75">
              <CardContent className="grid gap-3 pt-4 md:grid-cols-[auto_minmax(0,1fr)_auto]" onClick={() => setSelectedId(certificate.id)}>
                <div className="flex size-10 items-center justify-center rounded-lg border bg-background/50 text-cyan-100">
                  {certificate.status === "valid" ? <ShieldCheck className="size-5" /> : <ShieldAlert className="size-5" />}
                </div>
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{certificate.name}</h3>
                    <StatusBadge status={certificate.status} />
                    <StatusBadge status={certificate.enabled ? "enabled" : "disabled"} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {certificate.domains.length ? (
                      certificate.domains.map((domain) => (
                        <span key={domain} className="rounded-lg border bg-background/40 px-2 py-1 text-xs">
                          {domain}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">{t("No domains recorded", "未记录域名")}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{certificate.source}</span>
                    <span>{certificate.notAfter ? t(`Expires ${formatDate(certificate.notAfter)}`, `过期于 ${formatDate(certificate.notAfter)}`) : t("No expiry data", "无过期数据")}</span>
                    <span>{t(`${certificate.boundServices.length} bindings`, `${certificate.boundServices.length} 个绑定`)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                  <Button variant="outline" size="icon-sm" onClick={() => void handleToggle(certificate)} aria-label={t("Toggle certificate", "切换证书启用状态")}>
                    <Power className="size-4" />
                  </Button>
                  <Button variant="outline" size="icon-sm" onClick={() => openEdit(certificate)} aria-label={t("Edit certificate", "编辑证书")}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="destructive" size="icon-sm" onClick={() => void handleDelete(certificate)} disabled={certificate.boundServices.length > 0} aria-label={t("Delete certificate", "删除证书")}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="h-fit bg-card/80">
          <CardHeader>
            <CardDescription>{t("Selected certificate", "选中证书")}</CardDescription>
            <CardTitle>{selected?.name || t("No certificate selected.", "未选择证书。")}</CardTitle>
          </CardHeader>
          <CardContent>
            {selected ? (
              <dl className="grid gap-4 text-sm">
                <DetailItem icon={<FileKey2 className="size-4" />} label={t("Source", "来源")} value={selected.source} />
                <DetailItem icon={<CalendarClock className="size-4" />} label={t("Validity", "有效期")} value={`${selected.notBefore ? formatDate(selected.notBefore) : t("Unknown", "未知")} ${t("to", "至")} ${selected.notAfter ? formatDate(selected.notAfter) : t("Unknown", "未知")}`} />
                <DetailItem label={t("Subject", "主体")} value={selected.subject || t("Unknown", "未知")} />
                <DetailItem label={t("Issuer", "签发者")} value={selected.issuer || t("Unknown", "未知")} />
                <DetailItem label={t("Bindings", "绑定")} value={selected.boundServices.length ? selected.boundServices.map((service) => `${service.name} (${service.domains.join(", ")})`).join("; ") : t("Not bound to a Web service", "未绑定到 Web 服务")} />
                <DetailItem label={t("Status detail", "状态详情")} value={selected.statusMessage || selected.status} />
              </dl>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {showForm ? (
        <CertificateForm
          certificate={editing}
          saving={saving}
          onClose={() => setShowForm(false)}
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

function CertificateForm({
  certificate,
  saving,
  onClose,
  onSubmit
}: {
  certificate: CertificateWithBindings | null;
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
          dnsProvider: certificate.acme?.dnsProvider || "cloudflare"
        }
      : emptyDraft
  );

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
          : undefined
    });
  };

  return (
    <Modal title={certificate ? t("Edit certificate", "编辑证书") : t("New certificate", "新建证书")} subtitle={t("Generate or register certificates for Traefik TLS configuration.", "为 Traefik TLS 配置生成或登记证书。")} onClose={onClose}>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void submit(event)}>
        <Field label={t("Certificate name", "证书名称")}>
          <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
        </Field>
        <Field label={t("Source", "来源")}>
          <select className={selectClass} value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value as DraftCertificate["source"] })}>
            <option value="self-signed">{t("Self-signed local", "本地自签")}</option>
            <option value="upload">{t("Upload PEM", "上传 PEM")}</option>
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
            <Field className="md:col-span-2" label={t("Certificate PEM", "证书 PEM")}>
              <Textarea value={draft.certPem} onChange={(event) => setDraft({ ...draft, certPem: event.target.value })} rows={6} placeholder="-----BEGIN CERTIFICATE-----" />
            </Field>
            <Field className="md:col-span-2" label={t("Private key PEM", "私钥 PEM")}>
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
            {draft.source === "upload" ? <Upload className="size-4" /> : <KeyRound className="size-4" />}
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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit"
  }).format(new Date(value));
}
