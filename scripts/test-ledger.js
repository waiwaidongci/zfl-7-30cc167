import { readFile, unlink, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "lab.json");
const ledgerPath = join(__dirname, "..", "data", "event-ledger.json");
const dbBackupPath = join(__dirname, "..", "data", "lab.json.test-backup");
const ledgerBackupPath = join(__dirname, "..", "data", "event-ledger.json.test-backup");

import {
  EVENT_TYPES,
  recordEvent,
  getLedgerInfo,
  queryEvents,
  getEventById,
  replayAnimalLifecycle,
  exportEventsByTimeRange,
  verifyIntegrity,
  verifySnapshotConsistency,
  resetLedger,
  ledgerExists
} from "../lib/eventLedger.js";

import { migrateFromSnapshot } from "./migrate-events.js";

import {
  addAnimal,
  addNote,
  moveAnimal,
  removeAnimal,
  addQuarantineRecord,
  releaseAnimal,
  markQuarantineAbnormal,
  resolveQuarantineAbnormal,
  getAnimal,
  batchAddAnimals
} from "../lib/animalData.js";

import { addFeedingRecord } from "../lib/feedingData.js";

import { saveDb } from "../lib/helpers.js";

let testDbBackup = null;
let testLedgerBackup = null;

async function loadDb() {
  return JSON.parse(await readFile(dbPath, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runTest(name, testFn) {
  console.log(`\n=== ${name} ===`);
  try {
    await testFn();
    console.log(`✅ ${name} - PASSED`);
    return true;
  } catch (error) {
    console.log(`❌ ${name} - FAILED: ${error.message}`);
    console.error(error.stack);
    return false;
  }
}

async function backupData() {
  testDbBackup = JSON.parse(await readFile(dbPath, "utf8"));
  if (existsSync(ledgerPath)) {
    testLedgerBackup = JSON.parse(await readFile(ledgerPath, "utf8"));
  }
  if (existsSync(dbPath)) {
    await copyFile(dbPath, dbBackupPath);
  }
  if (existsSync(ledgerPath)) {
    await copyFile(ledgerPath, ledgerBackupPath);
  }
}

async function restoreData() {
  if (existsSync(dbBackupPath)) {
    await copyFile(dbBackupPath, dbPath);
    await unlink(dbBackupPath);
  }
  if (existsSync(ledgerBackupPath)) {
    await copyFile(ledgerBackupPath, ledgerPath);
    await unlink(ledgerBackupPath);
  } else if (existsSync(ledgerPath)) {
    await unlink(ledgerPath);
  }
}

async function cleanupTestFiles() {
  if (existsSync(dbBackupPath)) {
    try { await unlink(dbBackupPath); } catch (e) {}
  }
  if (existsSync(ledgerBackupPath)) {
    try { await unlink(ledgerBackupPath); } catch (e) {}
  }
}

const tests = [];

tests.push({
  name: "1. Ledger migration from snapshot",
  fn: async () => {
    if (existsSync(ledgerPath)) {
      await unlink(ledgerPath);
    }
    const db = await loadDb();
    const animals = db.animals || [];

    const result = await migrateFromSnapshot({
      operator: { role: "system", name: "test", key: "test" }
    });

    assert(result.migrated === true, "Migration should complete successfully");
    assert(result.totalAnimals === animals.length, `Should migrate ${animals.length} animals`);
    assert(result.totalEvents > 0, "Should generate events");

    const info = await getLedgerInfo();
    assert(info.totalEvents === result.totalEvents + 2, "Info should match migrated count + init/migrated events");
    assert(info.migratedFromSnapshot === true, "Should be marked as migrated");
    assert(info.uniqueAnimals === animals.length, "Should have all animals in ledger");
  }
});

tests.push({
  name: "2. Event recording - animal created",
  fn: async () => {
    const db = await loadDb();
    const operator = { role: "keeper", name: "测试员", key: "test-key" };

    const animal = await addAnimal(db, {
      strain: "C57BL/6J",
      cageId: "A-01",
      sex: "male",
      birthDate: "2026-01-01",
      project: "测试项目",
      keeper: "测试员"
    }, { operator, skipEvent: true });

    await saveDb(db);

    await recordEvent(EVENT_TYPES.ANIMAL_CREATED, {
      id: animal.id,
      strain: animal.strain,
      cageId: animal.cageId
    }, {
      animalId: animal.id,
      operator,
      snapshotAfter: animal
    });

    const info = await getLedgerInfo();
    const animalEvents = await queryEvents({ animalId: animal.id });
    assert(animalEvents.total === 1, "Should have 1 event for the animal");
    assert(animalEvents.events[0].eventType === EVENT_TYPES.ANIMAL_CREATED, "Event type should match");
    assert(animalEvents.events[0].operator.name === "测试员", "Operator should be recorded");
    assert(animalEvents.events[0].snapshotAfter !== null, "Snapshot should be recorded");
    assert(animalEvents.events[0].checksum !== null, "Checksum should be present");

    await removeAnimal(db, animal.id, "测试清理", { operator });
    await saveDb(db);
  }
});

tests.push({
  name: "3. Full lifecycle event recording",
  fn: async () => {
    const db = await loadDb();
    const operator = { role: "keeper", name: "测试员", key: "test-key" };

    const preInfo = await getLedgerInfo();

    const animal = await addAnimal(db, {
      strain: "BALB/c",
      cageId: "C-01",
      sex: "female",
      birthDate: "2026-02-01",
      project: "生命周期测试",
      keeper: "测试员"
    }, { operator });

    await saveDb(db);

    let events = await queryEvents({ animalId: animal.id, sort: "asc" });
    assert(events.total === 1, "Should have 1 event after creation");

    await addNote(db, animal.id, {
      date: "2026-06-14",
      weight: 20.5,
      condition: "正常"
    }, { operator });

    await saveDb(db);

    events = await queryEvents({ animalId: animal.id, sort: "asc" });
    assert(events.total === 2, "Should have 2 events after adding note");
    assert(events.events[events.events.length - 1].eventType === EVENT_TYPES.ANIMAL_NOTE_ADDED, "Latest event should be note added");

    await moveAnimal(db, animal.id, "A-01", "测试移笼", { operator });
    await saveDb(db);

    events = await queryEvents({ animalId: animal.id, sort: "asc" });
    assert(events.total === 3, "Should have 3 events after move");
    assert(events.events[events.events.length - 1].eventType === EVENT_TYPES.ANIMAL_MOVED, "Latest event should be move");
    assert(events.events[events.events.length - 1].payload.toCage === "A-01", "Move target should be recorded");

    await addQuarantineRecord(db, animal.id, {
      date: "2026-06-15",
      temperature: 37.0,
      weight: 20.3,
      condition: "良好",
      symptoms: [],
      isAbnormal: false,
      notes: "日常检疫"
    }, { operator });
    await saveDb(db);

    events = await queryEvents({ animalId: animal.id, sort: "asc" });
    assert(events.total === 4, "Should have 4 events after quarantine record");

    await releaseAnimal(db, animal.id, {
      approver: "测试员",
      targetCageId: "A-02",
      notes: "检疫合格"
    }, { operator });
    await saveDb(db);

    events = await queryEvents({ animalId: animal.id, sort: "asc" });
    assert(events.total === 5, "Should have 5 events after release");
    assert(events.events[events.events.length - 1].eventType === EVENT_TYPES.ANIMAL_QUARANTINE_RELEASED, "Latest event should be release");

    const updatedAnimal = getAnimal(db, animal.id);
    assert(updatedAnimal.status === "released", "Animal status should be released");
    assert(updatedAnimal.cageId === "A-02", "Animal cage should be updated");

    await addFeedingRecord(db, {
      targetType: "animal",
      targetId: animal.id,
      feedType: "标准饲料",
      amount: 5.0,
      keeper: "测试员",
      condition: "食欲良好"
    }, { operator });
    await saveDb(db);

    events = await queryEvents({ animalId: animal.id, sort: "asc" });
    assert(events.total === 6, "Should have 6 events after feeding record");

    await removeAnimal(db, animal.id, "测试移出", { operator });
    await saveDb(db);

    events = await queryEvents({ animalId: animal.id, sort: "asc" });
    assert(events.total === 7, "Should have 7 events after removal");
    assert(events.events[events.events.length - 1].eventType === EVENT_TYPES.ANIMAL_REMOVED, "Latest event should be removed");

    const postInfo = await getLedgerInfo();
    assert(postInfo.totalEvents === preInfo.totalEvents + 7, "Should have 7 new events in total");
  }
});

tests.push({
  name: "4. Lifecycle replay",
  fn: async () => {
    const db = await loadDb();
    const testAnimalId = (db.animals && db.animals.length > 0) ? db.animals[0].id : null;
    if (!testAnimalId) {
      console.log("  ⚠️  Skipping: No animals in snapshot");
      return;
    }

    const lifecycle = await replayAnimalLifecycle(testAnimalId);
    assert(lifecycle.found === true, `Should find lifecycle for ${testAnimalId}`);
    assert(lifecycle.totalEvents > 0, "Should have events in lifecycle");
    assert(lifecycle.snapshots.length > 0, "Should have snapshots in lifecycle");
    assert(lifecycle.finalSnapshot !== null, "Should have final snapshot");
    assert(lifecycle.finalSnapshot.id === testAnimalId, "Final snapshot should match animal ID");

    const animal = getAnimal(db, testAnimalId);
    assert(lifecycle.finalSnapshot.status === animal.status, "Final snapshot status should match");
    assert(lifecycle.finalSnapshot.cageId === animal.cageId, "Final snapshot cageId should match");

    const untilDate = "2026-05-01T00:00:00.000Z";
    const historicalLifecycle = await replayAnimalLifecycle(testAnimalId, { until: untilDate });
    assert(historicalLifecycle.filteredEvents <= lifecycle.totalEvents, "Filtered events should be <= total");
  }
});

tests.push({
  name: "5. Event query and filtering",
  fn: async () => {
    const info = await getLedgerInfo();

    const allEvents = await queryEvents({ limit: 10 });
    assert(allEvents.total > 0, "Should have events");
    assert(allEvents.limit === 10, "Limit should be respected");

    const filteredByType = await queryEvents({ eventType: EVENT_TYPES.ANIMAL_CREATED, limit: 100 });
    assert(filteredByType.events.every(e => e.eventType === EVENT_TYPES.ANIMAL_CREATED), "All events should be created type");

    const animalRelated = await queryEvents({ animalRelated: true, limit: 100 });
    assert(animalRelated.events.every(e => e.animalId !== null), "All animal related events should have animalId");

    const fromDate = "2026-01-01T00:00:00.000Z";
    const toDate = "2026-12-31T23:59:59.999Z";
    const dateFiltered = await queryEvents({ fromDate, toDate, limit: 100 });
    assert(dateFiltered.events.every(e => e.timestamp >= fromDate && e.timestamp <= toDate), "All events should be in date range");

    const ascSorted = await queryEvents({ sort: "asc", limit: 10 });
    const timestamps = ascSorted.events.map(e => e.timestamp);
    const sortedTimestamps = [...timestamps].sort();
    assert(JSON.stringify(timestamps) === JSON.stringify(sortedTimestamps), "Events should be sorted ascending");

    const eventId = ascSorted.events[0].id;
    const eventById = await getEventById(eventId);
    assert(eventById !== null, "Should find event by ID");
    assert(eventById.id === eventId, "Event ID should match");
  }
});

tests.push({
  name: "6. Time range export",
  fn: async () => {
    const fromDate = "2026-01-01T00:00:00.000Z";
    const toDate = "2026-12-31T23:59:59.999Z";

    const jsonExport = await exportEventsByTimeRange(fromDate, toDate, { format: "json" });
    assert(jsonExport.format === "json", "Format should be json");
    assert(jsonExport.total > 0, "Should have events in export");
    assert(jsonExport.events.length > 0, "Events array should not be empty");

    const csvExport = await exportEventsByTimeRange(fromDate, toDate, { format: "csv" });
    assert(csvExport.format === "csv", "Format should be csv");
    assert(csvExport.content.startsWith("event_id,event_type,"), "CSV should have header");
    assert(csvExport.content.includes("\n"), "CSV should have multiple lines");

    const eventTypes = [EVENT_TYPES.ANIMAL_CREATED, EVENT_TYPES.ANIMAL_MOVED];
    const filteredExport = await exportEventsByTimeRange(fromDate, toDate, { eventTypes });
    assert(filteredExport.events.every(e => eventTypes.includes(e.eventType)), "Export should be filtered by event types");

    const db = await loadDb();
    const testAnimalId = (db.animals && db.animals.length > 0) ? db.animals[0].id : null;
    if (testAnimalId) {
      const animalExport = await exportEventsByTimeRange(fromDate, toDate, { animalId: testAnimalId });
      assert(animalExport.events.every(e => e.animalId === testAnimalId), "Export should be filtered by animalId");
    }
  }
});

tests.push({
  name: "7. Integrity verification",
  fn: async () => {
    const integrity = await verifyIntegrity();
    assert(integrity.valid === true, "Integrity should be valid");
    assert(integrity.errors.length === 0, "Should have no errors");
    assert(integrity.totalEvents === integrity.checked, "All events should be checked");
    assert(integrity.firstEvent !== null, "Should have first event");
    assert(integrity.lastEvent !== null, "Should have last event");
  }
});

tests.push({
  name: "8. Snapshot consistency verification",
  fn: async () => {
    const db = await loadDb();
    const consistency = await verifySnapshotConsistency(db);
    assert(consistency.totalAnimalsInLedger > 0, "Should have animals in ledger");
    assert(consistency.totalAnimalsInSnapshot > 0, "Should have animals in snapshot");
    assert(consistency.errors.length === 0, `Should have no consistency errors: ${JSON.stringify(consistency.errors, null, 2)}`);
    assert(consistency.consistent === true, "Consistency check should pass");
  }
});

tests.push({
  name: "9. Quarantine abnormal lifecycle",
  fn: async () => {
    const db = await loadDb();
    const operator = { role: "keeper", name: "测试员", key: "test-key" };

    const animal = await addAnimal(db, {
      strain: "C57BL/6J",
      cageId: "C-01",
      sex: "male",
      birthDate: "2026-03-01",
      project: "检疫异常测试",
      keeper: "测试员",
      status: "quarantine"
    }, { operator });
    await saveDb(db);

    await markQuarantineAbnormal(db, animal.id, {
      reason: "发热",
      handler: "测试员",
      notes: "体温38.5℃"
    }, { operator });
    await saveDb(db);

    let events = await queryEvents({ animalId: animal.id, sort: "asc" });
    assert(events.events[events.events.length - 1].eventType === EVENT_TYPES.ANIMAL_QUARANTINE_ABNORMAL, "Should have abnormal event");

    await resolveQuarantineAbnormal(db, animal.id, {
      resolution: "已恢复正常",
      resolver: "测试员"
    }, { operator });
    await saveDb(db);

    events = await queryEvents({ animalId: animal.id, sort: "asc" });
    assert(events.events[events.events.length - 1].eventType === EVENT_TYPES.ANIMAL_QUARANTINE_RESOLVED, "Should have resolve event");

    const updatedAnimal = getAnimal(db, animal.id);
    assert(updatedAnimal.status === "quarantine", "Status should be back to quarantine");

    await removeAnimal(db, animal.id, "测试清理", { operator });
    await saveDb(db);
  }
});

tests.push({
  name: "10. Checksum chain validation",
  fn: async () => {
    const db = await loadDb();
    const operator = { role: "keeper", name: "测试员", key: "test-key" };

    const animal = await addAnimal(db, {
      strain: "C57BL/6J",
      cageId: "A-01",
      sex: "female",
      birthDate: "2026-04-01",
      project: "校验和测试",
      keeper: "测试员"
    }, { operator });
    await saveDb(db);

    const events = await queryEvents({ animalId: animal.id, sort: "asc" });
    assert(events.events.length >= 1, "Should have at least one event");

    for (let i = 0; i < events.events.length; i++) {
      const event = events.events[i];
      assert(event.checksum !== null, `Event ${i} should have checksum`);
      if (i > 0) {
        assert(event.previousChecksum === events.events[i - 1].checksum, `Event ${i} should reference previous checksum`);
      }
    }

    const integrity = await verifyIntegrity();
    assert(integrity.valid === true, "Integrity should remain valid after new events");

    await removeAnimal(db, animal.id, "测试清理", { operator });
    await saveDb(db);
  }
});

tests.push({
  name: "11. Batch import animal-level events",
  fn: async () => {
    const db = await loadDb();
    const operator = { role: "keeper", name: "测试员", key: "test-key" };
    const preInfo = await getLedgerInfo();

    const animals = [
      {
        strain: "C57BL/6J",
        cageId: "B-01",
        sex: "male",
        birthDate: "2026-05-01",
        project: "批量导入测试",
        keeper: "测试员"
      },
      {
        strain: "C57BL/6J",
        cageId: "B-01",
        sex: "female",
        birthDate: "2026-05-01",
        project: "批量导入测试",
        keeper: "测试员"
      },
      {
        strain: "BALB/c",
        cageId: "B-02",
        sex: "male",
        birthDate: "2026-05-02",
        project: "批量导入测试",
        keeper: "测试员"
      }
    ];

    const imported = await batchAddAnimals(db, animals, { operator, source: "batch_test" });
    await saveDb(db);

    const postInfo = await getLedgerInfo();
    const expectedNewEvents = 3 + 1;
    assert(postInfo.totalEvents === preInfo.totalEvents + expectedNewEvents, `Should have ${expectedNewEvents} new events (3 created + 1 batch)`);

    for (const animal of imported) {
      const events = await queryEvents({ animalId: animal.id, sort: "asc" });
      assert(events.total >= 1, `Animal ${animal.id} should have events`);
      assert(events.events[events.events.length - 1].eventType === EVENT_TYPES.ANIMAL_CREATED, `Last event should be created for ${animal.id}`);
      assert(events.events[events.events.length - 1].payload.batchImported === true, "Should have batchImported flag");
    }

    const batchEvents = await queryEvents({ eventType: EVENT_TYPES.ANIMAL_BATCH_IMPORTED });
    assert(batchEvents.total >= 1, "Should have batch import event");
    assert(batchEvents.events[0].payload.count === 3, "Should have count 3");
    assert(batchEvents.events[0].payload.source === "batch_test", "Should have correct source");

    for (const animal of imported) {
      await removeAnimal(db, animal.id, "测试清理", { operator });
    }
    await saveDb(db);
  }
});

tests.push({
  name: "12. Breeding pair creation animal-level events",
  fn: async () => {
    const db = await loadDb();
    const operator = { role: "keeper", name: "测试员", key: "test-key" };

    const male = await addAnimal(db, {
      strain: "C57BL/6J",
      cageId: "C-01",
      sex: "male",
      birthDate: "2026-03-01",
      project: "繁育测试",
      keeper: "测试员"
    }, { operator });
    await saveDb(db);

    const female = await addAnimal(db, {
      strain: "C57BL/6J",
      cageId: "C-02",
      sex: "female",
      birthDate: "2026-03-05",
      project: "繁育测试",
      keeper: "测试员"
    }, { operator });
    await saveDb(db);

    const preInfo = await getLedgerInfo();

    const { createBreedingPair } = await import("../lib/breedingData.js");
    const pair = await createBreedingPair(db, {
      maleId: male.id,
      femaleId: female.id,
      cageId: "C-03",
      pairDate: "2026-06-10",
      keeper: "测试员"
    }, { operator });
    await saveDb(db);

    const postInfo = await getLedgerInfo();
    const expectedNewEvents = 2 + 2;
    assert(postInfo.totalEvents === preInfo.totalEvents + expectedNewEvents, `Should have ${expectedNewEvents} new events (2 moves + 2 pair created)`);

    const maleEvents = await queryEvents({ animalId: male.id, sort: "asc" });
    const maleMovedEvent = maleEvents.events[maleEvents.events.length - 2];
    assert(maleMovedEvent.eventType === EVENT_TYPES.ANIMAL_MOVED, "Male should have moved event");
    assert(maleMovedEvent.payload.toCage === "C-03", "Male should have moved to C-03");
    assert(maleMovedEvent.payload.reason === "合笼配对移入", "Male move reason should be correct");

    const femaleEvents = await queryEvents({ animalId: female.id, sort: "asc" });
    const femaleMovedEvent = femaleEvents.events[femaleEvents.events.length - 2];
    assert(femaleMovedEvent.eventType === EVENT_TYPES.ANIMAL_MOVED, "Female should have moved event");
    assert(femaleMovedEvent.payload.toCage === "C-03", "Female should have moved to C-03");
    assert(femaleMovedEvent.payload.reason === "合笼配对移入", "Female move reason should be correct");

    const malePairEvent = maleEvents.events[maleEvents.events.length - 1];
    assert(malePairEvent.eventType === EVENT_TYPES.BREEDING_PAIR_CREATED, "Male should have pair created event");
    assert(malePairEvent.payload.role === "male", "Should have role male");
    assert(malePairEvent.payload.pairId === pair.id, "Should have correct pairId");

    const femalePairEvent = femaleEvents.events[femaleEvents.events.length - 1];
    assert(femalePairEvent.eventType === EVENT_TYPES.BREEDING_PAIR_CREATED, "Female should have pair created event");
    assert(femalePairEvent.payload.role === "female", "Should have role female");

    await removeAnimal(db, male.id, "测试清理", { operator });
    await removeAnimal(db, female.id, "测试清理", { operator });
    await saveDb(db);
  }
});

async function main() {
  console.log("=".repeat(60));
  console.log("  Event Ledger Module - Integration Test Suite");
  console.log("=".repeat(60));

  const args = process.argv.slice(2);
  const specificTest = args[0];

  await cleanupTestFiles();
  await backupData();

  let passed = 0;
  let failed = 0;
  const results = [];

  try {
    for (const test of tests) {
      if (specificTest && !test.name.includes(specificTest)) {
        continue;
      }

      const success = await runTest(test.name, test.fn);
      if (success) {
        passed++;
      } else {
        failed++;
      }
      results.push({ name: test.name, success });
    }
  } finally {
    console.log("\nRestoring original data...");
    await restoreData();
    await cleanupTestFiles();
  }

  console.log("\n" + "=".repeat(60));
  console.log("  Test Summary");
  console.log("=".repeat(60));
  console.log(`  Total: ${results.length}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log("=".repeat(60));

  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const r of results.filter(r => !r.success)) {
      console.log(`  ❌ ${r.name}`);
    }
    process.exit(1);
  } else {
    console.log("\n🎉 All tests passed!");
    process.exit(0);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export { tests };
