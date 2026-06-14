import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "lab.json");
const ledgerPath = join(__dirname, "..", "data", "event-ledger.json");

import {
  EVENT_TYPES,
  recordEventsBatch,
  recordEvent,
  markAsMigrated,
  ledgerExists,
  resetLedger,
  getLedgerInfo
} from "../lib/eventLedger.js";

async function loadDb() {
  if (!existsSync(dbPath)) {
    throw new Error("lab.json not found");
  }
  return JSON.parse(await readFile(dbPath, "utf8"));
}

function getEarliestTimestamp(animal) {
  const timestamps = [];

  if (animal.enteredQuarantineAt) {
    timestamps.push(animal.enteredQuarantineAt);
  }

  if (animal.breedingInfo) {
    timestamps.push(animal.weanedAt || animal.enteredQuarantineAt);
  }

  if (animal.quarantineRecords && animal.quarantineRecords.length > 0) {
    for (const r of animal.quarantineRecords) {
      if (r.createdAt) timestamps.push(r.createdAt);
      if (r.date) timestamps.push(`${r.date}T00:00:00.000Z`);
    }
  }

  if (animal.moves && animal.moves.length > 0) {
    for (const m of animal.moves) {
      if (m.movedAt) timestamps.push(m.movedAt);
    }
  }

  if (animal.notes && animal.notes.length > 0) {
    for (const n of animal.notes) {
      if (n.date) timestamps.push(`${n.date}T00:00:00.000Z`);
    }
  }

  if (animal.quarantineReleasedAt) {
    timestamps.push(animal.quarantineReleasedAt);
  }

  if (animal.abnormalMarkedAt) {
    timestamps.push(animal.abnormalMarkedAt);
  }

  if (animal.removedAt) {
    timestamps.push(animal.removedAt);
  }

  if (timestamps.length === 0) {
    return new Date().toISOString();
  }

  return timestamps.sort()[0];
}

function buildAnimalEvents(animal, operator) {
  const events = [];
  const createdTimestamp = getEarliestTimestamp(animal);

  events.push({
    eventType: EVENT_TYPES.ANIMAL_CREATED,
    animalId: animal.id,
    timestamp: createdTimestamp,
    operator,
    payload: {
      id: animal.id,
      strain: animal.strain,
      cageId: animal.cageId,
      sex: animal.sex,
      birthDate: animal.birthDate,
      project: animal.project,
      keeper: animal.keeper,
      initialStatus: animal.status,
      fatherId: animal.fatherId || null,
      motherId: animal.motherId || null,
      litterId: animal.litterId || null,
      weanedAt: animal.weanedAt || null,
      breedingInfo: animal.breedingInfo || null,
      migrated: true
    },
    snapshotAfter: animal,
    metadata: { source: "snapshot_migration", migrationType: "animal_created" }
  });

  if (animal.quarantineRecords && animal.quarantineRecords.length > 0) {
    const sortedRecords = [...animal.quarantineRecords].sort((a, b) => {
      const tsA = a.createdAt || `${a.date}T00:00:00.000Z`;
      const tsB = b.createdAt || `${b.date}T00:00:00.000Z`;
      return tsA.localeCompare(tsB);
    });

    for (const record of sortedRecords) {
      const recordTs = record.createdAt || `${record.date}T00:00:00.000Z`;
      if (recordTs <= createdTimestamp) continue;

      events.push({
        eventType: EVENT_TYPES.ANIMAL_QUARANTINE_RECORD,
        animalId: animal.id,
        timestamp: recordTs,
        operator: { role: "keeper", name: record.examiner || animal.keeper, key: "migrated" },
        payload: {
          recordId: record.id,
          date: record.date,
          temperature: record.temperature,
          weight: record.weight,
          condition: record.condition,
          symptoms: record.symptoms || [],
          isAbnormal: record.isAbnormal || false,
          notes: record.notes || "",
          migrated: true
        },
        snapshotAfter: animal,
        metadata: { source: "snapshot_migration", migrationType: "quarantine_record", recordId: record.id }
      });
    }
  }

  if (animal.abnormalMarkedAt && animal.abnormalMarkedAt > createdTimestamp) {
    events.push({
      eventType: EVENT_TYPES.ANIMAL_QUARANTINE_ABNORMAL,
      animalId: animal.id,
      timestamp: animal.abnormalMarkedAt,
      operator: { role: "keeper", name: animal.abnormalHandler || animal.keeper, key: "migrated" },
      payload: {
        reason: animal.abnormalReason || "检疫异常",
        notes: animal.abnormalNotes || "",
        migrated: true
      },
      snapshotAfter: animal,
      metadata: { source: "snapshot_migration", migrationType: "quarantine_abnormal" }
    });
  }

  if (animal.quarantineReleasedAt && animal.quarantineReleasedAt > createdTimestamp) {
    const approval = animal.quarantineApproval || {};
    events.push({
      eventType: EVENT_TYPES.ANIMAL_QUARANTINE_RELEASED,
      animalId: animal.id,
      timestamp: animal.quarantineReleasedAt,
      operator: { role: "keeper", name: approval.approver || animal.keeper, key: "migrated" },
      payload: {
        approvalId: approval.id || null,
        targetCageId: approval.targetCageId || animal.cageId,
        notes: approval.notes || "",
        migrated: true
      },
      snapshotAfter: animal,
      metadata: { source: "snapshot_migration", migrationType: "quarantine_release" }
    });
  }

  if (animal.moves && animal.moves.length > 0) {
    const sortedMoves = [...animal.moves].sort((a, b) =>
      (a.movedAt || "").localeCompare(b.movedAt || "")
    );

    for (const move of sortedMoves) {
      if (!move.movedAt || move.movedAt <= createdTimestamp) continue;

      events.push({
        eventType: EVENT_TYPES.ANIMAL_MOVED,
        animalId: animal.id,
        timestamp: move.movedAt,
        operator,
        payload: {
          moveId: move.id,
          fromCage: move.from,
          toCage: move.to,
          reason: move.reason || "笼位调整",
          migrated: true
        },
        snapshotAfter: animal,
        metadata: { source: "snapshot_migration", migrationType: "move", moveId: move.id }
      });
    }
  }

  if (animal.notes && animal.notes.length > 0) {
    const sortedNotes = [...animal.notes].sort((a, b) =>
      (a.date || "").localeCompare(b.date || "")
    );

    for (const note of sortedNotes) {
      const noteTs = `${note.date}T12:00:00.000Z`;
      if (noteTs <= createdTimestamp) continue;

      events.push({
        eventType: EVENT_TYPES.ANIMAL_NOTE_ADDED,
        animalId: animal.id,
        timestamp: noteTs,
        operator: { role: "keeper", name: note.keeper || animal.keeper, key: "migrated" },
        payload: {
          noteId: note.id,
          date: note.date,
          weight: note.weight,
          condition: note.condition,
          type: note.type || "general",
          migrated: true
        },
        snapshotAfter: animal,
        metadata: { source: "snapshot_migration", migrationType: "note", noteId: note.id }
      });
    }
  }

  if (animal.removedAt && animal.removedAt > createdTimestamp) {
    events.push({
      eventType: EVENT_TYPES.ANIMAL_REMOVED,
      animalId: animal.id,
      timestamp: animal.removedAt,
      operator,
      payload: {
        reason: animal.removeReason || "移出",
        migrated: true
      },
      snapshotAfter: animal,
      metadata: { source: "snapshot_migration", migrationType: "remove" }
    });
  }

  if (animal.litterId && animal.weanedAt) {
    const weanTs = animal.weanedAt;
    if (weanTs > createdTimestamp && !events.find(e => e.eventType === EVENT_TYPES.BREEDING_LITTER_WEANED && e.timestamp === weanTs)) {
      events.push({
        eventType: EVENT_TYPES.BREEDING_LITTER_WEANED,
        animalId: animal.id,
        timestamp: weanTs,
        operator,
        payload: {
          litterId: animal.litterId,
          fatherId: animal.fatherId,
          motherId: animal.motherId,
          weaningWeight: animal.weaningWeight || null,
          migrated: true
        },
        snapshotAfter: animal,
        metadata: { source: "snapshot_migration", migrationType: "weaned" }
      });
    }
  }

  return events;
}

