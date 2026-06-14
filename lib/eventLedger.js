import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ledgerPath = join(__dirname, "..", "data", "event-ledger.json");

export const EVENT_TYPES = {
  ANIMAL_CREATED: "animal.created",
  ANIMAL_NOTE_ADDED: "animal.note_added",
  ANIMAL_MOVED: "animal.moved",
  ANIMAL_REMOVED: "animal.removed",
  ANIMAL_QUARANTINE_RECORD: "animal.quarantine_record",
  ANIMAL_QUARANTINE_RELEASED: "animal.quarantine_released",
  ANIMAL_QUARANTINE_ABNORMAL: "animal.quarantine_abnormal",
  ANIMAL_QUARANTINE_RESOLVED: "animal.quarantine_resolved",
  ANIMAL_BATCH_IMPORTED: "animal.batch_imported",
  FEEDING_RECORDED: "feeding.recorded",
  BREEDING_PAIR_CREATED: "breeding.pair_created",
  BREEDING_LITTER_WEANED: "breeding.litter_weaned",
  LEDGER_INITIALIZED: "ledger.initialized",
  LEDGER_MIGRATED: "ledger.migrated_from_snapshot"
};

export const EVENT_TYPE_LABELS = {
  [EVENT_TYPES.ANIMAL_CREATED]: "动物建档",
  [EVENT_TYPES.ANIMAL_NOTE_ADDED]: "添加饲养记录",
  [EVENT_TYPES.ANIMAL_MOVED]: "移笼",
  [EVENT_TYPES.ANIMAL_REMOVED]: "移出",
  [EVENT_TYPES.ANIMAL_QUARANTINE_RECORD]: "检疫记录",
  [EVENT_TYPES.ANIMAL_QUARANTINE_RELEASED]: "检疫放行",
  [EVENT_TYPES.ANIMAL_QUARANTINE_ABNORMAL]: "检疫异常标记",
  [EVENT_TYPES.ANIMAL_QUARANTINE_RESOLVED]: "检疫异常解除",
  [EVENT_TYPES.ANIMAL_BATCH_IMPORTED]: "批量导入",
  [EVENT_TYPES.FEEDING_RECORDED]: "饲喂记录",
  [EVENT_TYPES.BREEDING_PAIR_CREATED]: "繁育配对",
  [EVENT_TYPES.BREEDING_LITTER_WEANED]: "断奶分笼",
  [EVENT_TYPES.LEDGER_INITIALIZED]: "账本初始化",
  [EVENT_TYPES.LEDGER_MIGRATED]: "从快照迁移"
};

const ANIMAL_RELATED_EVENTS = [
  EVENT_TYPES.ANIMAL_CREATED,
  EVENT_TYPES.ANIMAL_NOTE_ADDED,
  EVENT_TYPES.ANIMAL_MOVED,
  EVENT_TYPES.ANIMAL_REMOVED,
  EVENT_TYPES.ANIMAL_QUARANTINE_RECORD,
  EVENT_TYPES.ANIMAL_QUARANTINE_RELEASED,
  EVENT_TYPES.ANIMAL_QUARANTINE_ABNORMAL,
  EVENT_TYPES.ANIMAL_QUARANTINE_RESOLVED,
  EVENT_TYPES.ANIMAL_BATCH_IMPORTED,
  EVENT_TYPES.FEEDING_RECORDED,
  EVENT_TYPES.BREEDING_PAIR_CREATED,
  EVENT_TYPES.BREEDING_LITTER_WEANED,
];

