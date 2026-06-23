import type { CertificateStatus, RuntimeStatus } from "../../shared/types";
import { useLanguage } from "../i18n";

interface StatusBadgeProps {
  status: RuntimeStatus | CertificateStatus | "enabled" | "disabled" | "pending";
  label?: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const { t } = useLanguage();
  return <span className={`status-badge status-${status}`}>{label || statusLabel(status, t)}</span>;
}

function statusLabel(status: StatusBadgeProps["status"], t: (english: string, chinese: string) => string): string {
  const labels: Record<StatusBadgeProps["status"], string> = {
    online: t("online", "在线"),
    offline: t("offline", "离线"),
    warning: t("warning", "警告"),
    unknown: t("unknown", "未知"),
    valid: t("valid", "有效"),
    expiring: t("expiring", "即将过期"),
    expired: t("expired", "已过期"),
    pending: t("pending", "等待中"),
    invalid: t("invalid", "无效"),
    enabled: t("Enabled", "已启用"),
    disabled: t("Disabled", "已停用")
  };
  return labels[status];
}
