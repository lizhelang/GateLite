import type { ApplyResponse } from "../shared/types";
import type { SaveStateResult } from "./store";

export function applyResponse<T>(saved: SaveStateResult, data: T): ApplyResponse<T> {
  return {
    data,
    apply: {
      action: saved.event.action,
      summary: saved.event.summary,
      historyId: saved.event.id,
      rollbackId: saved.event.rollbackId,
      rollbackAvailable: saved.event.rollbackAvailable,
      replayed: false
    }
  };
}

export function applyNoopResponse<T>(action: string, summary: string, data: T): ApplyResponse<T> {
  return {
    data,
    apply: {
      action,
      summary,
      rollbackAvailable: false,
      replayed: false
    }
  };
}

export function isApplyResponse(value: unknown): value is ApplyResponse<unknown> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const apply = record.apply as Record<string, unknown> | undefined;
  return Boolean(record.data !== undefined && apply && typeof apply.action === "string" && typeof apply.summary === "string");
}
