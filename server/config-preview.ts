import type { ConfigDiffLine } from "../shared/types";

export function diffText(current: string, next: string): ConfigDiffLine[] {
  const left = current.split(/\r?\n/);
  const right = next.split(/\r?\n/);
  const table = buildLcsTable(left, right);
  const lines: ConfigDiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      lines.push({ type: "context", line: left[i] });
      i += 1;
      j += 1;
    } else if (j < right.length && (i === left.length || table[i][j + 1] >= table[i + 1][j])) {
      lines.push({ type: "added", line: right[j] });
      j += 1;
    } else if (i < left.length) {
      lines.push({ type: "removed", line: left[i] });
      i += 1;
    }
  }

  return trimContext(lines);
}

function buildLcsTable(left: string[], right: string[]): number[][] {
  const table = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

function trimContext(lines: ConfigDiffLine[]): ConfigDiffLine[] {
  const changed = new Set(lines.map((line, index) => (line.type === "context" ? -1 : index)).filter((index) => index >= 0));
  if (changed.size === 0) return [];
  const keep = new Set<number>();
  for (const index of changed) {
    for (let cursor = Math.max(0, index - 3); cursor <= Math.min(lines.length - 1, index + 3); cursor += 1) {
      keep.add(cursor);
    }
  }
  return lines.filter((_, index) => keep.has(index));
}
