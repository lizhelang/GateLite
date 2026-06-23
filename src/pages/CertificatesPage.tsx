import { CalendarClock, FileKey2, KeyRound, Pencil, Plus, Power, Save, ShieldAlert, ShieldCheck, Trash2, Upload } from "lucide-react";
import { FormEvent, useState } from "react";
import type { CertificateWithBindings, DashboardPayload } from "../../shared/types";
import { createCertificate, deleteCertificate, toggleCertificate, updateCertificate, type CertificateInput } from "../api";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";

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
      setError(toggleError instanceof Error ? toggleError.message : "Toggle failed.");
    }
  };

  const handleDelete = async (certificate: CertificateWithBindings) => {
    if (!window.confirm(`Delete certificate "${certificate.name}"?`)) return;
    setError(null);
    try {
      await deleteCertificate(certificate.id);
      await onRefresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Delete failed.");
    }
  };

  return (
    <section className="workspace-section">
      <header className="section-heading sticky-story">
        <div>
          <p className="eyebrow">02 SSL/TLS Certificates</p>
          <h2>Certificate setup without YAML first</h2>
          <p>Track certificate source, expiry, SAN coverage, status, and which domains are bound to each certificate.</p>
        </div>
        <button type="button" className="primary-button" onClick={openCreate}>
          <Plus size={16} />
          New certificate
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
                  <StatusBadge status={certificate.status} label={certificate.status} />
                  <StatusBadge status={certificate.enabled ? "enabled" : "disabled"} label={certificate.enabled ? "Enabled" : "Disabled"} />
                </div>
                <div className="domain-row">
                  {certificate.domains.length ? certificate.domains.map((domain) => <span key={domain}>{domain}</span>) : <span>No domains recorded</span>}
                </div>
                <div className="service-meta">
                  <span>{certificate.source}</span>
                  <span>{certificate.notAfter ? `Expires ${formatDate(certificate.notAfter)}` : "No expiry data"}</span>
                  <span>{certificate.boundServices.length} bindings</span>
                </div>
              </div>
              <div className="row-actions" onClick={(event) => event.stopPropagation()}>
                <button className="icon-button" type="button" onClick={() => void handleToggle(certificate)} aria-label="Toggle certificate">
                  <Power size={17} />
                </button>
                <button className="icon-button" type="button" onClick={() => openEdit(certificate)} aria-label="Edit certificate">
                  <Pencil size={17} />
                </button>
                <button className="icon-button danger" type="button" onClick={() => void handleDelete(certificate)} disabled={certificate.boundServices.length > 0} aria-label="Delete certificate">
                  <Trash2 size={17} />
                </button>
              </div>
            </article>
          ))}
        </div>

        <aside className="detail-panel">
          {selected ? (
            <>
              <p className="eyebrow">Selected certificate</p>
              <h3>{selected.name}</h3>
              <dl className="detail-list">
                <div>
                  <dt>
                    <FileKey2 size={15} />
                    Source
                  </dt>
                  <dd>{selected.source}</dd>
                </div>
                <div>
                  <dt>
                    <CalendarClock size={15} />
                    Validity
                  </dt>
                  <dd>
                    {selected.notBefore ? formatDate(selected.notBefore) : "Unknown"} to {selected.notAfter ? formatDate(selected.notAfter) : "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt>Subject</dt>
                  <dd>{selected.subject || "Unknown"}</dd>
                </div>
                <div>
                  <dt>Issuer</dt>
                  <dd>{selected.issuer || "Unknown"}</dd>
                </div>
                <div>
                  <dt>Bindings</dt>
                  <dd>
                    {selected.boundServices.length
                      ? selected.boundServices.map((service) => `${service.name} (${service.domains.join(", ")})`).join("; ")
                      : "Not bound to a Web service"}
                  </dd>
                </div>
                <div>
                  <dt>Status detail</dt>
                  <dd>{selected.statusMessage || selected.status}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p>No certificate selected.</p>
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
    <Modal title={certificate ? "Edit certificate" : "New certificate"} subtitle="Generate or register certificates for Traefik TLS configuration." onClose={onClose}>
      <form className="form-grid" onSubmit={(event) => void submit(event)}>
        <label>
          Certificate name
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
        </label>
        <label>
          Source
          <select value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value as DraftCertificate["source"] })}>
            <option value="self-signed">Self-signed local</option>
            <option value="upload">Upload PEM</option>
            <option value="path">Existing path</option>
            <option value="acme">ACME resolver reference</option>
            <option value="sync">Sync target</option>
          </select>
        </label>
        <label className="span-2">
          Domains / SANs
          <input value={draft.domainsText} onChange={(event) => setDraft({ ...draft, domainsText: event.target.value })} placeholder="secure.localhost, app.example.com" />
        </label>

        {draft.source === "self-signed" ? (
          <label>
            Valid days
            <input type="number" min="1" max="3980" value={draft.days} onChange={(event) => setDraft({ ...draft, days: Number(event.target.value) })} />
          </label>
        ) : null}

        {draft.source === "upload" ? (
          <>
            <label className="span-2">
              Certificate PEM
              <textarea value={draft.certPem} onChange={(event) => setDraft({ ...draft, certPem: event.target.value })} rows={6} placeholder="-----BEGIN CERTIFICATE-----" />
            </label>
            <label className="span-2">
              Private key PEM
              <textarea value={draft.keyPem} onChange={(event) => setDraft({ ...draft, keyPem: event.target.value })} rows={6} placeholder="-----BEGIN PRIVATE KEY-----" />
            </label>
          </>
        ) : null}

        {draft.source === "path" ? (
          <>
            <label>
              Certificate path
              <input value={draft.certPath} onChange={(event) => setDraft({ ...draft, certPath: event.target.value })} placeholder="/absolute/path/fullchain.pem" />
            </label>
            <label>
              Private key path
              <input value={draft.keyPath} onChange={(event) => setDraft({ ...draft, keyPath: event.target.value })} placeholder="/absolute/path/privkey.pem" />
            </label>
          </>
        ) : null}

        {draft.source === "acme" ? (
          <>
            <label>
              Resolver name
              <input value={draft.resolver} onChange={(event) => setDraft({ ...draft, resolver: event.target.value })} />
            </label>
            <label>
              Email
              <input value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder="admin@example.com" />
            </label>
            <label>
              DNS provider
              <input value={draft.dnsProvider} onChange={(event) => setDraft({ ...draft, dnsProvider: event.target.value })} />
            </label>
          </>
        ) : null}

        <label className="switch-line span-2">
          <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
          Enabled
        </label>
        <footer className="form-actions span-2">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={saving}>
            {draft.source === "upload" ? <Upload size={16} /> : <KeyRound size={16} />}
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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit"
  }).format(new Date(value));
}
