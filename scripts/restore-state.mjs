import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  console.log("Usage: npm run restore -- <backup.tar.gz> --force [--replace]");
  process.exit(0);
}

const archivePath = path.resolve(root, process.env.GATELITE_RESTORE_ARCHIVE || firstPositionalArg() || "");
const force = args.has("--force") || process.env.GATELITE_RESTORE_CONFIRM === "restore";
const replace = args.has("--replace") || process.env.GATELITE_RESTORE_REPLACE === "true";

if (!archivePath || !fs.existsSync(archivePath)) {
  console.error("[fail] Provide an existing backup archive path.");
  process.exit(1);
}

if (!force) {
  console.error("[fail] Restore is destructive. Re-run with --force or GATELITE_RESTORE_CONFIRM=restore.");
  process.exit(1);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gatelite-restore-"));

try {
  execFileSync("tar", ["-xzf", archivePath, "-C", tempDir], { stdio: "inherit" });
  const manifestPath = path.join(tempDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error("Backup archive is missing manifest.json.");

  const paths = runtimePaths();
  const restored = [];

  restoreFile(path.join(tempDir, "state", "gatelite-state.json"), paths.stateFile, restored, "stateFile");
  restoreDir(path.join(tempDir, "state", "rollbacks"), path.join(path.dirname(paths.stateFile), "rollbacks"), restored, "rollbacksDir", replace);
  restoreFile(path.join(tempDir, "dynamic", "gatelite.yml"), paths.dynamicFile, restored, "dynamicFile");
  restoreDir(path.join(tempDir, "certs"), paths.certDir, restored, "certDir", replace);

  console.log(`[ok] GateLite restore completed from ${archivePath}`);
  for (const item of restored) console.log(`[ok] Restored ${item.label}: ${item.target}`);
} catch (error) {
  console.error(`[fail] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function runtimePaths() {
  return {
    stateFile: path.resolve(root, process.env.GATELITE_STATE_FILE || "runtime/gatelite-state.json"),
    dynamicFile: path.resolve(root, process.env.GATELITE_DYNAMIC_FILE || "runtime/traefik/gatelite.yml"),
    certDir: path.resolve(root, process.env.GATELITE_CERT_DIR || "runtime/certs")
  };
}

function restoreFile(source, target, restored, label) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  restored.push({ label, target });
}

function restoreDir(source, target, restored, label, shouldReplace) {
  if (!fs.existsSync(source)) return;
  if (shouldReplace) fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(source, target, { recursive: true, preserveTimestamps: true });
  restored.push({ label, target });
}

function firstPositionalArg() {
  return process.argv.slice(2).find((arg) => !arg.startsWith("-"));
}
