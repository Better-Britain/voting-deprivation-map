import crypto from "node:crypto";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(__dirname, "..", "..");
export const dataDir = path.resolve(projectRoot, "src/data");
export const SOURCE_MANIFEST_PATH = path.resolve(dataDir, "source-update-manifest.json");
export const BUILD_STATE_PATH = path.resolve(dataDir, "build-dependency-state.json");
export const WARD_ELECTION_PROGRESS_PATH = path.resolve(dataDir, "ward-election-progress.json");

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function ensureParentDir(filePath) {
  await ensureDir(path.dirname(filePath));
}

export async function readJsonIfExists(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJson(filePath, payload) {
  await ensureParentDir(filePath);
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

export async function snapshotFiles(paths) {
  const entries = {};
  for (const filePath of paths) {
    try {
      const content = await fs.readFile(filePath);
      entries[filePath] = {
        exists: true,
        sha1: crypto.createHash("sha1").update(content).digest("hex")
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        entries[filePath] = { exists: false, sha1: null };
        continue;
      }
      throw error;
    }
  }
  return entries;
}

export function snapshotsDiffer(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    const left = before?.[key] || { exists: false, sha1: null };
    const right = after?.[key] || { exists: false, sha1: null };
    if (left.exists !== right.exists) return true;
    if (left.sha1 !== right.sha1) return true;
  }
  return false;
}

export async function runCommand(command, args, options = {}) {
  const {
    cwd = projectRoot,
    env = {},
    label = `${command} ${args.join(" ")}`
  } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: {
        ...process.env,
        ...env
      }
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${label} failed with exit code ${code}`));
      }
    });
  });
}

async function updateManifestAtPath(filePath, entryKey, payload) {
  const manifest = (await readJsonIfExists(filePath, {
    updated_at_utc: null,
    entries: {}
  })) || { updated_at_utc: null, entries: {} };
  manifest.updated_at_utc = new Date().toISOString();
  manifest.entries = manifest.entries || {};
  manifest.entries[entryKey] = {
    ...(manifest.entries[entryKey] || {}),
    ...payload,
    updated_at_utc: manifest.updated_at_utc
  };
  await writeJson(filePath, manifest);
  return manifest.entries[entryKey];
}

export async function updateSourceManifest(entryKey, payload) {
  return updateManifestAtPath(SOURCE_MANIFEST_PATH, entryKey, payload);
}

export async function updateBuildState(entryKey, payload) {
  return updateManifestAtPath(BUILD_STATE_PATH, entryKey, payload);
}

export async function readWardElectionProgress() {
  return readJsonIfExists(WARD_ELECTION_PROGRESS_PATH, {
    updated_at_utc: null,
    current: {},
    history: {}
  });
}

export async function writeWardElectionProgress(progress) {
  const nextProgress = {
    ...(progress || {}),
    updated_at_utc: new Date().toISOString()
  };
  await writeJson(WARD_ELECTION_PROGRESS_PATH, nextProgress);
  return nextProgress;
}
