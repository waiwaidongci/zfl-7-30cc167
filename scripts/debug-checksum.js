import { readFile, unlink, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "lab.json");
const ledgerPath = join(__dirname, "..", "data", "event-ledger.json");
const dbBackupPath = join(__dirname, "..", "data", "lab.json.test-backup");
const ledgerBackupPath = join(__dirname, "..", "data", "event-ledger.json.test-backup");

import { verifyIntegrity, resetLedger } from "../lib/eventLedger.js";
import { migrateFromSnapshot } from "./migrate-events.js";

async function loadDb() {
  return JSON.parse(await readFile(dbPath, "utf8"));
}

async function main() {
  if (existsSync(ledgerPath)) {
    await copyFile(ledgerPath, ledgerBackupPath);
  }
  if (existsSync(dbPath)) {
    await copyFile(dbPath, dbBackupPath);
  }

  try {
    await resetLedger();
    await migrateFromSnapshot({
      operator: { role: "system", name: "test", key: "test" }
    });

    const result = await verifyIntegrity();
    console.log("Integrity result:", JSON.stringify(result, null, 2));

    if (!result.valid && result.errors.length > 0) {
      console.log("\nFirst 5 errors:");
      for (const err of result.errors.slice(0, 5)) {
        console.log(JSON.stringify(err, null, 2));
      }
    }
  } finally {
    if (existsSync(ledgerBackupPath)) {
      await copyFile(ledgerBackupPath, ledgerPath);
      await unlink(ledgerBackupPath);
    }
    if (existsSync(dbBackupPath)) {
      await copyFile(dbBackupPath, dbPath);
      await unlink(dbBackupPath);
    }
  }
}

main().catch(console.error);
