import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultLedgerPath = join(__dirname, "..", "data", "event-ledger.json");
const ledgerPath = process.env.EVENT_LEDGER_PATH || defaultLedgerPath;

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
  HEALTH_EVENT_CREATED: "health.event_created",
  HEALTH_EVENT_CLOSED: "health.event_closed",
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
  [EVENT_TYPES.HEALTH_EVENT_CREATED]: "健康事件创建",
  [EVENT_TYPES.HEALTH_EVENT_CLOSED]: "健康事件关闭",
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
  EVENT_TYPES.HEALTH_EVENT_CREATED,
  EVENT_TYPES.HEALTH_EVENT_CLOSED,
];

function generateChecksum(event) {
  const hasFacilityFields = "roomId" in event || "zoneId" in event || "projectId" in event;
  const checksumData = {
    id: event.id,
    eventType: event.eventType,
    animalId: event.animalId,
    timestamp: event.timestamp,
    payload: event.payload,
    snapshotAfter: event.snapshotAfter
  };
  if (hasFacilityFields) {
    checksumData.roomId = event.roomId;
    checksumData.zoneId = event.zoneId;
    checksumData.projectId = event.projectId;
  }
  const data = JSON.stringify(checksumData);
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
    roomId: animal.roomId || null,
    zoneId: animal.zoneId || null,
    projectId: animal.projectId || null,
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
    roomId: options.roomId || null,
    zoneId: options.zoneId || null,
    projectId: options.projectId || null,
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
      roomId: data.roomId || null,
      zoneId: data.zoneId || null,
      projectId: data.projectId || null,
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

  if (filters.roomId) {
    if (filters.includeNullFacility) {
      events = events.filter(e => !e.roomId || e.roomId === filters.roomId);
    } else {
      events = events.filter(e => e.roomId === filters.roomId);
    }
  }

  if (filters.zoneId) {
    if (filters.includeNullFacility) {
      events = events.filter(e => !e.zoneId || e.zoneId === filters.zoneId);
    } else {
      events = events.filter(e => e.zoneId === filters.zoneId);
    }
  }

  if (filters.projectId) {
    if (filters.includeNullFacility) {
      events = events.filter(e => !e.projectId || e.projectId === filters.projectId);
    } else {
      events = events.filter(e => e.projectId === filters.projectId);
    }
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
    return { found: false, animalId, events: [], snapshots: [], roomChanges: [] };
  }

  const snapshots = [];
  const roomChanges = [];
  let currentSnapshot = null;
  let lastRoomId = null;
  let lastCageId = null;
  let lastZoneId = null;

  for (const event of events) {
    if (event.snapshotAfter) {
      currentSnapshot = { ...event.snapshotAfter };
      snapshots.push({
        eventId: event.id,
        eventType: event.eventType,
        timestamp: event.timestamp,
        snapshot: currentSnapshot
      });

      const currentRoomId = event.roomId || currentSnapshot.roomId || null;
      const currentCageId = currentSnapshot.cageId || null;
      const currentZoneId = event.zoneId || currentSnapshot.zoneId || null;
      const currentProjectId = event.projectId || currentSnapshot.projectId || null;
      const roomChanged = currentRoomId && currentRoomId !== lastRoomId;
      const cageChanged = currentCageId && currentCageId !== lastCageId;

      if (roomChanged || cageChanged) {
        const isKeyNode = roomChanged && (
          event.eventType === EVENT_TYPES.ANIMAL_CREATED ||
          event.eventType === EVENT_TYPES.ANIMAL_MOVED ||
          event.eventType === EVENT_TYPES.ANIMAL_QUARANTINE_RELEASED ||
          event.eventType === EVENT_TYPES.BREEDING_LITTER_WEANED
        );
        roomChanges.push({
          eventId: event.id,
          eventType: event.eventType,
          timestamp: event.timestamp,
          fromRoomId: lastRoomId,
          toRoomId: currentRoomId,
          fromZoneId: lastZoneId,
          toZoneId: currentZoneId,
          fromCageId: lastCageId,
          toCageId: currentCageId,
          projectId: currentProjectId,
          reason: event.payload?.reason || eventTypeReason(event.eventType, event.payload),
          isKeyNode
        });
      }

      if (currentRoomId) lastRoomId = currentRoomId;
      if (currentCageId) lastCageId = currentCageId;
      if (currentZoneId) lastZoneId = currentZoneId;
    } else {
      const currentRoomId = event.roomId || null;
      const currentZoneId = event.zoneId || null;
      const currentProjectId = event.projectId || null;
      if (currentRoomId && currentRoomId !== lastRoomId) {
        const isKeyNode = (
          event.eventType === EVENT_TYPES.ANIMAL_CREATED ||
          event.eventType === EVENT_TYPES.ANIMAL_MOVED ||
          event.eventType === EVENT_TYPES.ANIMAL_QUARANTINE_RELEASED ||
          event.eventType === EVENT_TYPES.BREEDING_LITTER_WEANED
        );
        roomChanges.push({
          eventId: event.id,
          eventType: event.eventType,
          timestamp: event.timestamp,
          fromRoomId: lastRoomId,
          toRoomId: currentRoomId,
          fromZoneId: lastZoneId,
          toZoneId: currentZoneId,
          fromCageId: lastCageId,
          toCageId: event.payload?.toCage || event.payload?.cageId || null,
          projectId: currentProjectId,
          reason: event.payload?.reason || eventTypeReason(event.eventType, event.payload),
          isKeyNode
        });
        lastRoomId = currentRoomId;
        lastZoneId = currentZoneId;
      }
    }
  }

  const until = options.until ? new Date(options.until).getTime() : null;
  const filteredEvents = until
    ? events.filter(e => new Date(e.timestamp).getTime() <= until)
    : events;

  const finalSnapshot = until && snapshots.length > 0
    ? snapshots.filter(s => new Date(s.timestamp).getTime() <= until).pop()?.snapshot
    : (snapshots.length > 0 ? snapshots[snapshots.length - 1].snapshot : null);

  const filteredRoomChanges = until
    ? roomChanges.filter(r => new Date(r.timestamp).getTime() <= until)
    : roomChanges;

  return {
    found: true,
    animalId,
    totalEvents: events.length,
    filteredEvents: filteredEvents.length,
    events: filteredEvents,
    snapshots: until ? snapshots.filter(s => new Date(s.timestamp).getTime() <= until) : snapshots,
    roomChanges: filteredRoomChanges,
    finalSnapshot
  };
}

