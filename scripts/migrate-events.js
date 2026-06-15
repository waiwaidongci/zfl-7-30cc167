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

function timestampSortValue(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = new Date(value).getTime();
  if (!Number.isNaN(parsed)) return parsed;

  const match = String(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T(\d{1,3}):(\d{1,2}):(\d{1,2})(?:\.(\d+))?Z?)?$/);
  if (!match) return Number.POSITIVE_INFINITY;

  const [, y, m, d, h = "0", min = "0", s = "0", ms = "0"] = match;
  return Date.UTC(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(h),
    Number(min),
    Number(s),
    Number(String(ms).slice(0, 3).padEnd(3, "0"))
  );
}

function compareTimestamps(a, b) {
  const diff = timestampSortValue(a) - timestampSortValue(b);
  return diff || String(a || "").localeCompare(String(b || ""));
}

function normalizeEventTimestamp(value) {
  const sortValue = timestampSortValue(value);
  return Number.isFinite(sortValue) ? new Date(sortValue).toISOString() : value;
}

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

  return timestamps.sort(compareTimestamps)[0];
}

function cloneAnimalBase(animal) {
  return {
    id: animal.id,
    strain: animal.strain,
    cageId: animal.cageId,
    roomId: animal.roomId || null,
    zoneId: animal.zoneId || null,
    projectId: animal.projectId || null,
    sex: animal.sex,
    birthDate: animal.birthDate,
    project: animal.project,
    keeper: animal.keeper,
    status: animal.enteredQuarantineAt ? "quarantine" : animal.status,
    observationNodes: [],
    notes: [],
    moves: [],
    quarantineRecords: [],
    enteredQuarantineAt: animal.enteredQuarantineAt || null,
    quarantineReleasedAt: null,
    quarantineApproval: null,
    abnormalMarkedAt: null,
    abnormalReason: null,
    abnormalHandler: null,
    abnormalNotes: null,
    abnormalResolvedAt: null,
    abnormalResolution: null,
    abnormalResolver: null,
    removedAt: null,
    removeReason: null,
    fatherId: animal.fatherId || null,
    motherId: animal.motherId || null,
    litterId: animal.litterId || null,
    weanedAt: null,
    weaningWeight: null,
    breedingInfo: animal.breedingInfo || null
  };
}

function snapshotCopy(animal) {
  return JSON.parse(JSON.stringify(animal));
}

