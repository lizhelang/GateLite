import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useLanguage } from "../i18n";

interface ModalProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
}

export function Modal({ title, subtitle, children, onClose }: ModalProps) {
  const { t } = useLanguage();
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-panel" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("Close", "关闭")}>
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
