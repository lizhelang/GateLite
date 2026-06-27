import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type express from "express";
import type { ApplyResponse } from "../shared/types";
import { config } from "./config";
import { isApplyResponse } from "./apply-contract";

interface IdempotencyRecord {
  key: string;
  fingerprint: string;
  statusCode: number;
  body: ApplyResponse<unknown>;
  createdAt: string;
}

export function createIdempotencyMiddleware(): express.RequestHandler {
  return (request, response, next) => {
    if (!shouldUseIdempotency(request)) return next();

    const key = readIdempotencyKey(request);
    if (!key) return next();
    if (!isValidIdempotencyKey(key)) {
      response.status(400).json({
        error: "Invalid Idempotency-Key header.",
        code: "INVALID_IDEMPOTENCY_KEY"
      });
      return;
    }

    const fingerprint = fingerprintRequest(request);
    const existing = readRecord(key);
    if (existing) {
      response.setHeader("Idempotency-Key", key);
      if (existing.fingerprint !== fingerprint) {
        response.status(409).json({
          error: "Idempotency-Key was already used for a different request.",
          code: "IDEMPOTENCY_KEY_CONFLICT",
          idempotencyKey: key
        });
        return;
      }

      response.setHeader("Idempotency-Replayed", "true");
      response.status(existing.statusCode).json(markReplayed(existing.body, key));
      return;
    }

    const originalJson = response.json.bind(response);
    response.json = ((body: unknown) => {
      if (response.statusCode >= 200 && response.statusCode < 300 && isApplyResponse(body)) {
        const applyBody = attachIdempotency(body, key, false);
        writeRecord({
          key,
          fingerprint,
          statusCode: response.statusCode,
          body: applyBody,
          createdAt: new Date().toISOString()
        });
        response.setHeader("Idempotency-Key", key);
        response.setHeader("Idempotency-Replayed", "false");
        return originalJson(applyBody);
      }
      return originalJson(body);
    }) as typeof response.json;

    next();
  };
}

function shouldUseIdempotency(request: express.Request): boolean {
  if (!request.path.startsWith("/api/")) return false;
  return ["POST", "PUT", "PATCH", "DELETE"].includes(request.method.toUpperCase());
}

function readIdempotencyKey(request: express.Request): string | undefined {
  const value = request.header("Idempotency-Key") || request.header("X-Idempotency-Key");
  return value?.trim() || undefined;
}

function isValidIdempotencyKey(value: string): boolean {
  return value.length <= 128 && /^[a-zA-Z0-9._:-]+$/.test(value);
}

function fingerprintRequest(request: express.Request): string {
  return hashJson({
    method: request.method.toUpperCase(),
    path: request.path,
    query: request.query,
    body: request.body ?? null
  });
}

function attachIdempotency<T>(body: ApplyResponse<T>, key: string, replayed: boolean): ApplyResponse<T> {
  return {
    ...body,
    apply: {
      ...body.apply,
      idempotencyKey: key,
      replayed
    }
  };
}

function markReplayed(body: ApplyResponse<unknown>, key: string): ApplyResponse<unknown> {
  return attachIdempotency(body, key, true);
}

function readRecord(key: string): IdempotencyRecord | undefined {
  const filePath = recordPath(key);
  if (!fs.existsSync(filePath)) return undefined;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as IdempotencyRecord;
}

function writeRecord(record: IdempotencyRecord): void {
  const filePath = recordPath(record.key);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf8");
}

function recordPath(key: string): string {
  return path.join(path.dirname(config.stateFile), "idempotency", `${hashString(key)}.json`);
}

function hashJson(value: unknown): string {
  return hashString(stableStringify(value));
}

function hashString(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