function eventTypeReason(eventType, payload) {
  switch (eventType) {
    case EVENT_TYPES.ANIMAL_CREATED:
      return "初始建档";
    case EVENT_TYPES.ANIMAL_MOVED:
      return payload?.reason || "移笼";
    case EVENT_TYPES.ANIMAL_QUARANTINE_RELEASED:
      return "检疫放行";
    case EVENT_TYPES.BREEDING_PAIR_CREATED:
      return "合笼配对";
    case EVENT_TYPES.BREEDING_LITTER_WEANED:
      return "断奶分笼";
    case EVENT_TYPES.HEALTH_EVENT_CREATED:
      return "健康事件";
    case EVENT_TYPES.HEALTH_EVENT_CLOSED:
      return "健康事件关闭";
    default:
      return null;
  }
}

function resolveFacilityFields(event) {
  return {
    roomId: event.roomId || event.snapshotAfter?.roomId || null,
    zoneId: event.zoneId || event.snapshotAfter?.zoneId || null,
    projectId: event.projectId || event.snapshotAfter?.projectId || null
  };
}

export async function replayRoomTimeline(roomId, options = {}) {
  const ledger = await loadLedger();
  let events = ledger.events.filter(e => resolveFacilityFields(e).roomId === roomId);

  if (options.animalRelated === true) {
    events = events.filter(e => ANIMAL_RELATED_EVENTS.includes(e.eventType));
  }

  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const until = options.until ? new Date(options.until).getTime() : null;
  const from = options.from ? new Date(options.from).getTime() : null;
  let filtered = events;
  if (from) filtered = filtered.filter(e => new Date(e.timestamp).getTime() >= from);
  if (until) filtered = filtered.filter(e => new Date(e.timestamp).getTime() <= until);

  const byType = {};
  for (const e of filtered) {
    byType[e.eventType] = (byType[e.eventType] || 0) + 1;
  }

  const uniqueAnimals = new Set(filtered.filter(e => e.animalId).map(e => e.animalId));

  const animalMovements = [];
  const seen = new Set();
  for (const e of filtered) {
    if (!e.animalId || seen.has(e.animalId)) continue;
    if (e.eventType === EVENT_TYPES.ANIMAL_CREATED || e.eventType === EVENT_TYPES.ANIMAL_MOVED || e.eventType === EVENT_TYPES.ANIMAL_QUARANTINE_RELEASED || e.eventType === EVENT_TYPES.BREEDING_LITTER_WEANED) {
      const fac = resolveFacilityFields(e);
      animalMovements.push({
        animalId: e.animalId,
        eventType: e.eventType,
        timestamp: e.timestamp,
        cageId: e.payload?.cageId || e.payload?.toCage || e.snapshotAfter?.cageId || null,
        zoneId: fac.zoneId,
        projectId: fac.projectId,
        reason: e.payload?.reason || eventTypeReason(e.eventType, e.payload)
      });
      seen.add(e.animalId);
    }
  }

  return {
    found: filtered.length > 0,
    roomId,
    totalEvents: events.length,
    filteredEvents: filtered.length,
    events: filtered,
    byType,
    uniqueAnimalCount: uniqueAnimals.size,
    uniqueAnimals: [...uniqueAnimals],
    animalMovements
  };
}

