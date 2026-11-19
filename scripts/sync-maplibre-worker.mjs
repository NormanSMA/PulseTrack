import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(
  rootDir,
  "node_modules",
  "maplibre-gl",
  "dist",
  "maplibre-gl-worker.mjs",
);
const targetDir = path.join(rootDir, "public", "workers");
const targetPath = path.join(targetDir, "maplibre-gl-worker.js");

if (!existsSync(sourcePath)) {
  console.error(`No se encontro el worker de MapLibre en: ${sourcePath}`);
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });
copyFileSync(sourcePath, targetPath);
