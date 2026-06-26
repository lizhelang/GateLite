import type { ConfigDiffLine } from "../../shared/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ConfigPreviewPanelProps {
  title: string;
  description: string;
  actionLabel: string;
  targetLabel: string;
  currentYaml: string;
  nextYaml: string;
  diff: ConfigDiffLine[];
  clearLabel: string;
  noChangesLabel: string;
  currentLabel: string;
  nextLabel: string;
  addedLabel: string;
  removedLabel: string;
  onClear: () => void;
}

export function ConfigPreviewPanel({
  title,
  description,
  actionLabel,
  targetLabel,
  currentYaml,
  nextYaml,
  diff,
  clearLabel,
  noChangesLabel,
  currentLabel,
  nextLabel,
  addedLabel,
  removedLabel,
  onClear
}: ConfigPreviewPanelProps) {
  const added = diff.filter((line) => line.type === "added").length;
  const removed = diff.filter((line) => line.type === "removed").length;

  return (
    <section className="grid gap-3 rounded-lg border bg-background/35 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">{title}</h3>
            <Badge variant="outline" className="rounded-md">
              {actionLabel}
            </Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{targetLabel}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="rounded-md border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-400/10 dark:text-emerald-200">
            +{added} {addedLabel}
          </Badge>
          <Badge variant="outline" className="rounded-md border-rose-500/35 bg-rose-500/10 text-rose-700 dark:border-rose-400/35 dark:bg-rose-400/10 dark:text-rose-200">
            -{removed} {removedLabel}
          </Badge>
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            {clearLabel}
          </Button>
        </div>
      </div>

      <pre className="yaml-scroll max-h-64 overflow-auto rounded-lg border bg-background/75 p-3 text-xs leading-relaxed">
        {diff.length ? diff.map(formatDiffLine).map((line, index) => <PreviewLine key={`${line.text}:${index}`} className={line.className} text={line.text} />) : <span className="text-muted-foreground">{noChangesLabel}</span>}
      </pre>

      <div className="grid gap-2 md:grid-cols-2">
        <details className="rounded-lg border bg-background/40 p-3 [&_summary::-webkit-details-marker]:hidden">
          <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground">{currentLabel}</summary>
          <pre className="yaml-scroll mt-3 max-h-56 overflow-auto text-xs leading-relaxed text-muted-foreground">{currentYaml || noChangesLabel}</pre>
        </details>
        <details className="rounded-lg border bg-background/40 p-3 [&_summary::-webkit-details-marker]:hidden">
          <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground">{nextLabel}</summary>
          <pre className="yaml-scroll mt-3 max-h-56 overflow-auto text-xs leading-relaxed text-muted-foreground">{nextYaml || noChangesLabel}</pre>
        </details>
      </div>
    </section>
  );
}

function PreviewLine({ className, text }: { className: string; text: string }) {
  return <span className={`${className} block whitespace-pre-wrap break-words`}>{text}</span>;
}

function formatDiffLine(line: ConfigDiffLine): { className: string; text: string } {
  if (line.type === "added") {
    return { className: "text-emerald-700 dark:text-emerald-200", text: `+ ${line.line}` };
  }
  if (line.type === "removed") {
    return { className: "text-rose-700 dark:text-rose-200", text: `- ${line.line}` };
  }
  return { className: "text-muted-foreground", text: `  ${line.line}` };
}
