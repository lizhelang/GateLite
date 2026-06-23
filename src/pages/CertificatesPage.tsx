import { CalendarClock, FileKey2, KeyRound, Pencil, Plus, Power, Save, ShieldAlert, ShieldCheck, Trash2, Upload } from "lucide-react";
import { FormEvent, useState } from "react";
import type { CertificateWithBindings, DashboardPayload } from "../../shared/types";
import { createCertificate, deleteCertificate, toggleCertificate, updateCertificate, type CertificateInput } from "../api";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";
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
    <section className="workspace-section">
      <header className="section-heading sticky-story">
        <div>
          <p className="eyebrow">{t("02 SSL/TLS Certificates", "02 SSL/TLS 证书")}</p>
          <h2>{t("Certificate setup without YAML first", "无需先写 YAML 的证书配置")}</h2>
          <p>{t("Track certificate source, expiry, SAN coverage, status, and which domains are bound to each certificate.", "跟踪证书来源、过期时间、SAN 覆盖、状态，以及每张证书绑定的域名。")}</p>
        </div>
        <button type="button" className="primary-button" onClick={openCreate}>
          <Plus size={16} />
          {t("New certificate", "新建证书")}
        </button>
      </header>

      {error ? <div className="notice error">{error}</div> : null}

      <div className="content-grid">
        <div className="certificate-list">
          {dashboard.certificates.map((certificate) => (
            <article key={certificate.id} className="certificate-row" onClick={() => setSelectedId(certificate.id)}>
              <div className="cert-icon">
                {certificate.status === "valid" ? <ShieldCheck size={22} /> : <ShieldAlert size={22} />}
              </div>
              <div className="certificate-main">
                <div className="service-title">
                  <h3>{certificate.name}</h3>
                  <StatusBadge status={certificate.status} />
                  <StatusBadge status={certificate.enabled ? "enabled" : "disabled"} />
                </div>
                <div className="domain-row">
                  {certificate.domains.length ? certificate.domains.map((domain) => <span key={domain}>{domain}</span>) : <span>{t("No domains recorded", "未记录域名")}</span>}
                </div>
                <div className="service-meta">
                  <span>{certificate.source}</span>
                  <span>{certificate.notAfter ? t(`Expires ${formatDate(certificate.notAfter)}`, `过期于 ${formatDate(certificate.notAfter)}`) : t("No expiry data", "无过期数据")}</span>
                  <span>{t(`${certificate.boundServices.length} bindings`, `${certificate.boundServices.length} 个绑定`)}</span>
                </div>
              </div>
              <div className="row-actions" onClick={(event) => event.stopPropagation()}>
                <button className="icon-button" type="button" onClick={() => void handleToggle(certificate)} aria-label={t("Toggle certificate", "切换证书启用状态")}>
                  <Power size={17} />
                </button>
                <button className="icon-button" type="button" onClick={() => openEdit(certificate)} aria-label={t("Edit certificate", "编辑证书")}>
                  <Pencil size={17} />
                </button>
                <button className="icon-button danger" type="button" onClick={() => void handleDelete(certificate)} disabled={certificate.boundServices.length > 0} aria-label={t("Delete certificate", "删除证书")}>
                  <Trash2 size={17} />
                </button>
              </div>
            </article>
          ))}
        </div>

        <aside className="detail-panel">
          {selected ? (
            <>
              <p className="eyebrow">{t("Selected certificate", "选中证书")}</p>
              <h3>{selected.name}</h3>
              <dl className="detail-list">
                <div>
                  <dt>
                    <FileKey2 size={15} />
                    {t("Source", "来源")}
                  </dt>
                  <dd>{selected.source}</dd>
                </div>
                <div>
                  <dt>
                    <CalendarClock size={15} />
                    {t("Validity", "有效期")}
                  </dt>
                  <dd>
                    {selected.notBefore ? formatDate(selected.notBefore) : t("Unknown", "未知")} {t("to", "至")} {selected.notAfter ? formatDate(selected.notAfter) : t("Unknown", "未知")}
                  </dd>
                </div>
                <div>
                  <dt>{t("Subject", "主体")}</dt>
                  <dd>{selected.subject || t("Unknown", "未知")}</dd>
                </div>
                <div>
                  <dt>{t("Issuer", "签发者")}</dt>
                  <dd>{selected.issuer || t("Unknown", "未知")}</dd>
                </div>
                <div>
                  <dt>{t("Bindings", "绑定")}</dt>
                  <dd>
                    {selected.boundServices.length
                      ? selected.boundServices.map((service) => `${service.name} (${service.domains.join(", ")})`).join("; ")
                      : t("Not bound to a Web service", "未绑定到 Web 服务")}
                  </dd>
                </div>
                <div>
                  <dt>{t("Status detail", "状态详情")}</dt>
                  <dd>{selected.statusMessage || selected.status}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p>{t("No certificate selected.", "未选择证书。")}</p>
          )}
        </aside>
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
      <form className="form-grid" onSubmit={(event) => void submit(event)}>
        <label>
          {t("Certificate name", "证书名称")}
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
        </label>
        <label>
          {t("Source", "来源")}
          <select value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value as DraftCertificate["source"] })}>
            <option value="self-signed">{t("Self-signed local", "本地自签")}</option>
            <option value="upload">{t("Upload PEM", "上传 PEM")}</option>
            <option value="path">{t("Existing path", "已有路径")}</option>
            <option value="acme">{t("ACME resolver reference", "ACME 解析器引用")}</option>
            <option value="sync">{t("Sync target", "同步目标")}</option>
          </select>
        </label>
        <label className="span-2">
          {t("Domains / SANs", "域名 / SAN")}
          <input value={draft.domainsText} onChange={(event) => setDraft({ ...draft, domainsText: event.target.value })} placeholder="secure.localhost, app.example.com" />
        </label>

        {draft.source === "self-signed" ? (
          <label>
            {t("Valid days", "有效天数")}
            <input type="number" min="1" max="3980" value={draft.days} onChange={(event) => setDraft({ ...draft, days: Number(event.target.value) })} />
          </label>
        ) : null}

        {draft.source === "upload" ? (
          <>
            <label className="span-2">
              {t("Certificate PEM", "证书 PEM")}
              <textarea value={draft.certPem} onChange={(event) => setDraft({ ...draft, certPem: event.target.value })} rows={6} placeholder="-----BEGIN CERTIFICATE-----" />
            </label>
            <label className="span-2">
              {t("Private key PEM", "私钥 PEM")}
              <textarea value={draft.keyPem} onChange={(event) => setDraft({ ...draft, keyPem: event.target.value })} rows={6} placeholder="-----BEGIN PRIVATE KEY-----" />
            </label>
          </>
        ) : null}

        {draft.source === "path" ? (
          <>
            <label>
              {t("Certificate path", "证书路径")}
              <input value={draft.certPath} onChange={(event) => setDraft({ ...draft, certPath: event.target.value })} placeholder="/absolute/path/fullchain.pem" />
            </label>
            <label>
              {t("Private key path", "私钥路径")}
              <input value={draft.keyPath} onChange={(event) => setDraft({ ...draft, keyPath: event.target.value })} placeholder="/absolute/path/privkey.pem" />
            </label>
          </>
        ) : null}

        {draft.source === "acme" ? (
          <>
            <label>
              {t("Resolver name", "解析器名称")}
              <input value={draft.resolver} onChange={(event) => setDraft({ ...draft, resolver: event.target.value })} />
            </label>
            <label>
              {t("Email", "邮箱")}
              <input value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder="admin@example.com" />
            </label>
            <label>
              {t("DNS provider", "DNS 提供商")}
              <input value={draft.dnsProvider} onChange={(event) => setDraft({ ...draft, dnsProvider: event.target.value })} />
            </label>
          </>
        ) : null}

        <label className="switch-line span-2">
          <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
          {t("Enabled", "启用")}
        </label>
        <footer className="form-actions span-2">
          <button type="button" className="secondary-button" onClick={onClose}>
            {t("Cancel", "取消")}
          </button>
          <button type="submit" className="primary-button" disabled={saving}>
            {draft.source === "upload" ? <Upload size={16} /> : <KeyRound size={16} />}
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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit"
  }).format(new Date(value));
}
