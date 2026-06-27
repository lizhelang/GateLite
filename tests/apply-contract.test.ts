import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterAll, describe, expect, it } from "vitest";
import type { GateLiteState } from "../shared/types";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gatelite-apply-"));
process.env.GATELITE_STATE_FILE = path.join(tempDir, "gatelite-state.json");
process.env.GATELITE_DYNAMIC_FILE = path.join(tempDir, "traefik", "gatelite.yml");
process.env.GATELITE_CERT_DIR = path.join(tempDir, "certs");
process.env.GATELITE_SEED_DEMO = "false";

const { applyNoopResponse, applyResponse } = await import("../server/apply-contract");
const { createIdempotencyMiddleware } = await import("../server/idempotency");
const { saveStateWithEvent } = await import("../server/store");

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("apply API contract", () => {
  it("returns rollback metadata for saved state changes", () => {
    const base = emptyState();
    fs.mkdirSync(path.dirname(process.env.GATELITE_STATE_FILE!), { recursive: true });
    fs.writeFileSync(process.env.GATELITE_STATE_FILE!, JSON.stringify(base, null, 2));

    const saved = saveStateWithEvent(
      {
        ...base,
        groups: [{ id: "default", name: "Default", collapsed: true, order: 1 }]
      },
      "group.update",
      "Updated group Default."
    );
    const body = applyResponse(saved, saved.state.groups[0]);

    expect(body.data.name).toBe("Default");
    expect(body.apply.action).toBe("group.update");
    expect(body.apply.historyId).toMatch(/^evt-/);
    expect(body.apply.rollbackId).toBeTruthy();
    expect(body.apply.rollbackAvailable).toBe(true);
    expect(body.apply.replayed).toBe(false);
  });

  it("replays successful apply responses for the same Idempotency-Key", async () => {
    const app = express();
    let writes = 0;
    app.use(express.json());
    app.use(createIdempotencyMiddleware());
    app.post("/api/test-apply", (request, response) => {
      writes += 1;
      response.status(201).json(applyNoopResponse("test.apply", "Applied test request.", { writes, body: request.body }));
    });

    const server = app.listen(0);
    try {
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/test-apply`;
      const init = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "apply-test-1"
        },
        body: JSON.stringify({ name: "first" })
      };

      const first = await postJson(url, init);
      const replay = await postJson(url, init);
      const conflict = await postJson(url, {
        ...init,
        body: JSON.stringify({ name: "different" })
      });

      expect(first.status).toBe(201);
      expect(first.body.data.writes).toBe(1);
      expect(first.body.apply.idempotencyKey).toBe("apply-test-1");
      expect(first.body.apply.replayed).toBe(false);
      expect(first.headers.get("Idempotency-Replayed")).toBe("false");

      expect(replay.status).toBe(201);
      expect(replay.body.data.writes).toBe(1);
      expect(replay.body.apply.replayed).toBe(true);
      expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
      expect(writes).toBe(1);

      expect(conflict.status).toBe(409);
      expect(conflict.body.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
      expect(writes).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

function emptyState(): GateLiteState {
  return {
    version: 1,
    groups: [{ id: "default", name: "Default", collapsed: false, order: 1 }],
    webServices: [],
    certificates: [],
    history: [
      {
        id: "evt-initial",
        at: new Date().toISOString(),
        action: "state.init",
        summary: "Initialized test state."
      }
    ]
  };
}

async function postJson(url: string, init: RequestInit): Promise<{ status: number; headers: Headers; body: any }> {
  const response = await fetch(url, init);
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json()
  };
}
