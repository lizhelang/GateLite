import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  console.log("Usage: npm run backup -- [--out-dir output/backups]");
  process.exit(0);
}

const outputDir = path.resolve(root, valueAfter("--out-dir") || process.env.GATELITE_BACKUP_DIR || "output/backups");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const archivePath = path.join(outputDir, `gatelite-backup-${stamp}.tar.gz`);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gatelite-backup-"));

try {
  const paths = runtimePaths();
  const manifest = {
    createdAt: new Date().toISOString(),
    packageVersion: readPackageVersion(),
    sourceRoot: root,
    paths,
    contents: []
  };

  copyFileIfExists(paths.stateFile, path.join(tempDir, "state", "gatelite-state.json"), manifest, "stateFile");
  copyDirIfExists(path.join(path.dirname(paths.stateFile), "rollbacks"), path.join(tempDir, "state", "rollbacks"), manifest, "rollbacksDir");
  copyFileIfExists(paths.dynamicFile, path.join(tempDir, "dynamic", "gatelite.yml"), manifest, "dynamicFile");
  copyDirIfExists(paths.certDir, path.join(tempDir, "certs"), manifest, "certDir");

  fs.writeFileSync(path.join(tempDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  fs.mkdirSync(outputDir, { recursive: true });
  execFileSync("tar", ["-czf", archivePath, "-C", tempDir, "."], { stdio: "inherit" });
  console.log(`[ok] GateLite backup written: ${archivePath}`);
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

function copyFileIfExists(source, destination, manifest, label) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  manifest.contents.push({ label, source, archivedAs: path.relative(tempDir, destination) });
}

function copyDirIfExists(source, destination, manifest, label) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, preserveTimestamps: true });
  manifest.contents.push({ label, source, archivedAs: path.relative(tempDir, destination) });
}

function readPackageVersion() {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    return packageJson.version;
  } catch {
    return undefined;
  }
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}
