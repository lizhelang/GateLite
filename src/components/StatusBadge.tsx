import type { CertificateStatus, RuntimeStatus } from "../../shared/types";

interface StatusBadgeProps {
  status: RuntimeStatus | CertificateStatus | "enabled" | "disabled" | "pending";
  label?: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  return <span className={`status-badge status-${status}`}>{label || status}</span>;
}