function generateChecksum(event) {
  const data = JSON.stringify({
    id: event.id,
    eventType: event.eventType,
    animalId: event.animalId,
    timestamp: event.timestamp,
    payload: event.payload,
    snapshotAfter: event.snapshotAfter
  });
  return crypto.createHash("sha256").update(data).digest("hex");
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function loadLedger() {
  if (!existsSync(ledgerPath)) {
    return { events: [], nextId: 1, migratedFromSnapshot: false, checksumChain: [] };
  }
  try {
    const raw = await readFile(ledgerPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      events: Array.isArray(parsed.events) ? parsed.events : [],
      nextId: typeof parsed.nextId === "number" ? parsed.nextId : (parsed.events?.length || 0) + 1,
      migratedFromSnapshot: parsed.migratedFromSnapshot || false,
      checksumChain: Array.isArray(parsed.checksumChain) ? parsed.checksumChain : []
    };
  } catch (e) {
    return { events: [], nextId: 1, migratedFromSnapshot: false, checksumChain: [] };
  }
}

async function saveLedger(ledger) {
  await mkdir(dirname(ledgerPath), { recursive: true });
  await writeFile(ledgerPath, JSON.stringify(ledger, null, 2));
}

function pickAnimalSnapshot(animal) {
  if (!animal) return null;
  return {
    id: animal.id,
    strain: animal.strain,
    cageId: animal.cageId,
    sex: animal.sex,
    birthDate: animal.birthDate,
    project: animal.project,
    keeper: animal.keeper,
    status: animal.status,
    enteredQuarantineAt: animal.enteredQuarantineAt || null,
    quarantineReleasedAt: animal.quarantineReleasedAt || null,
    removedAt: animal.removedAt || null,
    fatherId: animal.fatherId || null,
    motherId: animal.motherId || null,
    litterId: animal.litterId || null,
    weanedAt: animal.weanedAt || null,
    notesCount: animal.notes?.length || 0,
    movesCount: animal.moves?.length || 0,
    quarantineRecordsCount: animal.quarantineRecords?.length || 0
  };
}

export async function recordEvent(eventType, payload, options = {}) {
  const ledger = await loadLedger();
  const previousChecksum = ledger.checksumChain.length > 0
    ? ledger.checksumChain[ledger.checksumChain.length - 1]
    : null;

  const event = {
    id: `evt-${ledger.nextId}`,
    eventType,
    animalId: options.animalId || null,
    timestamp: options.timestamp || new Date().toISOString(),
    operator: options.operator || null,
    payload: payload || {},
    snapshotAfter: options.snapshotAfter ? pickAnimalSnapshot(options.snapshotAfter) : null,
    previousChecksum,
    metadata: options.metadata || null
  };

  event.checksum = generateChecksum(event);
  ledger.events.push(event);
  ledger.checksumChain.push(event.checksum);
  ledger.nextId += 1;

  await saveLedger(ledger);
  return event;
}

export async function recordEventsBatch(eventsData) {
  const ledger = await loadLedger();
  const createdEvents = [];

  for (const data of eventsData) {
    const previousChecksum = ledger.checksumChain.length > 0
      ? ledger.checksumChain[ledger.checksumChain.length - 1]
      : null;

    const event = {
      id: `evt-${ledger.nextId}`,
      eventType: data.eventType,
      animalId: data.animalId || null,
      timestamp: data.timestamp || new Date().toISOString(),
      operator: data.operator || null,
      payload: data.payload || {},
      snapshotAfter: data.snapshotAfter ? pickAnimalSnapshot(data.snapshotAfter) : null,
      previousChecksum,
      metadata: data.metadata || null
    };

    event.checksum = generateChecksum(event);
    ledger.events.push(event);
    ledger.checksumChain.push(event.checksum);
    ledger.nextId += 1;
    createdEvents.push(event);
  }

  await saveLedger(ledger);
  return createdEvents;
}

export async function getLedgerInfo() {
  const ledger = await loadLedger();
  const byType = {};
  const byAnimal = {};

  for (const event of ledger.events) {
    byType[event.eventType] = (byType[event.eventType] || 0) + 1;
    if (event.animalId) {
      byAnimal[event.animalId] = (byAnimal[event.animalId] || 0) + 1;
    }
  }

  return {
    totalEvents: ledger.events.length,
    nextId: ledger.nextId,
    migratedFromSnapshot: ledger.migratedFromSnapshot,
    byType,
    uniqueAnimals: Object.keys(byAnimal).length,
    checksumChainLength: ledger.checksumChain.length,
    integrityStatus: ledger.checksumChain.length === ledger.events.length ? "ok" : "mismatch"
  };
}

export async function queryEvents(filters = {}) {
  const ledger = await loadLedger();
  let events = [...ledger.events];

  if (filters.eventType) {
    if (Array.isArray(filters.eventType)) {
      events = events.filter(e => filters.eventType.includes(e.eventType));
    } else {
      events = events.filter(e => e.eventType === filters.eventType);
    }
  }

  if (filters.animalId) {
    events = events.filter(e => e.animalId === filters.animalId);
  }

  if (filters.operatorName) {
    const name = filters.operatorName.toLowerCase();
    events = events.filter(e => e.operator?.name?.toLowerCase().includes(name));
  }

  if (filters.operatorRole) {
    events = events.filter(e => e.operator?.role === filters.operatorRole);
  }

  if (filters.fromDate) {
    const from = new Date(filters.fromDate).getTime();
    if (!isNaN(from)) {
      events = events.filter(e => new Date(e.timestamp).getTime() >= from);
    }
  }

  if (filters.toDate) {
    const to = new Date(filters.toDate).getTime();
    if (!isNaN(to)) {
      events = events.filter(e => new Date(e.timestamp).getTime() <= to);
    }
  }

  if (filters.animalRelated === true) {
    events = events.filter(e => ANIMAL_RELATED_EVENTS.includes(e.eventType));
  } else if (filters.animalRelated === false) {
    events = events.filter(e => !ANIMAL_RELATED_EVENTS.includes(e.eventType));
  }

  const sortOrder = filters.sort === "asc" ? 1 : -1;
  events.sort((a, b) => sortOrder * (new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()));

  const limit = Number(filters.limit) || 100;
  const offset = Number(filters.offset) || 0;

  return {
    total: events.length,
    limit,
    offset,
    events: events.slice(offset, offset + limit)
  };
}

export async function getEventById(id) {
  const ledger = await loadLedger();
  return ledger.events.find(e => e.id === id) || null;
}

export async function replayAnimalLifecycle(animalId, options = {}) {
  const ledger = await loadLedger();
  const events = ledger.events
    .filter(e => e.animalId === animalId && ANIMAL_RELATED_EVENTS.includes(e.eventType))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (events.length === 0) {
    return { found: false, animalId, events: [], snapshots: [] };
  }

  const snapshots = [];
  let currentSnapshot = null;

  for (const event of events) {
    if (event.snapshotAfter) {
      currentSnapshot = { ...event.snapshotAfter };
      snapshots.push({
        eventId: event.id,
        eventType: event.eventType,
        timestamp: event.timestamp,
        snapshot: currentSnapshot
      });
    }
  }

  const until = options.until ? new Date(options.until).getTime() : null;
  const filteredEvents = until
    ? events.filter(e => new Date(e.timestamp).getTime() <= until)
    : events;

  const finalSnapshot = until && snapshots.length > 0
    ? snapshots.filter(s => new Date(s.timestamp).getTime() <= until).pop()?.snapshot
    : (snapshots.length > 0 ? snapshots[snapshots.length - 1].snapshot : null);

  return {
    found: true,
    animalId,
    totalEvents: events.length,
    filteredEvents: filteredEvents.length,
    events: filteredEvents,
    snapshots: until ? snapshots.filter(s => new Date(s.timestamp).getTime() <= until) : snapshots,
    finalSnapshot
  };
}

export async function exportEventsByTimeRange(fromDate, toDate, options = {}) {
  const filters = {
    fromDate,
    toDate,
    sort: "asc",
    limit: 10000
  };

  if (options.eventTypes && Array.isArray(options.eventTypes)) {
    filters.eventType = options.eventTypes;
  }
  if (options.animalId) {
    filters.animalId = options.animalId;
  }
  if (options.animalRelated !== undefined) {
    filters.animalRelated = options.animalRelated;
  }

  const result = await queryEvents(filters);

  const format = options.format || "json";
  if (format === "csv") {
    const header = "event_id,event_type,animal_id,timestamp,operator,payload_summary";
    const rows = result.events.map(e => {
      const payloadStr = JSON.stringify(e.payload).replace(/"/g, '""');
      const operatorStr = e.operator ? `${e.operator.name}(${e.operator.role})` : "";
      return `${e.id},"${e.eventType}","${e.animalId || ""}","${e.timestamp}","${operatorStr}","${payloadStr.substring(0, 200)}"`;
    });
    return {
      format: "csv",
      total: result.total,
      fromDate,
      toDate,
      content: [header, ...rows].join("\n")
    };
  }

  return {
    format: "json",
    total: result.total,
    fromDate,
    toDate,
    events: result.events
  };
}

export async function verifyIntegrity() {
  const ledger = await loadLedger();
  const errors = [];

  if (ledger.checksumChain.length !== ledger.events.length) {
    errors.push({
      type: "chain_length_mismatch",
      expected: ledger.events.length,
      actual: ledger.checksumChain.length
    });
  }

  let previousChecksum = null;
  for (let i = 0; i < ledger.events.length; i++) {
    const event = ledger.events[i];

    if (event.previousChecksum !== previousChecksum) {
      errors.push({
        type: "previous_checksum_mismatch",
        eventId: event.id,
        index: i,
        expected: previousChecksum,
        actual: event.previousChecksum
      });
    }

    const computedChecksum = generateChecksum({
      id: event.id,
      eventType: event.eventType,
      animalId: event.animalId,
      timestamp: event.timestamp,
      payload: event.payload,
      snapshotAfter: event.snapshotAfter
    });

    if (event.checksum !== computedChecksum) {
      errors.push({
        type: "event_checksum_mismatch",
        eventId: event.id,
        index: i,
        expected: event.checksum,
        actual: computedChecksum
      });
    }

    if (ledger.checksumChain[i] !== event.checksum) {
      errors.push({
        type: "chain_checksum_mismatch",
        eventId: event.id,
        index: i,
        expected: ledger.checksumChain[i],
        actual: event.checksum
      });
    }

    previousChecksum = event.checksum;
  }

  return {
    valid: errors.length === 0,
    totalEvents: ledger.events.length,
    checked: ledger.events.length,
    errors,
    firstEvent: ledger.events[0] || null,
    lastEvent: ledger.events[ledger.events.length - 1] || null
  };
}

export async function verifySnapshotConsistency(db) {
  const ledger = await loadLedger();
  const errors = [];
  const animalIds = new Set();
  const removedAnimals = new Set();

  for (const event of ledger.events) {
    if (event.animalId && ANIMAL_RELATED_EVENTS.includes(event.eventType)) {
      animalIds.add(event.animalId);
      if (event.eventType === EVENT_TYPES.ANIMAL_REMOVED) {
        removedAnimals.add(event.animalId);
      }
    }
  }

  const checkedAnimals = new Set();

  for (const animalId of animalIds) {
    const animal = (db.animals || []).find(a => a.id === animalId);

    if (!animal) {
      if (removedAnimals.has(animalId)) {
        continue;
      }
      errors.push({
        type: "animal_missing_from_snapshot",
        animalId,
        message: `动物 ${animalId} 存在于事件日志但不存在于快照`
      });
      continue;
    }

    checkedAnimals.add(animalId);
    const expectedSnapshot = pickAnimalSnapshot(animal);
    const lifecycle = await replayAnimalLifecycle(animalId);

    if (lifecycle.snapshots.length > 0) {
      const lastEventSnapshot = lifecycle.snapshots[lifecycle.snapshots.length - 1].snapshot;

      const fieldsToCheck = ["status", "cageId", "keeper", "notesCount", "movesCount", "quarantineRecordsCount"];
      for (const field of fieldsToCheck) {
        if (JSON.stringify(lastEventSnapshot[field]) !== JSON.stringify(expectedSnapshot[field])) {
          errors.push({
            type: "snapshot_field_mismatch",
            animalId,
            field,
            expected: lastEventSnapshot[field],
            actual: expectedSnapshot[field],
            message: `动物 ${animalId} 的 ${field} 字段不匹配：事件日志=${lastEventSnapshot[field]}, 快照=${expectedSnapshot[field]}`
          });
        }
      }
    }
  }

  const snapshotAnimals = (db.animals || []).map(a => a.id);
  for (const animalId of snapshotAnimals) {
    if (!animalIds.has(animalId)) {
      errors.push({
        type: "animal_missing_from_ledger",
        animalId,
        message: `动物 ${animalId} 存在于快照但不存在于事件日志`
      });
    }
  }

  return {
    consistent: errors.length === 0,
    totalAnimalsInLedger: animalIds.size,
    totalAnimalsInSnapshot: snapshotAnimals.length,
    totalChecked: checkedAnimals.size,
    totalRemoved: removedAnimals.size,
    totalPassed: checkedAnimals.size - errors.length,
    totalFailed: errors.length,
    errors
  };
}

export async function markAsMigrated() {
  const ledger = await loadLedger();
  ledger.migratedFromSnapshot = true;
  await saveLedger(ledger);
  return ledger;
}

export async function ledgerExists() {
  return existsSync(ledgerPath);
}

export async function resetLedger() {
  const empty = { events: [], nextId: 1, migratedFromSnapshot: false, checksumChain: [] };
  await saveLedger(empty);
  return empty;
}

export function isAnimalRelatedEvent(eventType) {
  return ANIMAL_RELATED_EVENTS.includes(eventType);
}