export async function replayProjectTimeline(projectId, options = {}) {
  const ledger = await loadLedger();
  let events = ledger.events.filter(e => resolveFacilityFields(e).projectId === projectId);

  if (options.animalRelated === true) {
    events = events.filter(e => ANIMAL_RELATED_EVENTS.includes(e.eventType));
  }

  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const until = options.until ? new Date(options.until).getTime() : null;
  const from = options.from ? new Date(options.from).getTime() : null;
  let filtered = events;
  if (from) filtered = filtered.filter(e => new Date(e.timestamp).getTime() >= from);
  if (until) filtered = filtered.filter(e => new Date(e.timestamp).getTime() <= until);

  const byType = {};
  for (const e of filtered) {
    byType[e.eventType] = (byType[e.eventType] || 0) + 1;
  }

  const uniqueAnimals = new Set(filtered.filter(e => e.animalId).map(e => e.animalId));
  const uniqueRooms = new Set(filtered.map(e => resolveFacilityFields(e).roomId).filter(Boolean));

  const roomActivity = {};
  for (const e of filtered) {
    const roomId = resolveFacilityFields(e).roomId;
    if (!roomId) continue;
    if (!roomActivity[roomId]) {
      roomActivity[roomId] = { eventCount: 0, animalIds: new Set() };
    }
    roomActivity[roomId].eventCount += 1;
    if (e.animalId) roomActivity[roomId].animalIds.add(e.animalId);
  }
  const roomActivitySummary = {};
  for (const [rid, data] of Object.entries(roomActivity)) {
    roomActivitySummary[rid] = { eventCount: data.eventCount, uniqueAnimalCount: data.animalIds.size };
  }

  return {
    found: filtered.length > 0,
    projectId,
    totalEvents: events.length,
    filteredEvents: filtered.length,
    events: filtered,
    byType,
    uniqueAnimalCount: uniqueAnimals.size,
    uniqueAnimals: [...uniqueAnimals],
    uniqueRoomCount: uniqueRooms.size,
    uniqueRooms: [...uniqueRooms],
    roomActivity: roomActivitySummary
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
  if (options.roomId) {
    filters.roomId = options.roomId;
  }
  if (options.zoneId) {
    filters.zoneId = options.zoneId;
  }
  if (options.projectId) {
    filters.projectId = options.projectId;
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
      roomId: event.roomId,
      zoneId: event.zoneId,
      projectId: event.projectId,
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

const REPLAY_EVENT_TYPES = [
  EVENT_TYPES.ANIMAL_CREATED,
  EVENT_TYPES.ANIMAL_BATCH_IMPORTED,
  EVENT_TYPES.ANIMAL_QUARANTINE_RECORD,
  EVENT_TYPES.ANIMAL_QUARANTINE_RELEASED,
  EVENT_TYPES.ANIMAL_QUARANTINE_ABNORMAL,
  EVENT_TYPES.ANIMAL_QUARANTINE_RESOLVED,
  EVENT_TYPES.ANIMAL_MOVED,
  EVENT_TYPES.ANIMAL_REMOVED,
  EVENT_TYPES.ANIMAL_NOTE_ADDED,
  EVENT_TYPES.FEEDING_RECORDED,
  EVENT_TYPES.BREEDING_PAIR_CREATED,
  EVENT_TYPES.BREEDING_LITTER_WEANED
];

function createEmptySnapshot() {
  return {
    animals: [],
    breedingPairs: [],
    breedingLitters: [],
    feedingRecords: [],
    _meta: {
      warnings: [],
      unreplayableEvents: [],
      processedEvents: 0,
      skippedEvents: 0
    }
  };
}

function addWarning(snapshot, type, entityId, message, eventId) {
  snapshot._meta.warnings.push({
    type,
    entityId,
    message,
    eventId
  });
}

function findAnimal(snapshot, animalId) {
  return snapshot.animals.find(a => a.id === animalId) || null;
}

function applyAnimalCreated(snapshot, event) {
  const { payload, snapshotAfter } = event;
  const animalId = event.animalId || payload.id;

  if (!animalId) {
    addWarning(snapshot, "animal_create_missing_id", null, "动物创建事件缺少动物ID", event.id);
    return;
  }

  if (findAnimal(snapshot, animalId)) {
    addWarning(snapshot, "animal_already_exists", animalId, "动物已存在，跳过创建", event.id);
    return;
  }

  if (snapshotAfter) {
    snapshot.animals.push({ ...snapshotAfter });
  } else if (payload) {
    const animal = {
      id: animalId,
      strain: payload.strain || null,
      cageId: payload.cageId || null,
      roomId: event.roomId || null,
      zoneId: event.zoneId || null,
      projectId: event.projectId || null,
      sex: payload.sex || null,
      birthDate: payload.birthDate || null,
      project: payload.project || null,
      keeper: payload.keeper || null,
      status: payload.initialStatus || "quarantine",
      enteredQuarantineAt: null,
      quarantineReleasedAt: null,
      removedAt: null,
      fatherId: payload.fatherId || null,
      motherId: payload.motherId || null,
      litterId: payload.litterId || null,
      weanedAt: payload.weanedAt || null,
      notesCount: 0,
      movesCount: 0,
      quarantineRecordsCount: 0
    };
    if (animal.status === "quarantine" || animal.status === "quarantine_abnormal") {
      animal.enteredQuarantineAt = event.timestamp;
    }
    snapshot.animals.push(animal);
  } else {
    addWarning(snapshot, "animal_create_no_data", animalId, "动物创建事件没有足够的数据重建", event.id);
  }
}

function applyQuarantineRecord(snapshot, event) {
  const animal = findAnimal(snapshot, event.animalId);
  if (!animal) {
    addWarning(snapshot, "animal_not_found", event.animalId, "检疫记录对应动物不存在", event.id);
    return;
  }

  if (event.snapshotAfter) {
    Object.assign(animal, event.snapshotAfter);
  } else {
    animal.quarantineRecordsCount = (animal.quarantineRecordsCount || 0) + 1;
    if (!animal.enteredQuarantineAt) {
      animal.enteredQuarantineAt = event.timestamp;
    }
    if (animal.status !== "quarantine" && animal.status !== "quarantine_abnormal" && !animal.removedAt) {
      animal.status = "quarantine";
    }
  }
}

function applyQuarantineReleased(snapshot, event) {
  const animal = findAnimal(snapshot, event.animalId);
  if (!animal) {
    addWarning(snapshot, "animal_not_found", event.animalId, "检疫放行对应动物不存在", event.id);
    return;
  }

  if (event.snapshotAfter) {
    Object.assign(animal, event.snapshotAfter);
  } else {
    animal.status = "released";
    animal.quarantineReleasedAt = event.timestamp;
  }
}

function applyQuarantineAbnormal(snapshot, event) {
  const animal = findAnimal(snapshot, event.animalId);
  if (!animal) {
    addWarning(snapshot, "animal_not_found", event.animalId, "检疫异常对应动物不存在", event.id);
    return;
  }

  if (event.snapshotAfter) {
    Object.assign(animal, event.snapshotAfter);
  } else {
    animal.status = "quarantine_abnormal";
  }
}

function applyQuarantineResolved(snapshot, event) {
  const animal = findAnimal(snapshot, event.animalId);
  if (!animal) {
    addWarning(snapshot, "animal_not_found", event.animalId, "检疫异常解除对应动物不存在", event.id);
    return;
  }

  if (event.snapshotAfter) {
    Object.assign(animal, event.snapshotAfter);
  } else {
    animal.status = "quarantine";
  }
}

function applyAnimalMoved(snapshot, event) {
  const animal = findAnimal(snapshot, event.animalId);
  if (!animal) {
    addWarning(snapshot, "animal_not_found", event.animalId, "移笼事件对应动物不存在", event.id);
    return;
  }

  if (event.snapshotAfter) {
    Object.assign(animal, event.snapshotAfter);
  } else {
    const { payload } = event;
    if (payload?.toCage) {
      animal.cageId = payload.toCage;
    }
    if (payload?.toRoomId) {
      animal.roomId = payload.toRoomId;
    } else if (event.roomId) {
      animal.roomId = event.roomId;
    }
    if (event.zoneId) {
      animal.zoneId = event.zoneId;
    }
    animal.movesCount = (animal.movesCount || 0) + 1;
  }
}

function applyAnimalRemoved(snapshot, event) {
  const animal = findAnimal(snapshot, event.animalId);
  if (!animal) {
    addWarning(snapshot, "animal_not_found", event.animalId, "移出事件对应动物不存在", event.id);
    return;
  }

  if (event.snapshotAfter) {
    Object.assign(animal, event.snapshotAfter);
  } else {
    animal.status = "removed";
    animal.removedAt = event.timestamp;
  }
}

function applyNoteAdded(snapshot, event) {
  const animal = findAnimal(snapshot, event.animalId);
  if (!animal) {
    addWarning(snapshot, "animal_not_found", event.animalId, "饲养记录对应动物不存在", event.id);
    return;
  }

  if (event.snapshotAfter) {
    Object.assign(animal, event.snapshotAfter);
  } else {
    animal.notesCount = (animal.notesCount || 0) + 1;
  }
}

function applyFeedingRecorded(snapshot, event) {
  const { payload } = event;
  if (!payload?.recordId) {
    addWarning(snapshot, "feeding_record_missing_id", event.animalId, "饲喂记录缺少recordId", event.id);
    return;
  }

  const record = {
    id: payload.recordId,
    planId: payload.planId || null,
    targetType: event.animalId ? "animal" : (payload.targetType || "animal"),
    targetId: event.animalId || payload.targetId || null,
    date: payload.date || event.timestamp.slice(0, 10),
    scheduledTime: payload.scheduledTime || null,
    actualTime: payload.actualTime || event.timestamp,
    feedType: payload.feedType || null,
    amount: payload.amount || 0,
    keeper: payload.keeper || event.operator?.name || null,
    status: payload.status || "completed",
    notes: payload.notes || "",
    roomId: event.roomId || payload.roomId || null,
    zoneId: event.zoneId || null,
    project: payload.project || null,
    projectId: event.projectId || null
  };

  snapshot.feedingRecords.push(record);
}

function applyBreedingPairCreated(snapshot, event) {
  const { payload } = event;
  if (!payload?.pairId) {
    addWarning(snapshot, "breeding_pair_missing_id", event.animalId, "繁育配对事件缺少pairId", event.id);
    return;
  }

  let pair = snapshot.breedingPairs.find(p => p.id === payload.pairId);
  if (!pair) {
    pair = {
      id: payload.pairId,
      cageId: payload.cageId || null,
      roomId: event.roomId || null,
      zoneId: event.zoneId || null,
      projectId: event.projectId || null,
      project: payload.project || null,
      maleId: null,
      femaleId: null,
      pairDate: payload.pairDate || event.timestamp.slice(0, 10),
      expectedDeliveryDate: payload.expectedDeliveryDate || null,
      status: payload.status || "pending",
      strain: payload.strain || null,
      keeper: payload.keeper || event.operator?.name || null,
      notes: payload.notes || "",
      createdAt: event.timestamp,
      sourceEvents: []
    };
    snapshot.breedingPairs.push(pair);
  }

  pair.sourceEvents.push(event.id);

  if (payload.role === "male") {
    pair.maleId = event.animalId;
  } else if (payload.role === "female") {
    pair.femaleId = event.animalId;
  }

  if (!pair.cageId && payload.cageId) {
    pair.cageId = payload.cageId;
  }
  if (!pair.strain && payload.strain) {
    pair.strain = payload.strain;
  }
}

function applyBreedingLitterWeaned(snapshot, event) {
  const { payload, snapshotAfter } = event;

  if (snapshotAfter && event.animalId) {
    const existingAnimal = findAnimal(snapshot, event.animalId);
    if (!existingAnimal) {
      snapshot.animals.push({ ...snapshotAfter });
    } else {
      Object.assign(existingAnimal, snapshotAfter);
    }
  }

  if (payload?.litterId) {
    let litter = snapshot.breedingLitters.find(l => l.id === payload.litterId);
    if (!litter) {
      litter = {
        id: payload.litterId,
        pairId: payload.pairId || null,
        roomId: event.roomId || null,
        zoneId: event.zoneId || null,
        projectId: event.projectId || null,
        project: payload.project || null,
        birthDate: payload.birthDate || (snapshotAfter?.birthDate || null),
        totalPups: 0,
        malePups: 0,
        femalePups: 0,
        unknownSexPups: 0,
        status: "weaned",
        cageId: payload.cageId || (snapshotAfter?.cageId || null),
        keeper: payload.keeper || event.operator?.name || null,
        notes: payload.notes || "",
        weanDate: payload.weanDate || event.timestamp.slice(0, 10),
        weanedCount: 0,
        offspringIds: [],
        sourceEvents: []
      };
      snapshot.breedingLitters.push(litter);
    }

    litter.sourceEvents.push(event.id);

    if (event.animalId && !litter.offspringIds.includes(event.animalId)) {
      litter.offspringIds.push(event.animalId);
      litter.weanedCount = litter.offspringIds.length;
      litter.totalPups = Math.max(litter.totalPups, litter.weanedCount);

      const animal = findAnimal(snapshot, event.animalId);
      if (animal?.sex === "male") {
        litter.malePups += 1;
      } else if (animal?.sex === "female") {
        litter.femalePups += 1;
      } else {
        litter.unknownSexPups += 1;
      }
    }

    if (!litter.pairId) {
      if (payload.fatherId && payload.motherId) {
        const pair = snapshot.breedingPairs.find(
          p => p.maleId === payload.fatherId && p.femaleId === payload.motherId
        );
        if (pair) {
          litter.pairId = pair.id;
        }
      }
    }

    if (!litter.birthDate && snapshotAfter?.birthDate) {
      litter.birthDate = snapshotAfter.birthDate;
    }

    if (!litter.fatherId && payload.fatherId) {
      litter.fatherId = payload.fatherId;
    }
    if (!litter.motherId && payload.motherId) {
      litter.motherId = payload.motherId;
    }
  }
}

export async function rebuildSnapshotFromLedger(options = {}) {
  const ledger = await loadLedger();
  const snapshot = createEmptySnapshot();

  let events = [...ledger.events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  if (options.until) {
    const untilTime = new Date(options.until).getTime();
    events = events.filter(e => new Date(e.timestamp).getTime() <= untilTime);
  }

  if (options.from) {
    const fromTime = new Date(options.from).getTime();
    events = events.filter(e => new Date(e.timestamp).getTime() >= fromTime);
  }

  const replayableEvents = events.filter(e => REPLAY_EVENT_TYPES.includes(e.eventType));
  snapshot._meta.skippedEvents = events.length - replayableEvents.length;

  const pairEventTracker = new Map();

  for (const event of replayableEvents) {
    snapshot._meta.processedEvents += 1;

    try {
      switch (event.eventType) {
        case EVENT_TYPES.ANIMAL_CREATED:
        case EVENT_TYPES.ANIMAL_BATCH_IMPORTED:
          applyAnimalCreated(snapshot, event);
          break;
        case EVENT_TYPES.ANIMAL_QUARANTINE_RECORD:
          applyQuarantineRecord(snapshot, event);
          break;
        case EVENT_TYPES.ANIMAL_QUARANTINE_RELEASED:
          applyQuarantineReleased(snapshot, event);
          break;
        case EVENT_TYPES.ANIMAL_QUARANTINE_ABNORMAL:
          applyQuarantineAbnormal(snapshot, event);
          break;
        case EVENT_TYPES.ANIMAL_QUARANTINE_RESOLVED:
          applyQuarantineResolved(snapshot, event);
          break;
        case EVENT_TYPES.ANIMAL_MOVED:
          applyAnimalMoved(snapshot, event);
          break;
        case EVENT_TYPES.ANIMAL_REMOVED:
          applyAnimalRemoved(snapshot, event);
          break;
        case EVENT_TYPES.ANIMAL_NOTE_ADDED:
          applyNoteAdded(snapshot, event);
          break;
        case EVENT_TYPES.FEEDING_RECORDED:
          applyFeedingRecorded(snapshot, event);
          break;
        case EVENT_TYPES.BREEDING_PAIR_CREATED:
          applyBreedingPairCreated(snapshot, event);
          break;
        case EVENT_TYPES.BREEDING_LITTER_WEANED:
          applyBreedingLitterWeaned(snapshot, event);
          break;
        default:
          snapshot._meta.unreplayableEvents.push({
            eventId: event.id,
            eventType: event.eventType,
            reason: "unsupported_event_type"
          });
      }
    } catch (error) {
      snapshot._meta.unreplayableEvents.push({
        eventId: event.id,
        eventType: event.eventType,
        reason: "processing_error",
        error: error.message
      });
    }
  }

  for (const pair of snapshot.breedingPairs) {
    delete pair.sourceEvents;
  }
  for (const litter of snapshot.breedingLitters) {
    delete litter.sourceEvents;
    if (!litter.fatherId) delete litter.fatherId;
    if (!litter.motherId) delete litter.motherId;
  }

  snapshot.animals.sort((a, b) => a.id.localeCompare(b.id));
  snapshot.breedingPairs.sort((a, b) => a.id.localeCompare(b.id));
  snapshot.breedingLitters.sort((a, b) => a.id.localeCompare(b.id));
  snapshot.feedingRecords.sort((a, b) => a.id.localeCompare(b.id));

  return {
    snapshot: {
      animals: snapshot.animals,
      breedingPairs: snapshot.breedingPairs,
      breedingLitters: snapshot.breedingLitters,
      feedingRecords: snapshot.feedingRecords
    },
    meta: {
      totalEvents: ledger.events.length,
      processedEvents: snapshot._meta.processedEvents,
      skippedEvents: snapshot._meta.skippedEvents,
      unreplayableEvents: snapshot._meta.unreplayableEvents,
      warnings: snapshot._meta.warnings,
      warningCount: snapshot._meta.warnings.length,
      animalCount: snapshot.animals.length,
      breedingPairCount: snapshot.breedingPairs.length,
      breedingLitterCount: snapshot.breedingLitters.length,
      feedingRecordCount: snapshot.feedingRecords.length
    }
  };
}

function deepCompare(obj1, obj2) {
  return JSON.stringify(obj1) === JSON.stringify(obj2);
}

function diffArrays(currentArray, rebuiltArray, idField, entityName) {
  const currentMap = new Map(currentArray.map(item => [item[idField], item]));
  const rebuiltMap = new Map(rebuiltArray.map(item => [item[idField], item]));

  const added = [];
  const removed = [];
  const modified = [];
  const unchanged = [];

  for (const [id, rebuiltItem] of rebuiltMap) {
    if (!currentMap.has(id)) {
      added.push({ id, entity: entityName, item: rebuiltItem });
    } else {
      const currentItem = currentMap.get(id);
      const fieldDiffs = diffObjects(currentItem, rebuiltItem);
      if (fieldDiffs.length > 0) {
        modified.push({ id, entity: entityName, fields: fieldDiffs });
      } else {
        unchanged.push(id);
      }
    }
  }

  for (const [id, currentItem] of currentMap) {
    if (!rebuiltMap.has(id)) {
      removed.push({ id, entity: entityName, item: currentItem });
    }
  }

  return { added, removed, modified, unchanged, unchangedCount: unchanged.length };
}

function diffObjects(obj1, obj2) {
  const allKeys = new Set([...Object.keys(obj1 || {}), ...Object.keys(obj2 || {})]);
  const differences = [];

  const skipKeys = ["sourceEvents", "observationNodes", "notes", "moves", "quarantineRecords", "quarantineApproval", "breedingInfo"];

  for (const key of allKeys) {
    if (skipKeys.includes(key)) continue;

    const v1 = obj1?.[key];
    const v2 = obj2?.[key];

    if (!deepCompare(v1, v2)) {
      differences.push({
        field: key,
        current: v1,
        rebuilt: v2
      });
    }
  }

  return differences;
}

export async function compareSnapshotWithCurrent(db, options = {}) {
  const rebuiltResult = await rebuildSnapshotFromLedger(options);
  const rebuilt = rebuiltResult.snapshot;

  const animalDiff = diffArrays(
    db.animals || [],
    rebuilt.animals,
    "id",
    "animal"
  );

  const breedingPairDiff = diffArrays(
    db.breedingPairs || [],
    rebuilt.breedingPairs,
    "id",
    "breedingPair"
  );

  const breedingLitterDiff = diffArrays(
    db.breedingLitters || [],
    rebuilt.breedingLitters,
    "id",
    "breedingLitter"
  );

  const feedingRecordDiff = diffArrays(
    db.feedingRecords || [],
    rebuilt.feedingRecords,
    "id",
    "feedingRecord"
  );

  const totalDifferences =
    animalDiff.added.length + animalDiff.removed.length + animalDiff.modified.length +
    breedingPairDiff.added.length + breedingPairDiff.removed.length + breedingPairDiff.modified.length +
    breedingLitterDiff.added.length + breedingLitterDiff.removed.length + breedingLitterDiff.modified.length +
    feedingRecordDiff.added.length + feedingRecordDiff.removed.length + feedingRecordDiff.modified.length;

  return {
    consistent: totalDifferences === 0 && rebuiltResult.meta.warningCount === 0,
    totalDifferences,
    totalWarnings: rebuiltResult.meta.warningCount,
    summary: {
      animals: {
        current: (db.animals || []).length,
        rebuilt: rebuilt.animals.length,
        added: animalDiff.added.length,
        removed: animalDiff.removed.length,
        modified: animalDiff.modified.length,
        unchanged: animalDiff.unchangedCount
      },
      breedingPairs: {
        current: (db.breedingPairs || []).length,
        rebuilt: rebuilt.breedingPairs.length,
        added: breedingPairDiff.added.length,
        removed: breedingPairDiff.removed.length,
        modified: breedingPairDiff.modified.length,
        unchanged: breedingPairDiff.unchangedCount
      },
      breedingLitters: {
        current: (db.breedingLitters || []).length,
        rebuilt: rebuilt.breedingLitters.length,
        added: breedingLitterDiff.added.length,
        removed: breedingLitterDiff.removed.length,
        modified: breedingLitterDiff.modified.length,
        unchanged: breedingLitterDiff.unchangedCount
      },
      feedingRecords: {
        current: (db.feedingRecords || []).length,
        rebuilt: rebuilt.feedingRecords.length,
        added: feedingRecordDiff.added.length,
        removed: feedingRecordDiff.removed.length,
        modified: feedingRecordDiff.modified.length,
        unchanged: feedingRecordDiff.unchangedCount
      }
    },
    details: {
      animals: {
        added: animalDiff.added,
        removed: animalDiff.removed,
        modified: animalDiff.modified
      },
      breedingPairs: {
        added: breedingPairDiff.added,
        removed: breedingPairDiff.removed,
        modified: breedingPairDiff.modified
      },
      breedingLitters: {
        added: breedingLitterDiff.added,
        removed: breedingLitterDiff.removed,
        modified: breedingLitterDiff.modified
      },
      feedingRecords: {
        added: feedingRecordDiff.added,
        removed: feedingRecordDiff.removed,
        modified: feedingRecordDiff.modified
      }
    },
    warnings: rebuiltResult.meta.warnings,
    unreplayableEvents: rebuiltResult.meta.unreplayableEvents,
    rebuiltMeta: {
      processedEvents: rebuiltResult.meta.processedEvents,
      skippedEvents: rebuiltResult.meta.skippedEvents,
      totalEvents: rebuiltResult.meta.totalEvents
    }
  };
}
