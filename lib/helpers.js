import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultDbPath = join(__dirname, "..", "data", "lab.json");
const dbPath = process.env.DB_PATH || defaultDbPath;

export async function loadDb() {
  if (!existsSync(dbPath)) {
    return null;
  }
  return JSON.parse(await readFile(dbPath, "utf8"));
}

export async function saveDb(db) {
  await mkdir(dirname(dbPath), { recursive: true });
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

export function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
  return true;
}

export async function body(req) {
  if (req._bodyCache !== undefined) return req._bodyCache;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let result = {};
  if (chunks.length) {
    const text = Buffer.concat(chunks).toString("utf8");
    if (text.trim()) {
      try { result = JSON.parse(text); }
      catch (e) { result = { _raw: text }; }
    }
  }
  req._bodyCache = result;
  return result;
}

export function localDate(date) {
  const d = date || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function readQuery(req) {
  return new URL(req.url, `http://${req.headers.host}`);
}
