import type { CertificateStatus, RuntimeStatus } from "../../shared/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useLanguage } from "../i18n";

interface StatusBadgeProps {
  status: RuntimeStatus | CertificateStatus | "enabled" | "disabled" | "pending";
  label?: string;
  className?: string;
}

const statusClass: Record<StatusBadgeProps["status"], string> = {
  online: "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-200",
  offline: "border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:border-zinc-400/30 dark:bg-zinc-400/10 dark:text-zinc-300",
  warning: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200",
  unknown: "border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:border-zinc-400/30 dark:bg-zinc-400/10 dark:text-zinc-300",
  valid: "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-200",
  expiring: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200",
  expired: "border-red-500/35 bg-red-500/10 text-red-700 dark:border-red-400/40 dark:bg-red-400/10 dark:text-red-200",
  pending: "border-sky-500/35 bg-sky-500/10 text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-200",
  invalid: "border-red-500/35 bg-red-500/10 text-red-700 dark:border-red-400/40 dark:bg-red-400/10 dark:text-red-200",
  enabled: "border-cyan-500/35 bg-cyan-500/10 text-cyan-700 dark:border-cyan-300/40 dark:bg-cyan-300/10 dark:text-cyan-100",
  disabled: "border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:border-zinc-400/30 dark:bg-zinc-400/10 dark:text-zinc-300"
};

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const { t } = useLanguage();
  return (
    <Badge variant="outline" className={cn("capitalize", statusClass[status], className)}>
      {label || statusLabel(status, t)}
    </Badge>
  );
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
