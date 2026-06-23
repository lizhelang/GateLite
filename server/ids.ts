import crypto from "node:crypto";

export function createId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(5).toString("hex")}`;
}

export function traefikName(prefix: string, id: string): string {
  return `${prefix}-${id}`.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
}

