import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultDbPath = join(__dirname, "..", "data", "lab.json");
const defaultLedgerPath = join(__dirname, "..", "data", "event-ledger.json");
const defaultAuditPath = join(__dirname, "..", "data", "audit-logs.json");

const dbPath = process.env.DB_PATH || defaultDbPath;
const ledgerPath = process.env.EVENT_LEDGER_PATH || defaultLedgerPath;
const auditPath = process.env.AUDIT_LOG_PATH || defaultAuditPath;

export const SEVERITY = {
  CRITICAL: "critical",
  ERROR: "error",
  WARNING: "warning",
  INFO: "info"
};

export const ISSUE_CATEGORIES = {
  FACILITY_CONSISTENCY: "facility_consistency",
  CAGE_OWNERSHIP: "cage_ownership",
  BREEDING_RELATIONS: "breeding_relations",
  WEANING_OFFSPRING: "weaning_offspring",
  HEALTH_EVENT_REFERENCE: "health_event_reference",
  LEDGER_CHECKSUM: "ledger_checksum",
  AUDIT_ANIMAL_IDS: "audit_animal_ids",
  SNAPSHOT_LEDGER: "snapshot_ledger"
};

export const CATEGORY_LABELS = {
  [ISSUE_CATEGORIES.FACILITY_CONSISTENCY]: "设施归属一致性",
  [ISSUE_CATEGORIES.CAGE_OWNERSHIP]: "笼位归属一致性",
  [ISSUE_CATEGORIES.BREEDING_RELATIONS]: "繁育父母关系",
  [ISSUE_CATEGORIES.WEANING_OFFSPRING]: "断奶子代关联",
  [ISSUE_CATEGORIES.HEALTH_EVENT_REFERENCE]: "健康事件关联",
  [ISSUE_CATEGORIES.LEDGER_CHECKSUM]: "账本校验和链",
  [ISSUE_CATEGORIES.AUDIT_ANIMAL_IDS]: "审计 animalIds",
  [ISSUE_CATEGORIES.SNAPSHOT_LEDGER]: "快照与账本一致性"
};

const REPAIRABLE_TYPES = new Set([
  "animal_roomid_mismatch",
  "animal_zoneid_mismatch",
  "animal_roomid_missing",
  "animal_zoneid_missing",
  "animal_projectid_missing",
  "cage_roomid_invalid",
  "cage_zoneid_invalid",
  "breeding_father_sex_wrong",
  "breeding_mother_sex_wrong",
  "litter_weaned_at_mismatch",
  "health_event_project_mismatch",
  "audit_animalids_missing",
  "audit_animalids_empty"
]);