function buildAnimalEvents(animal, operator) {
  const events = [];
  const createdTimestamp = getEarliestTimestamp(animal);
  const state = cloneAnimalBase(animal);
  if (animal.weanedAt && animal.weanedAt <= createdTimestamp) {
    state.weanedAt = animal.weanedAt;
    state.weaningWeight = animal.weaningWeight || null;
  }

  events.push({
    eventType: EVENT_TYPES.ANIMAL_CREATED,
    animalId: animal.id,
    roomId: animal.roomId || null,
    zoneId: animal.zoneId || null,
    projectId: animal.projectId || null,
    timestamp: normalizeEventTimestamp(createdTimestamp),
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
    snapshotAfter: snapshotCopy(state),
    metadata: { source: "snapshot_migration", migrationType: "animal_created" }
  });

  if (animal.quarantineRecords && animal.quarantineRecords.length > 0) {
    const sortedRecords = [...animal.quarantineRecords].sort((a, b) => {
      const tsA = a.createdAt || `${a.date}T00:00:00.000Z`;
      const tsB = b.createdAt || `${b.date}T00:00:00.000Z`;
      return compareTimestamps(tsA, tsB);
    });

    for (const record of sortedRecords) {
      const recordTs = record.createdAt || `${record.date}T00:00:00.000Z`;
      if (compareTimestamps(recordTs, createdTimestamp) <= 0) continue;
      state.quarantineRecords.push(record);
      if (record.isAbnormal && state.status === "quarantine") {
        state.status = "quarantine_abnormal";
      }

      events.push({
        eventType: EVENT_TYPES.ANIMAL_QUARANTINE_RECORD,
        animalId: animal.id,
        roomId: animal.roomId || null,
        zoneId: animal.zoneId || null,
        projectId: animal.projectId || null,
        timestamp: normalizeEventTimestamp(recordTs),
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
        snapshotAfter: snapshotCopy(state),
        metadata: { source: "snapshot_migration", migrationType: "quarantine_record", recordId: record.id }
      });
    }
  }

  if (animal.abnormalMarkedAt && compareTimestamps(animal.abnormalMarkedAt, createdTimestamp) > 0) {
    state.status = "quarantine_abnormal";
    state.abnormalMarkedAt = animal.abnormalMarkedAt;
    state.abnormalReason = animal.abnormalReason || "检疫异常";
    state.abnormalHandler = animal.abnormalHandler || animal.keeper;
    state.abnormalNotes = animal.abnormalNotes || "";
    events.push({
      eventType: EVENT_TYPES.ANIMAL_QUARANTINE_ABNORMAL,
      animalId: animal.id,
      roomId: animal.roomId || null,
      zoneId: animal.zoneId || null,
      projectId: animal.projectId || null,
      timestamp: normalizeEventTimestamp(animal.abnormalMarkedAt),
      operator: { role: "keeper", name: animal.abnormalHandler || animal.keeper, key: "migrated" },
      payload: {
        reason: animal.abnormalReason || "检疫异常",
        notes: animal.abnormalNotes || "",
        migrated: true
      },
      snapshotAfter: snapshotCopy(state),
      metadata: { source: "snapshot_migration", migrationType: "quarantine_abnormal" }
    });
  }

  if (animal.quarantineReleasedAt && compareTimestamps(animal.quarantineReleasedAt, createdTimestamp) > 0) {
    const approval = animal.quarantineApproval || {};
    state.status = "released";
    state.quarantineReleasedAt = animal.quarantineReleasedAt;
    state.quarantineApproval = approval;
    if (approval.targetCageId) {
      state.cageId = approval.targetCageId;
    }
    events.push({
      eventType: EVENT_TYPES.ANIMAL_QUARANTINE_RELEASED,
      animalId: animal.id,
      roomId: animal.roomId || state.roomId || null,
      zoneId: animal.zoneId || state.zoneId || null,
      projectId: animal.projectId || state.projectId || null,
      timestamp: normalizeEventTimestamp(animal.quarantineReleasedAt),
      operator: { role: "keeper", name: approval.approver || animal.keeper, key: "migrated" },
      payload: {
        approvalId: approval.id || null,
        targetCageId: approval.targetCageId || animal.cageId,
        notes: approval.notes || "",
        migrated: true
      },
      snapshotAfter: snapshotCopy(state),
      metadata: { source: "snapshot_migration", migrationType: "quarantine_release" }
    });
  }

  if (animal.moves && animal.moves.length > 0) {
    const sortedMoves = [...animal.moves].sort((a, b) =>
      compareTimestamps(a.movedAt, b.movedAt)
    );

    for (const move of sortedMoves) {
      if (!move.movedAt || compareTimestamps(move.movedAt, createdTimestamp) <= 0) continue;
      state.cageId = move.to;
      state.moves.push(move);

      events.push({
        eventType: EVENT_TYPES.ANIMAL_MOVED,
        animalId: animal.id,
        roomId: move.toRoomId || animal.roomId || null,
        zoneId: animal.zoneId || null,
        projectId: animal.projectId || null,
        timestamp: normalizeEventTimestamp(move.movedAt),
        operator,
        payload: {
          moveId: move.id,
          fromCage: move.from,
          toCage: move.to,
          fromRoomId: move.fromRoomId || null,
          toRoomId: move.toRoomId || null,
          reason: move.reason || "笼位调整",
          migrated: true
        },
        snapshotAfter: snapshotCopy(state),
        metadata: { source: "snapshot_migration", migrationType: "move", moveId: move.id }
      });
    }
  }

  if (animal.notes && animal.notes.length > 0) {
    const sortedNotes = [...animal.notes].sort((a, b) =>
      compareTimestamps(a.date, b.date)
    );

    for (const note of sortedNotes) {
      const noteTs = `${note.date}T12:00:00.000Z`;
      if (compareTimestamps(noteTs, createdTimestamp) <= 0) continue;
      state.notes.push(note);

      events.push({
        eventType: EVENT_TYPES.ANIMAL_NOTE_ADDED,
        animalId: animal.id,
        roomId: animal.roomId || null,
        zoneId: animal.zoneId || null,
        projectId: animal.projectId || null,
        timestamp: normalizeEventTimestamp(noteTs),
        operator: { role: "keeper", name: note.keeper || animal.keeper, key: "migrated" },
        payload: {
          noteId: note.id,
          date: note.date,
          weight: note.weight,
          condition: note.condition,
          type: note.type || "general",
          migrated: true
        },
        snapshotAfter: snapshotCopy(state),
        metadata: { source: "snapshot_migration", migrationType: "note", noteId: note.id }
      });
    }
  }

  if (animal.removedAt && compareTimestamps(animal.removedAt, createdTimestamp) > 0) {
    state.status = "removed";
    state.removedAt = animal.removedAt;
    state.removeReason = animal.removeReason || "移出";
    events.push({
      eventType: EVENT_TYPES.ANIMAL_REMOVED,
      animalId: animal.id,
      roomId: animal.roomId || null,
      zoneId: animal.zoneId || null,
      projectId: animal.projectId || null,
      timestamp: normalizeEventTimestamp(animal.removedAt),
      operator,
      payload: {
        reason: animal.removeReason || "移出",
        migrated: true
      },
      snapshotAfter: snapshotCopy(state),
      metadata: { source: "snapshot_migration", migrationType: "remove" }
    });
  }

  if (animal.litterId && animal.weanedAt) {
    const weanTs = animal.weanedAt;
    if (compareTimestamps(weanTs, createdTimestamp) > 0 && !events.find(e => e.eventType === EVENT_TYPES.BREEDING_LITTER_WEANED && e.timestamp === weanTs)) {
      state.weanedAt = animal.weanedAt;
      state.weaningWeight = animal.weaningWeight || null;
      events.push({
        eventType: EVENT_TYPES.BREEDING_LITTER_WEANED,
        animalId: animal.id,
        roomId: animal.roomId || null,
        zoneId: animal.zoneId || null,
        projectId: animal.projectId || null,
        timestamp: normalizeEventTimestamp(weanTs),
        operator,
        payload: {
          litterId: animal.litterId,
          fatherId: animal.fatherId,
          motherId: animal.motherId,
          weaningWeight: animal.weaningWeight || null,
          migrated: true
        },
        snapshotAfter: snapshotCopy(state),
        metadata: { source: "snapshot_migration", migrationType: "weaned" }
      });
    }
  }

  return events.sort((a, b) => compareTimestamps(a.timestamp, b.timestamp));
}

function buildFeedingEvents(db, operator) {
  const events = [];
  const records = db.feedingRecords || [];

  for (const record of records) {
    if (record.targetType !== "animal" || !record.targetId) continue;

    events.push({
      eventType: EVENT_TYPES.FEEDING_RECORDED,
      animalId: record.targetId,
      roomId: record.roomId || null,
      zoneId: record.zoneId || null,
      projectId: record.projectId || null,
      timestamp: normalizeEventTimestamp(record.actualTime || new Date().toISOString()),
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
        roomId: record.roomId || null,
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

  allEvents.sort((a, b) => compareTimestamps(a.timestamp, b.timestamp));

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
