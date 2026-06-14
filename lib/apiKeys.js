import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, "..", "config", "api-keys.json");
const examplePath = join(__dirname, "..", "config", "api-keys.example.json");

let cache = null;
let cacheTime = 0;
const CACHE_TTL = 5000;

export const ROLES = {
  ADMIN: "admin",
  KEEPER: "keeper",
  READONLY: "readonly"
};

export async function loadApiKeys() {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL) {
    return cache;
  }

  let targetPath = configPath;
  if (!existsSync(configPath)) {
    if (!existsSync(examplePath)) {
      cache = { apiKeys: [] };
      cacheTime = now;
      return cache;
    }
    targetPath = examplePath;
  }

  try {
    const raw = await readFile(targetPath, "utf8");
    const parsed = JSON.parse(raw);
    cache = {
      apiKeys: Array.isArray(parsed.apiKeys) ? parsed.apiKeys : []
    };
    cacheTime = now;
    return cache;
  } catch (err) {
    cache = { apiKeys: [] };
    cacheTime = now;
    return cache;
  }
}

export async function findApiKey(keyValue) {
  if (!keyValue) return null;
  const { apiKeys } = await loadApiKeys();
  const record = apiKeys.find((k) => k.key === keyValue) || null;
  if (record) {
    if (!record.allowedRoomIds) record.allowedRoomIds = ["*"];
    if (!record.allowedProjectIds) record.allowedProjectIds = ["*"];
    if (!record.allowedZones) record.allowedZones = ["*"];
  }
  return record;
}

export function getApiKeySource() {
  return existsSync(configPath) ? "config/api-keys.json" : "config/api-keys.example.json";
}

export function clearApiKeyCache() {
  cache = null;
  cacheTime = 0;
}