function buildFeedingEvents(db, operator) {
  const events = [];
  const records = db.feedingRecords || [];

  for (const record of records) {
    if (record.targetType !== "animal" || !record.targetId) continue;

    events.push({
      eventType: EVENT_TYPES.FEEDING_RECORDED,
      animalId: record.targetId,
      timestamp: record.actualTime || new Date().toISOString(),
      operator: { role: "keeper", name: record.keeper, key: "migrated" },
      payload: {
        recordId: record.id,
        planId: record.planId,
        feedType: record.feedType,
        amount: record.amount,
        condition: record.condition || "",
        weight: record.weight,
        notes: record.notes || "",
        date: record.date,
        migrated: true
      },
      metadata: { source: "snapshot_migration", migrationType: "feeding_record", recordId: record.id }
    });
  }

  return events;
}

async function migrateFromSnapshot(options = {}) {
  const force = options.force || false;
  const operator = options.operator || { role: "system", name: "migration", key: "system" };

  console.log("Starting event ledger migration from snapshot...");

  const exists = await ledgerExists();
  if (exists && !force) {
    const info = await getLedgerInfo();
    if (info.migratedFromSnapshot) {
      console.log("Ledger already migrated from snapshot. Use --force to re-migrate.");
      return { alreadyMigrated: true, info };
    }
  }

  if (force && exists) {
    console.log("Force mode: resetting existing ledger...");
    await resetLedger();
  }

  const db = await loadDb();
  const animals = db.animals || [];

  console.log(`Found ${animals.length} animals to process...`);

  await recordEvent(EVENT_TYPES.LEDGER_INITIALIZED, {
    totalAnimals: animals.length,
    migratedAt: new Date().toISOString()
  }, { operator, metadata: { source: "snapshot_migration" } });

  let allEvents = [];

  for (const animal of animals) {
    const animalEvents = buildAnimalEvents(animal, operator);
    allEvents = allEvents.concat(animalEvents);
  }

  const feedingEvents = buildFeedingEvents(db, operator);
  allEvents = allEvents.concat(feedingEvents);

  allEvents.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  console.log(`Generated ${allEvents.length} events from snapshot...`);

  const createdEvents = await recordEventsBatch(allEvents);

  await recordEvent(EVENT_TYPES.LEDGER_MIGRATED, {
    totalAnimals: animals.length,
    totalEvents: createdEvents.length,
    feedingEvents: feedingEvents.length
  }, { operator, metadata: { source: "snapshot_migration" } });

  await markAsMigrated();

  const info = await getLedgerInfo();
  console.log(`Migration complete. Total events: ${info.totalEvents}`);

  return {
    migrated: true,
    totalAnimals: animals.length,
    totalEvents: createdEvents.length,
    feedingEvents: feedingEvents.length,
    info
  };
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");

  try {
    const result = await migrateFromSnapshot({ force });
    console.log("\nMigration result:", JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export { migrateFromSnapshot, buildAnimalEvents, buildFeedingEvents, getEarliestTimestamp };
