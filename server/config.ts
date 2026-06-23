import path from "node:path";

export interface AppConfig {
  port: number;
  traefikApiUrl: string;
  stateFile: string;
  dynamicFile: string;
  certDir: string;
  certMountPath: string;
}

const root = process.cwd();

export const config: AppConfig = {
  port: Number(process.env.PORT || 3001),
  traefikApiUrl: process.env.TRAEFIK_API_URL || "http://localhost:18081",
  stateFile: path.resolve(root, process.env.GATELITE_STATE_FILE || "runtime/gatelite-state.json"),
  dynamicFile: path.resolve(root, process.env.GATELITE_DYNAMIC_FILE || "runtime/traefik/gatelite.yml"),
  certDir: path.resolve(root, process.env.GATELITE_CERT_DIR || "runtime/certs"),
  certMountPath: process.env.GATELITE_CERT_MOUNT_PATH || "/certs"
};