async function loadJson(path) {
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

async function loadAllData() {
  const [db, ledger, audit] = await Promise.all([
    loadJson(dbPath),
    loadJson(ledgerPath),
    loadJson(auditPath)
  ]);
  return { db, ledger, audit };
}

function makeIssue(type, category, severity, message, options = {}) {
  const issue = {
    type,
    category,
    severity,
    message,
    entityType: options.entityType || null,
    entityId: options.entityId || null,
    field: options.field || null,
    expected: options.expected ?? null,
    actual: options.actual ?? null,
    repairable: REPAIRABLE_TYPES.has(type),
    repairRisk: options.repairRisk || null,
    repairPatch: options.repairPatch || null,
    metadata: options.metadata || {}
  };
  return issue;
}

function buildPatch(target, field, expected, actual) {
  return {
    target,
    field,
    from: actual,
    to: expected
  };
}

function checkFacilityConsistency(db) {
  const issues = [];
  if (!db) return issues;

  const rooms = db.rooms || [];
  const zones = db.zones || [];
  const projects = db.projects || [];
  const cages = db.cages || [];
  const animals = db.animals || [];

  const roomIds = new Set(rooms.map(r => r.id));
  const zoneIds = new Set(zones.map(z => z.id));
  const projectIds = new Set(projects.map(p => p.id));
  const cageMap = new Map(cages.map(c => [c.id, c]));

  const zoneRoomMap = new Map();
  for (const z of zones) {
    zoneRoomMap.set(z.id, z.roomId);
  }

  for (const cage of cages) {
    if (cage.roomId && !roomIds.has(cage.roomId)) {
      issues.push(makeIssue(
        "cage_roomid_invalid",
        ISSUE_CATEGORIES.CAGE_OWNERSHIP,
        SEVERITY.ERROR,
        `笼位 ${cage.id} 的 roomId=${cage.roomId} 不存在`,
        {
          entityType: "cage",
          entityId: cage.id,
          field: "roomId",
          expected: null,
          actual: cage.roomId,
          repairRisk: "需要确认笼位正确归属的房间，修复后可能影响笼位内动物的房间归属",
          repairPatch: buildPatch(`cages[${cage.id}]`, "roomId", null, cage.roomId)
        }
      ));
    }

    if (cage.zoneId && !zoneIds.has(cage.zoneId)) {
      issues.push(makeIssue(
        "cage_zoneid_invalid",
        ISSUE_CATEGORIES.CAGE_OWNERSHIP,
        SEVERITY.ERROR,
        `笼位 ${cage.id} 的 zoneId=${cage.zoneId} 不存在`,
        {
          entityType: "cage",
          entityId: cage.id,
          field: "zoneId",
          expected: null,
          actual: cage.zoneId,
          repairRisk: "需要确认笼位正确归属的区域，修复后可能影响笼位内动物的区域归属",
          repairPatch: buildPatch(`cages[${cage.id}]`, "zoneId", null, cage.zoneId)
        }
      ));
    }

    if (cage.roomId && cage.zoneId && zoneRoomMap.has(cage.zoneId)) {
      const expectedRoomId = zoneRoomMap.get(cage.zoneId);
      if (cage.roomId !== expectedRoomId) {
        issues.push(makeIssue(
          "cage_zone_room_mismatch",
          ISSUE_CATEGORIES.CAGE_OWNERSHIP,
          SEVERITY.WARNING,
          `笼位 ${cage.id} 的 roomId 与 zone 所属房间不一致：zone ${cage.zoneId} 属于 ${expectedRoomId}`,
          {
            entityType: "cage",
            entityId: cage.id,
            field: "roomId",
            expected: expectedRoomId,
            actual: cage.roomId,
            repairRisk: "以 zone 归属为准修复 roomId，可能影响笼位统计"
          }
        ));
      }
    }
  }

  for (const project of projects) {
    if (project.roomId && !roomIds.has(project.roomId)) {
      issues.push(makeIssue(
        "project_roomid_invalid",
        ISSUE_CATEGORIES.FACILITY_CONSISTENCY,
        SEVERITY.WARNING,
        `项目 ${project.id} 的 roomId=${project.roomId} 不存在`,
        {
          entityType: "project",
          entityId: project.id,
          field: "roomId",
          expected: null,
          actual: project.roomId
        }
      ));
    }
  }

  for (const zone of zones) {
    if (zone.roomId && !roomIds.has(zone.roomId)) {
      issues.push(makeIssue(
        "zone_roomid_invalid",
        ISSUE_CATEGORIES.FACILITY_CONSISTENCY,
        SEVERITY.ERROR,
        `区域 ${zone.id} 的 roomId=${zone.roomId} 不存在`,
        {
          entityType: "zone",
          entityId: zone.id,
          field: "roomId",
          expected: null,
          actual: zone.roomId
        }
      ));
    }
  }

  for (const animal of animals) {
    const cage = cageMap.get(animal.cageId);

    if (animal.cageId && !cage) {
      issues.push(makeIssue(
        "animal_cage_not_found",
        ISSUE_CATEGORIES.CAGE_OWNERSHIP,
        SEVERITY.ERROR,
        `动物 ${animal.id} 归属的笼位 ${animal.cageId} 不存在`,
        {
          entityType: "animal",
          entityId: animal.id,
          field: "cageId",
          expected: null,
          actual: animal.cageId
        }
      ));
      continue;
    }

    if (cage) {
      if (animal.roomId && cage.roomId && animal.roomId !== cage.roomId) {
        issues.push(makeIssue(
          "animal_roomid_mismatch",
          ISSUE_CATEGORIES.FACILITY_CONSISTENCY,
          SEVERITY.WARNING,
          `动物 ${animal.id} 的 roomId 与笼位 ${cage.id} 的 roomId 不一致`,
          {
            entityType: "animal",
            entityId: animal.id,
            field: "roomId",
            expected: cage.roomId,
            actual: animal.roomId,
            repairRisk: "以笼位归属为准修复动物 roomId，低风险",
            repairPatch: buildPatch(`animals[${animal.id}]`, "roomId", cage.roomId, animal.roomId)
          }
        ));
      }

      if (animal.zoneId && cage.zoneId && animal.zoneId !== cage.zoneId) {
        issues.push(makeIssue(
          "animal_zoneid_mismatch",
          ISSUE_CATEGORIES.FACILITY_CONSISTENCY,
          SEVERITY.WARNING,
          `动物 ${animal.id} 的 zoneId 与笼位 ${cage.id} 的 zoneId 不一致`,
          {
            entityType: "animal",
            entityId: animal.id,
            field: "zoneId",
            expected: cage.zoneId,
            actual: animal.zoneId,
            repairRisk: "以笼位归属为准修复动物 zoneId，低风险",
            repairPatch: buildPatch(`animals[${animal.id}]`, "zoneId", cage.zoneId, animal.zoneId)
          }
        ));
      }

      if (!animal.roomId && cage.roomId) {
        issues.push(makeIssue(
          "animal_roomid_missing",
          ISSUE_CATEGORIES.FACILITY_CONSISTENCY,
          SEVERITY.INFO,
          `动物 ${animal.id} 缺少 roomId，可从笼位 ${cage.id} 推导`,
          {
            entityType: "animal",
            entityId: animal.id,
            field: "roomId",
            expected: cage.roomId,
            actual: null,
            repairRisk: "补充缺失的 roomId 字段，低风险",
            repairPatch: buildPatch(`animals[${animal.id}]`, "roomId", cage.roomId, null)
          }
        ));
      }

      if (!animal.zoneId && cage.zoneId) {
        issues.push(makeIssue(
          "animal_zoneid_missing",
          ISSUE_CATEGORIES.FACILITY_CONSISTENCY,
          SEVERITY.INFO,
          `动物 ${animal.id} 缺少 zoneId，可从笼位 ${cage.id} 推导`,
          {
            entityType: "animal",
            entityId: animal.id,
            field: "zoneId",
            expected: cage.zoneId,
            actual: null,
            repairRisk: "补充缺失的 zoneId 字段，低风险",
            repairPatch: buildPatch(`animals[${animal.id}]`, "zoneId", cage.zoneId, null)
          }
        ));
      }
    }

    if (animal.projectId && !projectIds.has(animal.projectId)) {
      issues.push(makeIssue(
        "animal_projectid_invalid",
        ISSUE_CATEGORIES.FACILITY_CONSISTENCY,
        SEVERITY.WARNING,
        `动物 ${animal.id} 的 projectId=${animal.projectId} 不存在`,
        {
          entityType: "animal",
          entityId: animal.id,
          field: "projectId",
          expected: null,
          actual: animal.projectId
        }
      ));
    }

    if (!animal.projectId && animal.project) {
      const matchedProject = projects.find(p => p.name === animal.project);
      if (matchedProject) {
        issues.push(makeIssue(
          "animal_projectid_missing",
          ISSUE_CATEGORIES.FACILITY_CONSISTENCY,
          SEVERITY.INFO,
          `动物 ${animal.id} 缺少 projectId，可从 project 名称推导`,
          {
            entityType: "animal",
            entityId: animal.id,
            field: "projectId",
            expected: matchedProject.id,
            actual: null,
            repairRisk: "补充缺失的 projectId 字段，低风险",
            repairPatch: buildPatch(`animals[${animal.id}]`, "projectId", matchedProject.id, null)
          }
        ));
      }
    }
  }

  return issues;
}

function checkBreedingRelations(db) {
  const issues = [];
  if (!db) return issues;

  const animals = db.animals || [];
  const breedingPairs = db.breedingPairs || [];
  const breedingLitters = db.breedingLitters || [];

  const animalMap = new Map(animals.map(a => [a.id, a]));
  const pairIds = new Set(breedingPairs.map(p => p.id));
  const litterIds = new Set(breedingLitters.map(l => l.id));

  for (const animal of animals) {
    if (animal.fatherId) {
      const father = animalMap.get(animal.fatherId);
      if (!father) {
        issues.push(makeIssue(
          "breeding_father_not_found",
          ISSUE_CATEGORIES.BREEDING_RELATIONS,
          SEVERITY.ERROR,
          `动物 ${animal.id} 的父亲 ${animal.fatherId} 不存在`,
          {
            entityType: "animal",
            entityId: animal.id,
            field: "fatherId",
            expected: null,
            actual: animal.fatherId
          }
        ));
      } else if (father.sex && father.sex !== "male") {
        issues.push(makeIssue(
          "breeding_father_sex_wrong",
          ISSUE_CATEGORIES.BREEDING_RELATIONS,
          SEVERITY.WARNING,
          `动物 ${animal.id} 的父亲 ${father.id} 性别为 ${father.sex}，应为 male`,
          {
            entityType: "animal",
            entityId: father.id,
            field: "sex",
            expected: "male",
            actual: father.sex,
            repairRisk: "修改动物性别为雄性，需确认是否为数据录入错误。可能影响繁育统计",
            repairPatch: buildPatch(`animals[${father.id}]`, "sex", "male", father.sex)
          }
        ));
      }
    }

    if (animal.motherId) {
      const mother = animalMap.get(animal.motherId);
      if (!mother) {
        issues.push(makeIssue(
          "breeding_mother_not_found",
          ISSUE_CATEGORIES.BREEDING_RELATIONS,
          SEVERITY.ERROR,
          `动物 ${animal.id} 的母亲 ${animal.motherId} 不存在`,
          {
            entityType: "animal",
            entityId: animal.id,
            field: "motherId",
            expected: null,
            actual: animal.motherId
          }
        ));
      } else if (mother.sex && mother.sex !== "female") {
        issues.push(makeIssue(
          "breeding_mother_sex_wrong",
          ISSUE_CATEGORIES.BREEDING_RELATIONS,
          SEVERITY.WARNING,
          `动物 ${animal.id} 的母亲 ${mother.id} 性别为 ${mother.sex}，应为 female`,
          {
            entityType: "animal",
            entityId: mother.id,
            field: "sex",
            expected: "female",
            actual: mother.sex,
            repairRisk: "修改动物性别为雌性，需确认是否为数据录入错误。可能影响繁育统计",
            repairPatch: buildPatch(`animals[${mother.id}]`, "sex", "female", mother.sex)
          }
        ));
      }
    }

    if (animal.litterId && !litterIds.has(animal.litterId)) {
      issues.push(makeIssue(
        "breeding_litter_not_found",
        ISSUE_CATEGORIES.BREEDING_RELATIONS,
        SEVERITY.WARNING,
        `动物 ${animal.id} 的窝号 ${animal.litterId} 不存在`,
        {
          entityType: "animal",
          entityId: animal.id,
          field: "litterId",
          expected: null,
          actual: animal.litterId
        }
      ));
    }
  }

  for (const pair of breedingPairs) {
    if (pair.maleId) {
      const male = animalMap.get(pair.maleId);
      if (!male) {
        issues.push(makeIssue(
          "breeding_pair_male_not_found",
          ISSUE_CATEGORIES.BREEDING_RELATIONS,
          SEVERITY.ERROR,
          `繁育配对 ${pair.id} 的雄鼠 ${pair.maleId} 不存在`,
          {
            entityType: "breedingPair",
            entityId: pair.id,
            field: "maleId",
            expected: null,
            actual: pair.maleId
          }
        ));
      } else if (male.sex && male.sex !== "male") {
        issues.push(makeIssue(
          "breeding_pair_male_sex_wrong",
          ISSUE_CATEGORIES.BREEDING_RELATIONS,
          SEVERITY.WARNING,
          `繁育配对 ${pair.id} 的雄鼠 ${male.id} 性别为 ${male.sex}`,
          {
            entityType: "breedingPair",
            entityId: pair.id,
            field: "maleId",
            expected: "雄性个体",
            actual: male.sex
          }
        ));
      }
    }

    if (pair.femaleId) {
      const female = animalMap.get(pair.femaleId);
      if (!female) {
        issues.push(makeIssue(
          "breeding_pair_female_not_found",
          ISSUE_CATEGORIES.BREEDING_RELATIONS,
          SEVERITY.ERROR,
          `繁育配对 ${pair.id} 的雌鼠 ${pair.femaleId} 不存在`,
          {
            entityType: "breedingPair",
            entityId: pair.id,
            field: "femaleId",
            expected: null,
            actual: pair.femaleId
          }
        ));
      } else if (female.sex && female.sex !== "female") {
        issues.push(makeIssue(
          "breeding_pair_female_sex_wrong",
          ISSUE_CATEGORIES.BREEDING_RELATIONS,
          SEVERITY.WARNING,
          `繁育配对 ${pair.id} 的雌鼠 ${female.id} 性别为 ${female.sex}`,
          {
            entityType: "breedingPair",
            entityId: pair.id,
            field: "femaleId",
            expected: "雌性个体",
            actual: female.sex
          }
        ));
      }
    }

    if (pair.cageId) {
      const cage = (db.cages || []).find(c => c.id === pair.cageId);
      if (!cage) {
        issues.push(makeIssue(
          "breeding_pair_cage_not_found",
          ISSUE_CATEGORIES.CAGE_OWNERSHIP,
          SEVERITY.WARNING,
          `繁育配对 ${pair.id} 的笼位 ${pair.cageId} 不存在`,
          {
            entityType: "breedingPair",
            entityId: pair.id,
            field: "cageId",
            expected: null,
            actual: pair.cageId
          }
        ));
      }
    }
  }

  for (const litter of breedingLitters) {
    if (litter.pairId && !pairIds.has(litter.pairId)) {
      issues.push(makeIssue(
        "breeding_litter_pair_not_found",
        ISSUE_CATEGORIES.BREEDING_RELATIONS,
        SEVERITY.WARNING,
        `窝 ${litter.id} 关联的配对 ${litter.pairId} 不存在`,
        {
          entityType: "breedingLitter",
          entityId: litter.id,
          field: "pairId",
          expected: null,
          actual: litter.pairId
        }
      ));
    }

    const litterAnimals = animals.filter(a => a.litterId === litter.id);
    if (litter.weanedCount != null && litterAnimals.length > 0) {
      const weanedAnimals = litterAnimals.filter(a => a.weanedAt);
      if (weanedAnimals.length !== litter.weanedCount && litter.status === "weaned") {
        issues.push(makeIssue(
          "weaning_count_mismatch",
          ISSUE_CATEGORIES.WEANING_OFFSPRING,
          SEVERITY.WARNING,
          `窝 ${litter.id} 记录断奶数 ${litter.weanedCount} 与实际断奶动物数 ${weanedAnimals.length} 不一致`,
          {
            entityType: "breedingLitter",
            entityId: litter.id,
            field: "weanedCount",
            expected: weanedAnimals.length,
            actual: litter.weanedCount
          }
        ));
      }
    }

    if (litter.status === "weaned" && litter.weanedAt) {
      for (const animal of litterAnimals) {
        if (animal.weanedAt && animal.weanedAt !== litter.weanedAt) {
          issues.push(makeIssue(
            "litter_weaned_at_mismatch",
            ISSUE_CATEGORIES.WEANING_OFFSPRING,
            SEVERITY.INFO,
            `动物 ${animal.id} 的 weanedAt 与窝 ${litter.id} 的 weanedAt 不一致`,
            {
              entityType: "animal",
              entityId: animal.id,
              field: "weanedAt",
              expected: litter.weanedAt,
              actual: animal.weanedAt,
              repairRisk: "以窝记录为准统一断奶时间，需确认是否存在分批断奶情况",
              repairPatch: buildPatch(`animals[${animal.id}]`, "weanedAt", litter.weanedAt, animal.weanedAt)
            }
          ));
        }
      }
    }

    if (litter.pairId) {
      const pair = breedingPairs.find(p => p.id === litter.pairId);
      if (pair) {
        for (const animal of litterAnimals) {
          if (animal.fatherId && pair.maleId && animal.fatherId !== pair.maleId) {
            issues.push(makeIssue(
              "litter_father_pair_mismatch",
              ISSUE_CATEGORIES.BREEDING_RELATIONS,
              SEVERITY.WARNING,
              `动物 ${animal.id} 的父亲 ${animal.fatherId} 与配对 ${pair.id} 的雄鼠 ${pair.maleId} 不一致`,
              {
                entityType: "animal",
                entityId: animal.id,
                field: "fatherId",
                expected: pair.maleId,
                actual: animal.fatherId
              }
            ));
          }
          if (animal.motherId && pair.femaleId && animal.motherId !== pair.femaleId) {
            issues.push(makeIssue(
              "litter_mother_pair_mismatch",
              ISSUE_CATEGORIES.BREEDING_RELATIONS,
              SEVERITY.WARNING,
              `动物 ${animal.id} 的母亲 ${animal.motherId} 与配对 ${pair.id} 的雌鼠 ${pair.femaleId} 不一致`,
              {
                entityType: "animal",
                entityId: animal.id,
                field: "motherId",
                expected: pair.femaleId,
                actual: animal.motherId
              }
            ));
          }
        }
      }
    }
  }

  const litterFamilyMap = new Map();
  for (const litter of breedingLitters) {
    const litterAnimals = animals.filter(a => a.litterId === litter.id);
    if (litterAnimals.length >= 2) {
      const fatherIds = [...new Set(litterAnimals.map(a => a.fatherId).filter(Boolean))];
      const motherIds = [...new Set(litterAnimals.map(a => a.motherId).filter(Boolean))];
      if (fatherIds.length > 1) {
        issues.push(makeIssue(
          "litter_siblings_father_mismatch",
          ISSUE_CATEGORIES.BREEDING_RELATIONS,
          SEVERITY.WARNING,
          `窝 ${litter.id} 的同窝动物父亲不一致: ${fatherIds.join(", ")}`,
          {
            entityType: "breedingLitter",
            entityId: litter.id,
            field: "fatherId",
            metadata: { fatherIds, siblingCount: litterAnimals.length }
          }
        ));
      }
      if (motherIds.length > 1) {
        issues.push(makeIssue(
          "litter_siblings_mother_mismatch",
          ISSUE_CATEGORIES.BREEDING_RELATIONS,
          SEVERITY.WARNING,
          `窝 ${litter.id} 的同窝动物母亲不一致: ${motherIds.join(", ")}`,
          {
            entityType: "breedingLitter",
            entityId: litter.id,
            field: "motherId",
            metadata: { motherIds, siblingCount: litterAnimals.length }
          }
        ));
      }
    }
  }

  return issues;
}

function checkHealthEvents(db) {
  const issues = [];
  if (!db) return issues;

  const animals = db.animals || [];
  const healthEvents = db.healthEvents || [];
  const animalIds = new Set(animals.map(a => a.id));

  for (const event of healthEvents) {
    if (event.animalId && !animalIds.has(event.animalId)) {
      issues.push(makeIssue(
        "health_event_animal_not_found",
        ISSUE_CATEGORIES.HEALTH_EVENT_REFERENCE,
        SEVERITY.ERROR,
        `健康事件 ${event.id} 关联的动物 ${event.animalId} 不存在`,
        {
          entityType: "healthEvent",
          entityId: event.id,
          field: "animalId",
          expected: null,
          actual: event.animalId
        }
      ));
    }

    if (event.animalId && animalIds.has(event.animalId)) {
      const animal = animals.find(a => a.id === event.animalId);
      if (event.project && animal.project && event.project !== animal.project) {
        issues.push(makeIssue(
          "health_event_project_mismatch",
          ISSUE_CATEGORIES.HEALTH_EVENT_REFERENCE,
          SEVERITY.INFO,
          `健康事件 ${event.id} 的项目 ${event.project} 与动物 ${animal.id} 的项目 ${animal.project} 不一致`,
          {
            entityType: "healthEvent",
            entityId: event.id,
            field: "project",
            expected: animal.project,
            actual: event.project,
            repairRisk: "以动物归属项目为准，低风险",
            repairPatch: buildPatch(`healthEvents[${event.id}]`, "project", animal.project, event.project)
          }
        ));
      }
    }
  }

  return issues;
}

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

function checkLedgerChecksum(ledger) {
  const issues = [];
  if (!ledger || !Array.isArray(ledger.events)) return issues;

  const events = ledger.events;
  const checksumChain = ledger.checksumChain || [];

  if (checksumChain.length !== events.length) {
    issues.push(makeIssue(
      "ledger_chain_length_mismatch",
      ISSUE_CATEGORIES.LEDGER_CHECKSUM,
      SEVERITY.CRITICAL,
      `账本 checksum 链长度 ${checksumChain.length} 与事件数 ${events.length} 不一致`,
      {
        entityType: "ledger",
        entityId: "root",
        field: "checksumChain",
        expected: events.length,
        actual: checksumChain.length
      }
    ));
  }

  let previousChecksum = null;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    if (event.previousChecksum !== previousChecksum) {
      issues.push(makeIssue(
        "ledger_previous_checksum_mismatch",
        ISSUE_CATEGORIES.LEDGER_CHECKSUM,
        SEVERITY.CRITICAL,
        `事件 ${event.id} (索引 ${i}) 的 previousChecksum 不匹配`,
        {
          entityType: "ledgerEvent",
          entityId: event.id,
          field: "previousChecksum",
          index: i,
          expected: previousChecksum,
          actual: event.previousChecksum
        }
      ));
    }

    const computed = generateChecksum({
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

    if (event.checksum !== computed) {
      issues.push(makeIssue(
        "ledger_event_checksum_mismatch",
        ISSUE_CATEGORIES.LEDGER_CHECKSUM,
        SEVERITY.CRITICAL,
        `事件 ${event.id} (索引 ${i}) 的 checksum 校验失败`,
        {
          entityType: "ledgerEvent",
          entityId: event.id,
          field: "checksum",
          index: i,
          expected: computed,
          actual: event.checksum
        }
      ));
    }

    if (i < checksumChain.length && checksumChain[i] !== event.checksum) {
      issues.push(makeIssue(
        "ledger_chain_entry_mismatch",
        ISSUE_CATEGORIES.LEDGER_CHECKSUM,
        SEVERITY.CRITICAL,
        `事件 ${event.id} 的 checksum 与 checksumChain[${i}] 不一致`,
        {
          entityType: "ledgerEvent",
          entityId: event.id,
          field: "checksumChain",
          index: i,
          expected: checksumChain[i],
          actual: event.checksum
        }
      ));
    }

    previousChecksum = event.checksum;
  }

  return issues;
}

function checkAuditAnimalIds(audit, db) {
  const issues = [];
  if (!audit || !Array.isArray(audit.logs)) return issues;

  const animalIds = new Set((db?.animals || []).map(a => a.id));
  const logs = audit.logs;

  for (const log of logs) {
    const logAnimalIds = log.animalIds || [];

    if (logAnimalIds.length === 0) {
      const shouldHaveAnimals = log.operation?.startsWith("animal.") ||
        log.operation?.startsWith("health.") ||
        log.operation === "breeding.litter_wean";
      if (shouldHaveAnimals) {
        issues.push(makeIssue(
          "audit_animalids_empty",
          ISSUE_CATEGORIES.AUDIT_ANIMAL_IDS,
          SEVERITY.WARNING,
          `审计日志 ${log.id} (操作: ${log.operation}) 的 animalIds 为空`,
          {
            entityType: "auditLog",
            entityId: log.id,
            field: "animalIds",
            expected: "非空数组",
            actual: [],
            repairRisk: "需要根据 request body 或 path 重新推导 animalIds，可能遗漏部分关联动物",
            repairPatch: {
              target: `auditLogs[${log.id}]`,
              field: "animalIds",
              action: "recompute_from_request"
            }
          }
        ));
      }
      continue;
    }

    const missingIds = logAnimalIds.filter(id => !animalIds.has(id));
    if (missingIds.length > 0) {
      issues.push(makeIssue(
        "audit_animalids_missing",
        ISSUE_CATEGORIES.AUDIT_ANIMAL_IDS,
        SEVERITY.WARNING,
        `审计日志 ${log.id} 中 ${missingIds.length} 个 animalId 在快照中不存在`,
        {
          entityType: "auditLog",
          entityId: log.id,
          field: "animalIds",
          expected: [],
          actual: missingIds,
          metadata: { missingCount: missingIds.length, missingIds },
          repairRisk: "动物可能已被删除或 ID 有误，需人工确认",
          repairPatch: {
            target: `auditLogs[${log.id}]`,
            field: "animalIds",
            action: "remove_invalid_ids",
            removeIds: missingIds
          }
        }
      ));
    }
  }

  return issues;
}

function checkSnapshotLedgerConsistency(db, ledger) {
  const issues = [];
  if (!db || !ledger || !Array.isArray(ledger.events)) return issues;

  const animals = db.animals || [];
  const events = ledger.events;

  const ANIMAL_RELATED_EVENTS = [
    "animal.created", "animal.note_added", "animal.moved", "animal.removed",
    "animal.quarantine_record", "animal.quarantine_released",
    "animal.quarantine_abnormal", "animal.quarantine_resolved",
    "animal.batch_imported", "feeding.recorded",
    "breeding.pair_created", "breeding.litter_weaned",
    "health.event_created", "health.event_closed"
  ];

  const ledgerAnimalIds = new Set();
  const removedAnimalIds = new Set();

  for (const event of events) {
    if (event.animalId && ANIMAL_RELATED_EVENTS.includes(event.eventType)) {
      ledgerAnimalIds.add(event.animalId);
      if (event.eventType === "animal.removed") {
        removedAnimalIds.add(event.animalId);
      }
    }
  }

  const snapshotAnimalIds = new Set(animals.map(a => a.id));

  for (const animalId of ledgerAnimalIds) {
    if (!snapshotAnimalIds.has(animalId) && !removedAnimalIds.has(animalId)) {
      issues.push(makeIssue(
        "snapshot_animal_missing",
        ISSUE_CATEGORIES.SNAPSHOT_LEDGER,
        SEVERITY.ERROR,
        `动物 ${animalId} 存在于事件账本但不存在于快照（且未标记为已移除）`,
        {
          entityType: "animal",
          entityId: animalId,
          field: "existence",
          expected: "存在于快照",
          actual: "缺失"
        }
      ));
    }
  }

  for (const animal of animals) {
    if (!ledgerAnimalIds.has(animal.id)) {
      issues.push(makeIssue(
        "ledger_animal_missing",
        ISSUE_CATEGORIES.SNAPSHOT_LEDGER,
        SEVERITY.WARNING,
        `动物 ${animal.id} 存在于快照但不存在于事件账本`,
        {
          entityType: "animal",
          entityId: animal.id,
          field: "existence_in_ledger",
          expected: "存在于账本",
          actual: "缺失"
        }
      ));
    }
  }

  return issues;
}

function summarizeIssues(issues) {
  const byCategory = {};
  const bySeverity = {};
  const byType = {};
  let repairableCount = 0;

  for (const issue of issues) {
    byCategory[issue.category] = (byCategory[issue.category] || 0) + 1;
    bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
    byType[issue.type] = (byType[issue.type] || 0) + 1;
    if (issue.repairable) repairableCount++;
  }

  return {
    total: issues.length,
    repairable: repairableCount,
    byCategory,
    bySeverity,
    byType
  };
}

export async function runConsistencyCheck(options = {}) {
  const { db: dbOverride, ledger: ledgerOverride, audit: auditOverride } = options;
  const checks = options.checks || [
    "facility",
    "breeding",
    "health",
    "ledger",
    "audit",
    "snapshot_ledger"
  ];

  let db, ledger, audit;

  if (dbOverride && ledgerOverride && auditOverride) {
    db = dbOverride;
    ledger = ledgerOverride;
    audit = auditOverride;
  } else {
    const data = await loadAllData();
    db = dbOverride || data.db;
    ledger = ledgerOverride || data.ledger;
    audit = auditOverride || data.audit;
  }

  const allIssues = [];
  const checkResults = {};

  if (checks.includes("facility")) {
    const issues = checkFacilityConsistency(db);
    allIssues.push(...issues);
    checkResults.facility = { count: issues.length, issues };
  }

  if (checks.includes("breeding")) {
    const issues = checkBreedingRelations(db);
    allIssues.push(...issues);
    checkResults.breeding = { count: issues.length, issues };
  }

  if (checks.includes("health")) {
    const issues = checkHealthEvents(db);
    allIssues.push(...issues);
    checkResults.health = { count: issues.length, issues };
  }

  if (checks.includes("ledger")) {
    const issues = checkLedgerChecksum(ledger);
    allIssues.push(...issues);
    checkResults.ledger = { count: issues.length, issues };
  }

  if (checks.includes("audit")) {
    const issues = checkAuditAnimalIds(audit, db);
    allIssues.push(...issues);
    checkResults.audit = { count: issues.length, issues };
  }

  if (checks.includes("snapshot_ledger")) {
    const issues = checkSnapshotLedgerConsistency(db, ledger);
    allIssues.push(...issues);
    checkResults.snapshot_ledger = { count: issues.length, issues };
  }

  const summary = summarizeIssues(allIssues);

  const repairableIssues = allIssues.filter(i => i.repairable);
  const repairPatches = repairableIssues.map(issue => ({
    type: issue.type,
    category: issue.category,
    severity: issue.severity,
    entityType: issue.entityType,
    entityId: issue.entityId,
    patch: issue.repairPatch,
    risk: issue.repairRisk,
    message: issue.message
  }));

  return {
    dryRun: true,
    timestamp: new Date().toISOString(),
    summary,
    checkResults,
    issues: allIssues,
    repairPreview: {
      totalPatches: repairPatches.length,
      patches: repairPatches,
      riskSummary: buildRiskSummary(repairPatches)
    },
    dataSources: {
      db: dbPath,
      ledger: ledgerPath,
      audit: auditPath
    }
  };
}

function buildRiskSummary(patches) {
  const byRiskLevel = {
    low: 0,
    medium: 0,
    high: 0,
    unknown: 0
  };

  const riskExamples = [];

  for (const patch of patches) {
    const risk = patch.risk || "";
    let level = "unknown";
    if (risk.includes("低风险")) level = "low";
    else if (risk.includes("中风险") || risk.includes("需确认")) level = "medium";
    else if (risk.includes("高风险") || risk.includes("重大影响")) level = "high";

    byRiskLevel[level]++;

    if (riskExamples.length < 5 && level !== "low") {
      riskExamples.push({
        entityId: patch.entityId,
        type: patch.type,
        risk: patch.risk
      });
    }
  }

  return {
    byRiskLevel,
    overallAssessment: byRiskLevel.high > 0
      ? "high"
      : byRiskLevel.medium > 0
        ? "medium"
        : byRiskLevel.low > 0
          ? "low"
          : byRiskLevel.unknown > 0
            ? "unknown"
            : "none",
    riskExamples
  };
}

function severityGte(issueSeverity, minSeverity) {
  const order = ["critical", "error", "warning", "info"];
  const issueLevel = order.indexOf(issueSeverity);
  const minLevel = order.indexOf(minSeverity);
  if (issueLevel === -1 || minLevel === -1) return true;
  return issueLevel <= minLevel;
}

export function filterResult(result, options = {}) {
  const { category, severity } = options;

  if (!category && !severity) return result;

  const matchIssue = (issue) => {
    if (category && issue.category !== category) return false;
    if (severity && !severityGte(issue.severity, severity)) return false;
    return true;
  };

  const filteredIssues = result.issues.filter(matchIssue);

  const filteredCheckResults = {};
  for (const [key, val] of Object.entries(result.checkResults)) {
    const filtered = val.issues.filter(matchIssue);
    filteredCheckResults[key] = { count: filtered.length, issues: filtered };
  }

  const filteredPatches = result.repairPreview.patches.filter(patch => {
    if (category && patch.category !== category) return false;
    if (severity && !severityGte(patch.severity, severity)) return false;
    return true;
  });

  const newSummary = summarizeIssues(filteredIssues);

  return {
    ...result,
    summary: newSummary,
    checkResults: filteredCheckResults,
    issues: filteredIssues,
    repairPreview: {
      ...result.repairPreview,
      totalPatches: filteredPatches.length,
      patches: filteredPatches,
      riskSummary: buildRiskSummary(filteredPatches)
    }
  };
}

export function formatConsoleReport(result) {
  const lines = [];
  const { summary, checkResults, repairPreview } = result;

  lines.push("=".repeat(70));
  lines.push("  数据一致性巡检报告 (Dry Run)");
  lines.push(`  生成时间: ${result.timestamp}`);
  lines.push("=".repeat(70));
  lines.push("");

  lines.push("【总览】");
  lines.push(`  问题总数: ${summary.total}`);
  lines.push(`  可自动修复: ${summary.repairable}`);
  lines.push("");

  lines.push("  按严重程度:");
  const severityOrder = ["critical", "error", "warning", "info"];
  const severityLabels = { critical: "严重", error: "错误", warning: "警告", info: "信息" };
  for (const sev of severityOrder) {
    const count = summary.bySeverity[sev] || 0;
    if (count > 0) {
      lines.push(`    ${severityLabels[sev]}: ${count}`);
    }
  }
  lines.push("");

  lines.push("  按类别:");
  for (const [cat, count] of Object.entries(summary.byCategory)) {
    lines.push(`    ${CATEGORY_LABELS[cat] || cat}: ${count}`);
  }
  lines.push("");

  lines.push("-".repeat(70));
  lines.push("【各类别检查详情】");
  lines.push("");

  for (const [checkName, checkResult] of Object.entries(checkResults)) {
    const label = {
      facility: "设施归属与笼位一致性",
      breeding: "繁育关系一致性",
      health: "健康事件关联",
      ledger: "账本校验和链",
      audit: "审计日志 animalIds",
      snapshot_ledger: "快照与账本一致性"
    }[checkName] || checkName;

    lines.push(`  ▶ ${label} (${checkResult.count} 个问题)`);

    if (checkResult.issues.length === 0) {
      lines.push("    ✓ 未发现问题");
    } else {
      const bySeverity = {};
      for (const issue of checkResult.issues) {
        bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
      }
      const sevParts = [];
      for (const sev of severityOrder) {
        if (bySeverity[sev]) {
          sevParts.push(`${severityLabels[sev]}: ${bySeverity[sev]}`);
        }
      }
      lines.push(`    分布: ${sevParts.join(" | ")}`);

      const topIssues = checkResult.issues.slice(0, 5);
      for (const issue of topIssues) {
        const sevMark = {
          critical: "✗",
          error: "✗",
          warning: "!",
          info: "ℹ"
        }[issue.severity] || "?";
        const rep = issue.repairable ? " [可修复]" : "";
        lines.push(`    ${sevMark} ${issue.message}${rep}`);
      }
      if (checkResult.issues.length > 5) {
        lines.push(`    ... 还有 ${checkResult.issues.length - 5} 个问题`);
      }
    }
    lines.push("");
  }

  lines.push("-".repeat(70));
  lines.push("【修复预览】");
  lines.push(`  可修复补丁总数: ${repairPreview.totalPatches}`);
  lines.push("");

  if (repairPreview.totalPatches > 0) {
    const riskLabels = { low: "低风险", medium: "中风险", high: "高风险", unknown: "未知" };
    lines.push("  风险等级分布:");
    for (const [level, count] of Object.entries(repairPreview.riskSummary.byRiskLevel)) {
      if (count > 0) {
        lines.push(`    ${riskLabels[level]}: ${count}`);
      }
    }
    lines.push(`  整体风险评估: ${riskLabels[repairPreview.riskSummary.overallAssessment] || "未知"}`);
    lines.push("");

    lines.push("  补丁示例 (前5个):");
    for (let i = 0; i < Math.min(5, repairPreview.patches.length); i++) {
      const patch = repairPreview.patches[i];
      lines.push(`    ${i + 1}. [${patch.entityType}] ${patch.entityId}`);
      if (patch.patch?.field) {
        lines.push(`       字段: ${patch.patch.field}`);
        lines.push(`       从: ${JSON.stringify(patch.patch.from)}`);
        lines.push(`       到: ${JSON.stringify(patch.patch.to)}`);
      }
      if (patch.risk) {
        lines.push(`       风险: ${patch.risk}`);
      }
    }
  } else {
    lines.push("  无可自动修复的问题");
  }

  lines.push("");
  lines.push("=".repeat(70));
  lines.push("  注意: 此为 Dry Run 模式，未对任何数据进行修改");
  lines.push("=".repeat(70));

  return lines.join("\n");
}
