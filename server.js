import http from "node:http";
import { loadDb, saveDb, send, body, readQuery } from "./lib/helpers.js";
import { handleCageRoutes } from "./routes/cageRoutes.js";
import { handleFeedingRoutes } from "./routes/feedingRoutes.js";
import { handleAnimalRoutes } from "./routes/animalRoutes.js";
import { handleBreedingRoutes } from "./routes/breedingRoutes.js";
import { handleHealthEventRoutes } from "./routes/healthEventRoutes.js";
import { handleAuditRoutes } from "./routes/auditRoutes.js";
import { handleLedgerRoutes } from "./routes/ledgerRoutes.js";
import { facilityRoutes } from "./routes/facilityRoutes.js";
import { handleSyncRoutes } from "./routes/syncRoutes.js";
import { ensureSyncCollections } from "./lib/syncData.js";
import { ANIMAL_STATUS, ACTIVE_STOCK_STATUSES } from "./lib/animalValidator.js";
import { ledgerExists, getLedgerInfo } from "./lib/eventLedger.js";
import { migrateFromSnapshot } from "./scripts/migrate-events.js";
import { PAIRING_STATUS, LITTER_STATUS } from "./lib/breedingValidator.js";
import { ensureHealthCollections, getHealthEventStats, migrateHistoricalNotes } from "./lib/healthEventData.js";
import { authenticate, AuthorizationError } from "./lib/auth.js";
import { authorize, getRolePermissionsMap, ACTIONS, getPrincipalAllowedScope } from "./lib/permissions.js";
import { resolveAuditOperation, writeAuditLog } from "./lib/audit.js";
import { getApiKeySource, ROLES } from "./lib/apiKeys.js";
import {
  migrateLegacyFacilityData,
  getFacilityOverview,
  DEFAULT_ROOM_ID,
  DEFAULT_ZONE_ID,
  DEFAULT_PROJECT_ID,
  ensureFacilityCollections,
  addRoom,
  addZone,
  addProject,
  addKeeper,
  ROOM_STATUS,
  PROJECT_STATUS
} from "./lib/facilityData.js";
import { getCage } from "./lib/cageData.js";
import { getBreedingStats } from "./lib/breedingData.js";

const seed = buildSeedData();

function buildSeedData() {
  const db = {
    rooms: [],
    zones: [],
    projects: [],
    keepers: [],
    cages: [],
    animals: [],
    breedingPairs: [],
    breedingLitters: [],
    feedingPlans: [],
    feedingRecords: [],
    healthEvents: []
  };
  ensureFacilityCollections(db);

  addRoom(db, {
    id: DEFAULT_ROOM_ID,
    name: "主动物房",
    building: "实验楼A",
    floor: "3F",
    status: ROOM_STATUS.ACTIVE,
    capacity: 200,
    climateControl: { temperature: 22.5, humidity: 55, lightingSchedule: "12/12" },
    description: "默认主动物房，包含SPF区、普通区、检疫区、繁育区四个功能区域",
    createdAt: "2026-05-01T00:00:00.000Z"
  });
  addRoom(db, {
    id: "room-secondary",
    name: "新动物房",
    building: "实验楼B",
    floor: "2F",
    status: ROOM_STATUS.ACTIVE,
    capacity: 150,
    climateControl: { temperature: 22.0, humidity: 50, lightingSchedule: "14/10" },
    description: "扩展动物房，用于特殊项目及转基因品系",
    createdAt: "2026-05-01T00:00:00.000Z"
  });
  addRoom(db, {
    id: "room-quarantine",
    name: "独立检疫楼",
    building: "独立检疫楼",
    floor: "1F",
    status: ROOM_STATUS.MAINTENANCE,
    capacity: 60,
    climateControl: { temperature: 23.0, humidity: 60, lightingSchedule: "12/12" },
    description: "新入动物检疫隔离区，防止外来病原体污染主动物房",
    createdAt: "2026-05-01T00:00:00.000Z"
  });

  addZone(db, { id: DEFAULT_ZONE_ID, roomId: DEFAULT_ROOM_ID, name: "SPF区", rackPrefix: "A", capacity: 60, description: "无特定病原体区" });
  addZone(db, { id: "zone-conventional", roomId: DEFAULT_ROOM_ID, name: "普通区", rackPrefix: "B", capacity: 60, description: "常规饲养区" });
  addZone(db, { id: "zone-quarantine", roomId: DEFAULT_ROOM_ID, name: "检疫区", rackPrefix: "C", capacity: 30, description: "入房检疫区" });
  addZone(db, { id: "zone-breeding", roomId: DEFAULT_ROOM_ID, name: "繁育区", rackPrefix: "D", capacity: 50, description: "繁育配对区" });
  addZone(db, { id: "zone-transgenic", roomId: "room-secondary", name: "转基因区", rackPrefix: "T", capacity: 80, description: "基因工程动物专用" });
  addZone(db, { id: "zone-special", roomId: "room-secondary", name: "特殊项目区", rackPrefix: "S", capacity: 70, description: "行为学、影像学等特殊研究" });

  addProject(db, { id: DEFAULT_PROJECT_ID, name: "默认项目", roomId: DEFAULT_ROOM_ID, code: "DEF-001", status: PROJECT_STATUS.ACTIVE, description: "未指定项目的动物默认归属" });
  addProject(db, { id: "proj-metabolism", name: "代谢观察", roomId: DEFAULT_ROOM_ID, code: "MET-01", status: PROJECT_STATUS.ACTIVE, principalInvestigator: "王研究员", targetSampleSize: 50, description: "代谢相关生理指标长期观察" });
  addProject(db, { id: "proj-immunology", name: "免疫反应", roomId: DEFAULT_ROOM_ID, code: "IMM-02", status: PROJECT_STATUS.ACTIVE, principalInvestigator: "李博士", targetSampleSize: 30, description: "免疫原性与抗体反应实验" });
  addProject(db, { id: "proj-oncology", name: "肿瘤研究", roomId: DEFAULT_ROOM_ID, code: "ONC-03", status: PROJECT_STATUS.ACTIVE, principalInvestigator: "陈教授", targetSampleSize: 80, description: "肿瘤模型建立与药物筛选" });
  addProject(db, { id: "proj-vaccine", name: "疫苗测试", roomId: DEFAULT_ROOM_ID, code: "VAC-04", status: PROJECT_STATUS.SUSPENDED, principalInvestigator: "赵研究员", targetSampleSize: 40, description: "疫苗有效性与安全性评估" });
  addProject(db, { id: "proj-breeding", name: "子代繁育群", roomId: DEFAULT_ROOM_ID, code: "BRD-05", status: PROJECT_STATUS.ACTIVE, principalInvestigator: "林青", targetSampleSize: 200, description: "常规繁育种群维持" });
  addProject(db, { id: "proj-transgenic-core", name: "转基因核心群", roomId: "room-secondary", code: "TG-06", status: PROJECT_STATUS.ACTIVE, principalInvestigator: "周遥", targetSampleSize: 60, description: "转基因品系保种与扩繁" });

  addKeeper(db, { id: "keeper-lq", name: "林青", employeeId: "EMP-001", status: "active", role: "senior_keeper", roomIds: [DEFAULT_ROOM_ID], defaultProjectId: "proj-metabolism", contact: { phone: "138****1001", email: "linqing@lab.example" }, specialties: ["小鼠日常饲养", "检疫操作", "代谢指标测量"], permissions: { allowWean: true, allowBreedingPair: true, allowQuarantineRelease: true }, joinDate: "2023-03-15" });
  addKeeper(db, { id: "keeper-zy", name: "周遥", employeeId: "EMP-002", status: "active", role: "keeper", roomIds: [DEFAULT_ROOM_ID, "room-secondary"], defaultProjectId: "proj-immunology", contact: { phone: "138****1002", email: "zhouyao@lab.example" }, specialties: ["转基因操作", "繁育管理", "免疫实验"], permissions: { allowWean: true, allowBreedingPair: true, allowQuarantineRelease: false }, joinDate: "2024-01-10" });
  addKeeper(db, { id: "keeper-gz", name: "管理员", employeeId: "ADM-001", status: "active", role: "facility_manager", roomIds: ["*"], defaultProjectId: DEFAULT_PROJECT_ID, contact: { phone: "138****0000", email: "admin@lab.example" }, specialties: ["设施管理", "质量控制", "人员培训"], permissions: { allowWean: true, allowBreedingPair: true, allowQuarantineRelease: true, allowRoomAccess: true }, joinDate: "2022-01-01" });

  const cages = [
    { id: "A-01", area: "SPF区", rack: "A", capacity: 5, status: "active", createdAt: "2026-05-01T00:00:00.000Z" },
    { id: "A-02", area: "SPF区", rack: "A", capacity: 5, status: "active", createdAt: "2026-05-01T00:00:00.000Z" },
    { id: "B-03", area: "普通区", rack: "B", capacity: 5, status: "active", createdAt: "2026-05-01T00:00:00.000Z" },
    { id: "B-04", area: "普通区", rack: "B", capacity: 5, status: "active", createdAt: "2026-05-01T00:00:00.000Z" },
    { id: "C-01", area: "检疫区", rack: "C", capacity: 3, status: "active", createdAt: "2026-05-01T00:00:00.000Z" },
    { id: "D-01", area: "繁育区", rack: "D", capacity: 5, status: "active", createdAt: "2026-05-01T00:00:00.000Z" },
    { id: "D-02", area: "繁育区", rack: "D", capacity: 5, status: "active", createdAt: "2026-05-01T00:00:00.000Z" },
    { id: "D-03", area: "繁育区", rack: "D", capacity: 5, status: "active", createdAt: "2026-05-01T00:00:00.000Z" },
    { id: "D-04", area: "繁育区", rack: "D", capacity: 5, status: "active", createdAt: "2026-05-01T00:00:00.000Z" }
  ];
  for (const cage of cages) {
    const zone = db.zones.find(z => cage.area === z.name);
    cage.roomId = zone?.roomId || DEFAULT_ROOM_ID;
    cage.zoneId = zone?.id || DEFAULT_ZONE_ID;
    db.cages.push(cage);
  }

  db.animals = buildSeedAnimals(db);
  db.breedingPairs = buildSeedBreedingPairs(db);
  db.breedingLitters = buildSeedBreedingLitters(db);
  db.feedingPlans = buildSeedFeedingPlans(db);
  db.feedingRecords = buildSeedFeedingRecords(db);
  db.healthEvents = buildSeedHealthEvents(db);
  return db;
}

function buildSeedAnimals(db) {
  return [
    makeAnimal(db, "ani-1001", "C57BL/6J", "A-01", "female", "2026-01-20", "代谢观察", "林青", ANIMAL_STATUS.RELEASED, ["2026-06-18", "2026-07-02"],
      [{ id: "note-1", date: "2026-06-10", weight: 21.4, condition: "正常进食", keeper: "林青" }],
      [{ id: "move-1", from: "检疫区", to: "A-01", movedAt: "2026-05-01T09:30:00.000Z", reason: "检疫结束" }],
      [
        { id: "qr-1", date: "2026-04-20", temperature: 36.8, weight: 18.5, condition: "正常", symptoms: [], isAbnormal: false, notes: "入检初查", examiner: "林青", createdAt: "2026-04-20T09:00:00.000Z" },
        { id: "qr-2", date: "2026-04-27", temperature: 37.0, weight: 19.8, condition: "正常", symptoms: [], isAbnormal: false, notes: "复检", examiner: "林青", createdAt: "2026-04-27T09:00:00.000Z" }
      ],
      { entered: "2026-04-20T09:00:00.000Z", released: "2026-05-01T09:30:00.000Z", approval: { id: "qa-1", approvedAt: "2026-05-01T09:30:00.000Z", approver: "林青", targetCageId: "A-01", notes: "检疫合格放行" } }),
    makeAnimal(db, "ani-1002", "BALB/c", "B-03", "male", "2026-02-03", "免疫反应", "周遥", ANIMAL_STATUS.RELEASED, ["2026-06-15"],
      [], [],
      [{ id: "qr-3", date: "2026-05-10", temperature: 36.9, weight: 22.1, condition: "正常", symptoms: [], isAbnormal: false, notes: "入检初查", examiner: "周遥", createdAt: "2026-05-10T10:00:00.000Z" }],
      { entered: "2026-05-10T10:00:00.000Z", released: "2026-05-17T10:00:00.000Z", approval: { id: "qa-2", approvedAt: "2026-05-17T10:00:00.000Z", approver: "周遥", targetCageId: "B-03", notes: "检疫合格" } }),
    makeAnimal(db, "ani-1003", "C57BL/6J", "C-01", "male", "2026-04-15", "肿瘤研究", "林青", ANIMAL_STATUS.QUARANTINE, [], [], [],
      [{ id: "qr-4", date: "2026-06-10", temperature: 36.7, weight: 16.5, condition: "正常", symptoms: [], isAbnormal: false, notes: "入检初查，状态良好", examiner: "林青", createdAt: "2026-06-10T14:00:00.000Z" }],
      { entered: "2026-06-10T14:00:00.000Z" }),
    makeAnimal(db, "ani-1004", "BALB/c", "C-01", "female", "2026-04-20", "疫苗测试", "周遥", ANIMAL_STATUS.QUARANTINE_ABNORMAL, [], [], [],
      [
        { id: "qr-5", date: "2026-06-12", temperature: 37.1, weight: 15.2, condition: "正常", symptoms: [], isAbnormal: false, notes: "入检初查", examiner: "周遥", createdAt: "2026-06-12T09:00:00.000Z" },
        { id: "qr-6", date: "2026-06-13", temperature: 38.5, weight: 14.8, condition: "食欲下降", symptoms: ["发热", "毛发杂乱"], isAbnormal: true, notes: "发现异常，需密切观察", examiner: "周遥", createdAt: "2026-06-13T09:00:00.000Z" }
      ],
      { entered: "2026-06-12T09:00:00.000Z", abnormal: { markedAt: "2026-06-13T09:00:00.000Z", reason: "发热，食欲下降", handler: "周遥", notes: "疑似感染，待进一步检测" } }),
  ].concat(buildBreedingAnimals(db)).concat(buildWeanlings(db));
}

function makeAnimal(db, id, strain, cageId, sex, birthDate, project, keeper, status, observationNodes, notes, moves, quarantineRecords, extra = {}) {
  const cage = cageId ? getCage(db, cageId) : null;
  const projectObj = (db.projects || []).find(p => p.name === project);
  const roomId = cage?.roomId || DEFAULT_ROOM_ID;
  const zoneId = cage?.zoneId || null;
  return {
    id, strain, cageId, roomId, zoneId,
    projectId: projectObj?.id || null,
    sex, birthDate, project, keeper, status,
    observationNodes: observationNodes || [],
    notes: notes || [],
    moves: moves || [],
    quarantineRecords: quarantineRecords || [],
    enteredQuarantineAt: extra.entered || null,
    quarantineReleasedAt: extra.released || null,
    quarantineApproval: extra.approval || null,
    abnormalMarkedAt: extra.abnormal?.markedAt || null,
    abnormalReason: extra.abnormal?.reason || null,
    abnormalHandler: extra.abnormal?.handler || null,
    abnormalNotes: extra.abnormal?.notes || null,
    weanedAt: extra.weanedAt || null,
    weaningWeight: extra.weaningWeight || null,
    fatherId: extra.fatherId || null,
    motherId: extra.motherId || null,
    litterId: extra.litterId || null,
    breedingInfo: extra.breedingInfo || null
  };
}

function buildBreedingAnimals(db) {
  const list = [];
  const base = [
    ["ani-2001", "C57BL/6J", "A-02", "male", "2026-01-15", "子代繁育群", "林青"],
    ["ani-2002", "C57BL/6J", "A-02", "female", "2026-01-18", "子代繁育群", "林青"],
    ["ani-2003", "BALB/c", "B-04", "male", "2026-02-10", "子代繁育群", "周遥"],
    ["ani-2004", "BALB/c", "B-04", "female", "2026-02-15", "子代繁育群", "周遥"],
    ["ani-2005", "C57BL/6J", "A-02", "male", "2026-03-01", "子代繁育群", "林青"],
    ["ani-2006", "C57BL/6J", "A-02", "female", "2026-03-05", "子代繁育群", "林青"]
  ];
  for (let i = 0; i < base.length; i++) {
    const [id, strain, cageId, sex, birth, project, keeper] = base[i];
    const moveDay = i < 2 ? 20 : i < 4 ? 15 : (i === 4 ? 25 : 28);
    const enterDay = i < 2 ? 10 : i < 4 ? (i === 2 ? 5 : 8) : (i === 4 ? 15 : 18);
    list.push(makeAnimal(db, id, strain, cageId, sex, birth, project, keeper, ANIMAL_STATUS.RELEASED, [], [],
      [{ id: `move-${i + 2}`, from: "检疫区", to: cageId, movedAt: `2026-04-${moveDay}T0${9 + (i % 2)}:${30 + i * 10}:00.000Z`, reason: "检疫结束，作为种鼠使用" }],
      [{ id: `qr-${7 + i}`, date: `2026-04-${enterDay}`, temperature: 36.8 + (i % 3) * 0.05, weight: 18.5 + i * 1.2, condition: "正常", symptoms: [], isAbnormal: false, notes: "入检初查", examiner: keeper, createdAt: `2026-04-${enterDay}T09:00:00.000Z` }],
      { entered: `2026-04-${enterDay}T09:00:00.000Z`, released: `2026-04-${moveDay}T0${9 + (i % 2)}:${30 + i * 10}:00.000Z`, approval: { id: `qa-${3 + i}`, approvedAt: `2026-04-${moveDay}T0${9 + (i % 2)}:${30 + i * 10}:00.000Z`, approver: keeper, targetCageId: cageId, notes: "检疫合格，种鼠备用" } }
    ));
  }
  return list;
}

function buildWeanlings(db) {
  const list = [];
  const obs = ["2026-07-08", "2026-07-15", "2026-07-22"];
  const males = [9.2, 9.8, 8.7, 10.1];
  const females = [8.5, 9.0, 8.9];
  for (let i = 0; i < 4; i++) {
    const w = males[i];
    list.push(makeAnimal(db, `ani-300${i + 1}`, "C57BL/6J", "D-01", "male", "2026-05-20", "子代繁育群", "林青", ANIMAL_STATUS.QUARANTINE, obs,
      [{ id: `note-w${i + 1}`, date: "2026-06-10", weight: w, condition: "断奶分笼", keeper: "林青", type: "weaning" }],
      [{ id: `move-w${i + 1}`, from: "A-02", to: "D-01", movedAt: "2026-06-10T10:00:00.000Z", reason: "断奶分笼" }],
      [],
      { entered: "2026-06-10T10:00:00.000Z", weanedAt: "2026-06-10T10:00:00.000Z", weaningWeight: w, fatherId: "ani-2001", motherId: "ani-2002", litterId: "litter-demo-1",
        breedingInfo: { fatherId: "ani-2001", motherId: "ani-2002", litterId: "litter-demo-1", pairingId: "pair-demo-1", weanDate: "2026-06-10", weaningWeight: w } }));
  }
  for (let j = 0; j < 3; j++) {
    const w = females[j];
    list.push(makeAnimal(db, `ani-300${j + 5}`, "C57BL/6J", "D-02", "female", "2026-05-20", "子代繁育群", "林青", ANIMAL_STATUS.QUARANTINE, obs,
      [{ id: `note-w${j + 5}`, date: "2026-06-10", weight: w, condition: "断奶分笼", keeper: "林青", type: "weaning" }],
      [{ id: `move-w${j + 5}`, from: "A-02", to: "D-02", movedAt: "2026-06-10T10:00:00.000Z", reason: "断奶分笼" }],
      [],
      { entered: "2026-06-10T10:00:00.000Z", weanedAt: "2026-06-10T10:00:00.000Z", weaningWeight: w, fatherId: "ani-2001", motherId: "ani-2002", litterId: "litter-demo-1",
        breedingInfo: { fatherId: "ani-2001", motherId: "ani-2002", litterId: "litter-demo-1", pairingId: "pair-demo-1", weanDate: "2026-06-10", weaningWeight: w } }));
  }
  return list;
}

function buildSeedBreedingPairs(db) {
  return [
    { id: "pair-demo-1", cageId: "A-02", roomId: getCage(db, "A-02")?.roomId, zoneId: getCage(db, "A-02")?.zoneId, projectId: "proj-breeding", project: "子代繁育群",
      maleId: "ani-2001", femaleId: "ani-2002", pairDate: "2026-04-28", expectedDeliveryDate: "2026-05-19",
      observationNodes: ["2026-05-05", "2026-05-12", "2026-05-17", "2026-05-19", "2026-05-22"],
      status: PAIRING_STATUS.WEANED, strain: "C57BL/6J", keeper: "林青", notes: "C57BL/6J 首对繁育，已断奶完成，7/8存活",
      createdAt: "2026-04-28T09:00:00.000Z", statusUpdatedAt: "2026-06-10T10:00:00.000Z", deliveredAt: "2026-05-20T08:30:00.000Z", weanedAt: "2026-06-10T10:00:00.000Z" },
    { id: "pair-demo-2", cageId: "B-04", roomId: getCage(db, "B-04")?.roomId, zoneId: getCage(db, "B-04")?.zoneId, projectId: "proj-breeding", project: "子代繁育群",
      maleId: "ani-2003", femaleId: "ani-2004", pairDate: "2026-05-20", expectedDeliveryDate: "2026-06-10",
      observationNodes: ["2026-05-27", "2026-06-03", "2026-06-08", "2026-06-10", "2026-06-13"],
      status: PAIRING_STATUS.DELIVERED, strain: "BALB/c", keeper: "周遥", notes: "BALB/c 繁育，已产仔待断奶",
      createdAt: "2026-05-20T10:00:00.000Z", statusUpdatedAt: "2026-06-10T08:00:00.000Z", deliveredAt: "2026-06-10T08:00:00.000Z" },
    { id: "pair-demo-3", cageId: "A-02", roomId: getCage(db, "A-02")?.roomId, zoneId: getCage(db, "A-02")?.zoneId, projectId: "proj-breeding", project: "子代繁育群",
      maleId: "ani-2005", femaleId: "ani-2006", pairDate: "2026-06-01", expectedDeliveryDate: "2026-06-22",
      observationNodes: ["2026-06-08", "2026-06-15", "2026-06-20", "2026-06-22", "2026-06-25"],
      status: PAIRING_STATUS.CANCELLED, strain: "C57BL/6J", keeper: "林青", notes: "合笼后未见栓，取消配对",
      createdAt: "2026-06-01T09:00:00.000Z", statusUpdatedAt: "2026-06-08T14:00:00.000Z", cancelledAt: "2026-06-08T14:00:00.000Z", cancelReason: "合笼7天未见阴道栓，判断未受孕，取消配对" }
  ];
}

function buildSeedBreedingLitters(db) {
  return [
    { id: "litter-demo-1", pairId: "pair-demo-1", roomId: getCage(db, "A-02")?.roomId, zoneId: getCage(db, "A-02")?.zoneId, projectId: "proj-breeding", project: "子代繁育群",
      birthDate: "2026-05-20", totalPups: 8, malePups: 4, femalePups: 4, unknownSexPups: 0,
      status: LITTER_STATUS.WEANED, cageId: "A-02", keeper: "林青", notes: "出生8只全部存活，21天断奶7只（1只弱仔淘汰）",
      weanDate: "2026-06-10", weanedAt: "2026-06-10T10:00:00.000Z", weanedCount: 7,
      weaningPlan: [
        { sex: "male", count: 4, cageId: "D-01", project: "子代繁育群", keeper: "林青" },
        { sex: "female", count: 3, cageId: "D-02", project: "子代繁育群", keeper: "林青" }
      ], createdAt: "2026-05-20T08:30:00.000Z" },
    { id: "litter-demo-2", pairId: "pair-demo-2", roomId: getCage(db, "B-04")?.roomId, zoneId: getCage(db, "B-04")?.zoneId, projectId: "proj-breeding", project: "子代繁育群",
      birthDate: "2026-06-10", totalPups: 6, malePups: 3, femalePups: 2, unknownSexPups: 1,
      status: LITTER_STATUS.BORN, cageId: "B-04", keeper: "周遥", notes: "出生6只，母性良好，待21天后断奶", createdAt: "2026-06-10T08:00:00.000Z" }
  ];
}

function buildSeedFeedingPlans(db) {
  const resolveFacility = (plan) => {
    if (plan.targetType === "cage" && plan.targetId) {
      const cage = getCage(db, plan.targetId);
      plan.roomId = cage?.roomId || DEFAULT_ROOM_ID;
      plan.zoneId = cage?.zoneId || null;
    } else if (plan.targetType === "animal" && plan.targetId) {
      const animal = (db.animals || []).find(a => a.id === plan.targetId);
      if (animal?.roomId) {
        plan.roomId = animal.roomId;
        plan.zoneId = animal.zoneId || null;
      } else if (animal?.cageId) {
        const cage = getCage(db, animal.cageId);
        plan.roomId = cage?.roomId || DEFAULT_ROOM_ID;
        plan.zoneId = cage?.zoneId || null;
      } else {
        plan.roomId = DEFAULT_ROOM_ID;
        plan.zoneId = null;
      }
    } else {
      plan.roomId = DEFAULT_ROOM_ID;
      plan.zoneId = null;
    }
    return plan;
  };
  return [
    resolveFacility({ id: "plan-1", targetType: "animal", targetId: "ani-1001", feedType: "标准颗粒饲料", feedTimes: ["08:00", "18:00"], dailyAmount: 5.0, keeper: "林青", status: "active", startDate: "2026-06-01", endDate: null, createdAt: "2026-06-01T00:00:00.000Z", notes: "代谢观察组，每日定量饲喂" }),
    resolveFacility({ id: "plan-2", targetType: "animal", targetId: "ani-1002", feedType: "高蛋白饲料", feedTimes: ["09:00"], dailyAmount: 4.5, keeper: "周遥", status: "active", startDate: "2026-06-05", endDate: null, createdAt: "2026-06-05T00:00:00.000Z", notes: "免疫实验组，每日一次" }),
    resolveFacility({ id: "plan-3", targetType: "cage", targetId: "A-01", feedType: "SPF级饲料", feedTimes: ["07:30", "19:30"], dailyAmount: 15.0, keeper: "林青", status: "active", startDate: "2026-05-15", endDate: null, createdAt: "2026-05-15T00:00:00.000Z", notes: "SPF区A架笼位统一饲喂" }),
    resolveFacility({ id: "plan-4", targetType: "cage", targetId: "B-03", feedType: "普通维持饲料", feedTimes: ["08:30"], dailyAmount: 10.0, keeper: "周遥", status: "active", startDate: "2026-05-20", endDate: null, createdAt: "2026-05-20T00:00:00.000Z", notes: "普通区B架笼位每日一次" })
  ];
}

function buildSeedFeedingRecords(db) {
  const resolveFacility = (rec) => {
    if (rec.targetType === "cage" && rec.targetId) {
      const cage = getCage(db, rec.targetId);
      rec.roomId = cage?.roomId || DEFAULT_ROOM_ID;
      rec.zoneId = cage?.zoneId || null;
    } else if (rec.targetType === "animal" && rec.targetId) {
      const animal = (db.animals || []).find(a => a.id === rec.targetId);
      if (animal?.roomId) {
        rec.roomId = animal.roomId;
        rec.zoneId = animal.zoneId || null;
      } else if (animal?.cageId) {
        const cage = getCage(db, animal.cageId);
        rec.roomId = cage?.roomId || DEFAULT_ROOM_ID;
        rec.zoneId = cage?.zoneId || null;
      } else {
        rec.roomId = DEFAULT_ROOM_ID;
        rec.zoneId = null;
      }
    } else {
      rec.roomId = DEFAULT_ROOM_ID;
      rec.zoneId = null;
    }
    return rec;
  };
  return [
    resolveFacility({ id: "record-1", planId: "plan-1", targetType: "animal", targetId: "ani-1001", date: "2026-06-13", scheduledTime: "08:00", actualTime: "2026-06-13T08:05:00.000Z", feedType: "标准颗粒饲料", amount: 2.5, keeper: "林青", status: "completed", notes: "食欲良好，全部吃完" }),
    resolveFacility({ id: "record-2", planId: "plan-1", targetType: "animal", targetId: "ani-1001", date: "2026-06-13", scheduledTime: "18:00", actualTime: "2026-06-13T18:10:00.000Z", feedType: "标准颗粒饲料", amount: 2.5, keeper: "林青", status: "completed", notes: "" }),
    resolveFacility({ id: "record-3", planId: "plan-2", targetType: "animal", targetId: "ani-1002", date: "2026-06-13", scheduledTime: "09:00", actualTime: "2026-06-13T09:15:00.000Z", feedType: "高蛋白饲料", amount: 4.5, keeper: "周遥", status: "completed", notes: "进食正常" }),
    resolveFacility({ id: "record-4", planId: "plan-3", targetType: "cage", targetId: "A-01", date: "2026-06-12", scheduledTime: "07:30", actualTime: "2026-06-12T07:35:00.000Z", feedType: "SPF级饲料", amount: 7.5, keeper: "林青", status: "completed", notes: "" }),
    resolveFacility({ id: "record-5", planId: "plan-3", targetType: "cage", targetId: "A-01", date: "2026-06-12", scheduledTime: "19:30", actualTime: "2026-06-12T19:40:00.000Z", feedType: "SPF级饲料", amount: 7.5, keeper: "林青", status: "completed", notes: "" }),
    resolveFacility({ id: "record-6", planId: null, targetType: "animal", targetId: "ani-3003", date: "2026-06-11", scheduledTime: "08:30", actualTime: "2026-06-11T08:35:00.000Z", feedType: "高蛋白饲料", amount: 1.5, keeper: "林青", status: "completed", condition: "断奶后食欲不振，体型偏小", weight: 8.7, notes: "与同窝相比明显偏小，需加强营养" })
  ];
}

function buildSeedHealthEvents(db) {
  const base = [
    { id: "hev-demo-1", animalId: "ani-1004", project: "疫苗测试", keeper: "周遥", source: "quarantine_record", sourceRecordId: "qr-6",
      condition: "发热38.5℃，食欲下降，精神差", abnormalKeywords: ["发热", "食欲下降", "毛发杂乱", "精神差"],
      weightChange: { previousWeight: 15.2, previousDate: "2026-06-12", currentWeight: 14.8, diff: -0.4, percent: -2.63, daysDiff: 1, threshold: 10, isAbnormal: false },
      handler: "周遥", assignee: "周遥", status: "in_progress",
      notes: [
        { id: "hn-demo-1", type: "assign", content: "分派负责人：周遥", createdAt: "2026-06-13T09:05:00.000Z", author: "system" },
        { id: "hn-demo-2", type: "processing", content: "隔离观察，给予电解质水补充，待进一步检查", createdAt: "2026-06-13T14:30:00.000Z", author: "周遥", metadata: { treatment: "电解质水", temperature: "38.5℃" } }
      ],
      createdAt: "2026-06-13T09:00:00.000Z", updatedAt: "2026-06-13T14:30:00.000Z",
      assignedAt: "2026-06-13T09:05:00.000Z", inProgressAt: "2026-06-13T14:30:00.000Z", closedAt: null, closeReason: null,
      relatedRecordIds: ["qr-6", "abnormal-mark-ani-1004"] },
    { id: "hev-demo-2", animalId: "ani-1001", project: "代谢观察", keeper: "林青", source: "animal_note", sourceRecordId: "note-1",
      condition: "体重下降明显，1周内减轻2.5g",
      abnormalKeywords: ["体重下降", "体重异常变化"],
      weightChange: { previousWeight: 23.9, previousDate: "2026-06-03", currentWeight: 21.4, diff: -2.5, percent: -10.46, daysDiff: 7, threshold: 10, isAbnormal: true },
      handler: null, assignee: null, status: "pending", notes: [],
      createdAt: "2026-06-10T16:20:00.000Z", updatedAt: "2026-06-10T16:20:00.000Z",
      assignedAt: null, inProgressAt: null, closedAt: null, closeReason: null, relatedRecordIds: ["note-1"] },
    { id: "hev-demo-3", animalId: "ani-1002", project: "免疫反应", keeper: "周遥", source: "feeding_checkin", sourceRecordId: "record-3",
      condition: "腹泻，粪便稀软，精神差", abnormalKeywords: ["腹泻", "粪便异常", "精神差"], weightChange: null,
      handler: null, assignee: "周遥", status: "assigned",
      notes: [{ id: "hn-demo-3", type: "assign", content: "分派负责人：周遥", createdAt: "2026-06-13T10:00:00.000Z", author: "system" }],
      createdAt: "2026-06-13T09:20:00.000Z", updatedAt: "2026-06-13T10:00:00.000Z",
      assignedAt: "2026-06-13T10:00:00.000Z", inProgressAt: null, closedAt: null, closeReason: null, relatedRecordIds: ["record-3"] },
    { id: "hev-demo-4", animalId: "ani-3003", project: "子代繁育群", keeper: "林青", source: "feeding_checkin", sourceRecordId: "record-6",
      condition: "断奶后食欲不振，体型偏小", abnormalKeywords: ["食欲下降", "消瘦", "待观察"],
      weightChange: { previousWeight: 9.5, previousDate: "2026-06-10", currentWeight: 8.7, diff: -0.8, percent: -8.42, daysDiff: 3, threshold: 10, isAbnormal: false },
      handler: "林青", assignee: "林青", status: "closed",
      notes: [
        { id: "hn-demo-4", type: "assign", content: "分派负责人：林青", createdAt: "2026-06-11T09:00:00.000Z", author: "system" },
        { id: "hn-demo-5", type: "processing", content: "给予营养补充剂，调整饲料配方为高蛋白", createdAt: "2026-06-11T14:00:00.000Z", author: "林青", metadata: { treatment: "营养补充剂", dosage: "0.5g/天" } },
        { id: "hn-demo-6", type: "processing", content: "连续观察3天，食欲恢复，体重回升至9.0g", createdAt: "2026-06-13T10:00:00.000Z", author: "林青" },
        { id: "hn-demo-7", type: "close", content: "处理完成，已恢复正常", createdAt: "2026-06-13T16:00:00.000Z", author: "林青", resolution: "营养干预后恢复良好" }
      ], createdAt: "2026-06-11T08:30:00.000Z", updatedAt: "2026-06-13T16:00:00.000Z",
      assignedAt: "2026-06-11T09:00:00.000Z", inProgressAt: "2026-06-11T14:00:00.000Z", closedAt: "2026-06-13T16:00:00.000Z",
      closeReason: "处理完成，已恢复正常", relatedRecordIds: ["record-6", "note-w3"] },
    { id: "hev-demo-5", animalId: "ani-1003", project: "肿瘤研究", keeper: "林青", source: "quarantine_record", sourceRecordId: "qr-4",
      condition: "入检时发现轻微脱毛，需观察", abnormalKeywords: ["脱毛", "待观察"], weightChange: null,
      handler: "林青", assignee: "林青", status: "closed",
      notes: [
        { id: "hn-demo-8", type: "assign", content: "分派负责人：林青", createdAt: "2026-06-10T15:00:00.000Z", author: "system" },
        { id: "hn-demo-9", type: "processing", content: "皮肤镜检，排除真菌感染，判定为应激性脱毛", createdAt: "2026-06-11T10:00:00.000Z", author: "林青", metadata: { exam: "皮肤镜检", result: "阴性" } },
        { id: "hn-demo-10", type: "close", content: "处理完成，排除病理因素", createdAt: "2026-06-12T09:00:00.000Z", author: "林青", resolution: "应激性脱毛，无需特殊处理" }
      ], createdAt: "2026-06-10T14:10:00.000Z", updatedAt: "2026-06-12T09:00:00.000Z",
      assignedAt: "2026-06-10T15:00:00.000Z", inProgressAt: "2026-06-11T10:00:00.000Z", closedAt: "2026-06-12T09:00:00.000Z",
      closeReason: "处理完成，排除病理因素", relatedRecordIds: ["qr-4"] }
  ];
  for (const ev of base) {
    const animal = db.animals.find(a => a.id === ev.animalId);
    ev.roomId = animal?.roomId || DEFAULT_ROOM_ID;
    ev.projectId = animal?.projectId || null;
  }
  return base;
}

const port = Number(process.env.PORT || 3007);

function hoursUntil(dateText) {
  return (new Date(dateText).getTime() - Date.now()) / 36e5;
}

function migrateDb(db) {
  if (!db || !db.animals) return db;
  let migrated = false;
  for (const animal of db.animals) {
    if (animal.status === "active") { animal.status = ANIMAL_STATUS.RELEASED; migrated = true; }
    if (animal.status === "removed") { animal.status = ANIMAL_STATUS.REMOVED; migrated = true; }
    if (!animal.quarantineRecords) { animal.quarantineRecords = []; migrated = true; }
    if (animal.status === ANIMAL_STATUS.RELEASED && !animal.enteredQuarantineAt) { animal.enteredQuarantineAt = null; migrated = true; }
    if (!("fatherId" in animal)) { animal.fatherId = null; migrated = true; }
    if (!("motherId" in animal)) { animal.motherId = null; migrated = true; }
    if (!("litterId" in animal)) { animal.litterId = null; migrated = true; }
    if (!("breedingInfo" in animal)) { animal.breedingInfo = null; migrated = true; }
  }
  if (!db.breedingPairs) { db.breedingPairs = []; migrated = true; }
  if (!db.breedingLitters) { db.breedingLitters = []; migrated = true; }
  const prevHealthLen = db.healthEvents ? db.healthEvents.length : 0;
  ensureHealthCollections(db);
  if (db.healthEvents.length !== prevHealthLen) { migrated = true; }
  const migration = migrateHistoricalNotes(db);
  if (migration.createdCount > 0 || migration.mergedCount > 0) { migrated = true; }
  ensureFacilityCollections(db);
  const facilityMigrated = migrateLegacyFacilityData(db);
  if (facilityMigrated) { migrated = true; }
  const prevSyncLen = db.syncOperations ? db.syncOperations.length : 0;
  ensureSyncCollections(db);
  if (db.syncOperations.length !== prevSyncLen || !db.syncQueues || !db.cageAbnormalReports) { migrated = true; }
  if (migrated) { saveDb(db).catch(() => {}); }
  return db;
}

function wrapResponseForAudit(res) {
  const auditCtx = { statusCode: null, body: null, headers: {} };
  const origWriteHead = res.writeHead.bind(res);
  res.writeHead = (statusCode, reason, headers) => {
    auditCtx.statusCode = statusCode;
    if (typeof reason === "object" && reason !== null) { Object.assign(auditCtx.headers, reason); }
    else if (headers) { Object.assign(auditCtx.headers, headers); }
    return origWriteHead(statusCode, reason, headers);
  };
  const origEnd = res.end.bind(res);
  res.end = (chunk, encoding, cb) => {
    if (chunk && typeof chunk === "string") {
      try { auditCtx.body = JSON.parse(chunk); }
      catch (e) { auditCtx.body = chunk.length > 500 ? chunk.substring(0, 500) : chunk; }
    } else if (chunk && Buffer.isBuffer(chunk)) {
      try { auditCtx.body = JSON.parse(chunk.toString("utf8")); }
      catch (e) { auditCtx.body = chunk.length > 500 ? chunk.toString("utf8", 0, 500) : chunk.toString("utf8"); }
    }
    return origEnd(chunk, encoding, cb);
  };
  return auditCtx;
}

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) { return String(fwd).split(",")[0].trim(); }
  return req.socket?.remoteAddress || null;
}

const bypassAuthPaths = ["/healthz", "/_ping"];

async function handleRoot(req, res, principal, db) {
  return send(res, 200, {
    service: "实验动物房笼位和饲养记录API",
    auth: {
      enabled: true,
      apiKeySource: getApiKeySource(),
      currentUser: { role: principal.role, name: principal.name },
      roles: Object.values(ROLES),
      permissions: getRolePermissionsMap(),
      actions: ACTIONS,
      allowedScope: getPrincipalAllowedScope(principal)
    },
    facility: getFacilityOverview(db),
    endpoints: buildEndpointList()
  });
}

function buildEndpointList() {
  return [
    "GET /facility/overview",
    "GET /facility/room-pressure-dashboard",
    "GET /facility/defaults",
    "GET /rooms?status=&building=",
    "GET /rooms/:id",
    "POST /rooms [admin]",
    "PATCH /rooms/:id [admin]",
    "GET /zones?roomId=",
    "GET /zones/:id",
    "POST /zones [admin]",
    "GET /projects?status=&roomId=",
    "GET /projects/:id",
    "POST /projects [admin]",
    "PATCH /projects/:id [admin]",
    "GET /keepers?status=&roomId=",
    "GET /keepers/:id",
    "POST /keepers [admin]",
    "PATCH /keepers/:id [admin]",
    "GET /resolve/room-by-cage/:cageId",
    "GET /cages?area=&rack=&status=&roomId=&zoneId=",
    "GET /cages/:id",
    "POST /cages [admin]",
    "POST /cages/:id/disable [admin]",
    "GET /animals?project=&cageId=&status=&roomId=&zoneId=&keeper=&projectId=",
    "POST /animals [keeper]",
    "GET /animals/:id",
    "POST /animals/:id/notes [keeper]",
    "POST /animals/:id/move [keeper]",
    "POST /animals/:id/remove [keeper]",
    "POST /animals/:id/quarantine/record [keeper]",
    "POST /animals/:id/quarantine/release [keeper]",
    "POST /animals/:id/quarantine/abnormal [keeper]",
    "POST /animals/:id/quarantine/resolve [keeper]",
    "POST /animals/import/preview [keeper]",
    "POST /animals/import [keeper]",
    "GET /reports/stock?roomId=&projectId=",
    "GET /reports/upcoming?days=7&roomId=",
    "GET /reports/health-events?project=&keeper=&fromDate=&toDate=&roomId=",
    "GET /feeding/plans?targetType=&targetId=&status=&keeper=&roomId=&project=",
    "POST /feeding/plans [keeper]",
    "GET /feeding/plans/:id",
    "POST /feeding/plans/:id/disable [keeper]",
    "GET /feeding/today?targetType=&keeper=&date=",
    "GET /feeding/today/summary",
    "GET /feeding/schedule?dateFrom=&dateTo=&targetType=&keeper=&roomId=",
    "GET /feeding/schedule/summary?dateFrom=&dateTo=&targetType=&keeper=&roomId=",
    "POST /feeding/checkin [keeper]",
    "GET /feeding/records?planId=&targetType=&targetId=&date=&keeper=&status=&roomId=&project=",
    "GET /feeding/records/:id",
    "GET /feeding/history?days=&targetType=&targetId=&keeper=",
    "GET /breeding/pairs?cageId=&maleId=&femaleId=&status=&strain=&roomId=&zoneId=&project=",
    "POST /breeding/pairs [keeper]",
    "GET /breeding/pairs/:id",
    "POST /breeding/pairs/:id/status [keeper]",
    "POST /breeding/pairs/:id/cancel [keeper]",
    "GET /breeding/litters?pairId=&status=&roomId=&zoneId=&cageId=",
    "POST /breeding/litters [keeper]",
    "GET /breeding/litters/:id",
    "POST /breeding/litters/:id/update [keeper]",
    "POST /breeding/litters/:id/wean [keeper]",
    "GET /breeding/stats?roomId=&projectId=",
    "GET /breeding/genealogy/:animalId",
    "GET /breeding/offspring/:parentId",
    "GET /health-events/meta",
    "GET /health-events?status=&project=&keeper=&animalId=&source=&fromDate=&toDate=&roomId=",
    "POST /health-events [keeper]",
    "GET /health-events/:id",
    "POST /health-events/:id/assign [keeper]",
    "POST /health-events/:id/notes [keeper]",
    "POST /health-events/:id/close [keeper]",
    "GET /health-events/stats?project=&keeper=&assignee=&fromDate=&toDate=&roomId=",
    "POST /health-events/detect",
    "POST /health-events/migrate-historical [admin]",
    "GET /audit/logs [admin]",
    "GET /audit/logs/:id [admin]",
    "GET /audit/stats [admin]",
    "GET /audit/operations [admin]",
    "GET /ledger/info",
    "GET /ledger/event-types",
    "GET /ledger/events?eventType=&animalId=&fromDate=&toDate=",
    "GET /ledger/events/:id",
    "GET /ledger/animals/:id/lifecycle?until=",
    "GET /ledger/export?fromDate=&toDate=&format=&animalId= [admin]",
    "GET /ledger/verify/integrity [admin]",
    "GET /ledger/verify/snapshot [admin]",
    "POST /ledger/migrate?force= [admin]",
    "GET /sync/meta",
    "POST /sync/batch [keeper]",
    "GET /sync/operations?status=&keeper=&operationType=&fromDate=&toDate=",
    "GET /sync/operations/:id",
    "GET /sync/cage-abnormal?cageId=&roomId=&status=&severity=&fromDate=&toDate="
  ];
}

async function processRoutes(req, res, url, db) {
  const facilityHandled = await facilityRoutes(req, res, url, db);
  if (facilityHandled) return true;
  const cageHandled = await handleCageRoutes(req, res, url, db);
  if (cageHandled) return true;
  const feedingHandled = await handleFeedingRoutes(req, res, url, db);
  if (feedingHandled) return true;
  const animalHandled = await handleAnimalRoutes(req, res, url, db);
  if (animalHandled) return true;
  const breedingHandled = await handleBreedingRoutes(req, res, url, db);
  if (breedingHandled) return true;
  const healthHandled = await handleHealthEventRoutes(req, res, url, db);
  if (healthHandled) return true;
  const auditHandled = await handleAuditRoutes(req, res, url, db);
  if (auditHandled) return true;
  const ledgerHandled = await handleLedgerRoutes(req, res, url, db);
  if (ledgerHandled) return true;
  const syncHandled = await handleSyncRoutes(req, res, url, db);
  if (syncHandled) return true;

  if (req.method === "GET" && url.pathname === "/reports/stock") {
    const roomId = url.searchParams.get("roomId") || undefined;
    const projectId = url.searchParams.get("projectId") || undefined;
    let active = db.animals.filter((a) => ACTIVE_STOCK_STATUSES.includes(a.status));
    if (roomId) active = active.filter(a => a.roomId === roomId);
    if (projectId) active = active.filter(a => a.projectId === projectId);
    const byProject = Object.fromEntries(active.reduce((map, a) => map.set(a.project, (map.get(a.project) || 0) + 1), new Map()));
    const byProjectId = Object.fromEntries(active.reduce((map, a) => a.projectId ? map.set(a.projectId, (map.get(a.projectId) || 0) + 1) : map, new Map()));
    const byCage = Object.fromEntries(active.reduce((map, a) => map.set(a.cageId, (map.get(a.cageId) || 0) + 1), new Map()));
    const byRoom = Object.fromEntries(active.reduce((map, a) => map.set(a.roomId || DEFAULT_ROOM_ID, (map.get(a.roomId || DEFAULT_ROOM_ID) || 0) + 1), new Map()));
    const quarantineCount = db.animals.filter((a) => a.status === ANIMAL_STATUS.QUARANTINE && (!roomId || a.roomId === roomId)).length;
    const abnormalCount = db.animals.filter((a) => a.status === ANIMAL_STATUS.QUARANTINE_ABNORMAL && (!roomId || a.roomId === roomId)).length;
    return send(res, 200, { total: active.length, byProject, byProjectId, byCage, byRoom, quarantine: quarantineCount, quarantineAbnormal: abnormalCount });
  }
  if (req.method === "GET" && url.pathname === "/reports/upcoming") {
    const days = Number(url.searchParams.get("days") || 7);
    const roomId = url.searchParams.get("roomId") || undefined;
    const upcoming = db.animals
      .filter((a) => ACTIVE_STOCK_STATUSES.includes(a.status))
      .filter((a) => !roomId || (a.roomId || DEFAULT_ROOM_ID) === roomId)
      .flatMap((animal) => animal.observationNodes
        .filter((node) => hoursUntil(node) >= 0 && hoursUntil(node) <= days * 24)
        .map((node) => ({ animalId: animal.id, cageId: animal.cageId, roomId: animal.roomId || DEFAULT_ROOM_ID, zoneId: animal.zoneId || null, project: animal.project, projectId: animal.projectId, keeper: animal.keeper, date: node })));
    return send(res, 200, upcoming.sort((a, b) => a.date.localeCompare(b.date)));
  }
  if (req.method === "GET" && url.pathname === "/reports/health-events") {
    const filters = {
      project: url.searchParams.get("project"),
      keeper: url.searchParams.get("keeper"),
      fromDate: url.searchParams.get("fromDate"),
      toDate: url.searchParams.get("toDate"),
      roomId: url.searchParams.get("roomId") || undefined
    };
    return send(res, 200, getHealthEventStats(db, filters));
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const method = req.method;
  const url = readQuery(req);
  const pathname = url.pathname;
  const query = Object.fromEntries(url.searchParams);

  let db;
  try {
    db = await loadDb();
    if (!db) {
      await saveDb(seed);
      db = JSON.parse(JSON.stringify(seed));
    } else {
      db = migrateDb(db);
    }
  } catch (error) {
    return send(res, 500, { error: "db_init_failed", message: error.message });
  }

  if (bypassAuthPaths.includes(pathname)) {
    return send(res, 200, { ok: true, ts: new Date().toISOString() });
  }

  const auditCtx = wrapResponseForAudit(res);
  let requestBody = {};

  try {
    const authResult = await authenticate(req);
    if (!authResult.authenticated) {
      return send(res, authResult.status || 401, { error: authResult.error, message: authResult.message });
    }
    const principal = authResult.principal;
    req._principal = principal;

    const authzResult = authorize(principal, method, pathname);
    if (!authzResult.authorized) {
      return send(res, authzResult.status || 403, { error: authzResult.error, message: authzResult.message, requiredRole: authzResult.requiredRole });
    }

    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      try { requestBody = await body(req); req._auditBody = requestBody; }
      catch (e) { requestBody = {}; }
    }

    if (method === "GET" && pathname === "/") {
      await handleRoot(req, res, principal, db);
      return;
    }

    const handled = await processRoutes(req, res, url, db);
    if (!handled) {
      send(res, 404, { error: "not_found" });
    }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      send(res, 403, { error: "insufficient_permission", message: error.message, requiredRole: error.requiredRole });
    } else {
      send(res, 500, { error: error.message });
    }
  } finally {
    try {
      const resolved = resolveAuditOperation(method, pathname, req, auditCtx.body, db);
      if (resolved.shouldAudit) {
        setImmediate(async () => {
          try {
            await writeAuditLog({
              operation: resolved.operation,
              principal: req._principal || null,
              method, pathname,
              query,
              requestBody,
              responseBody: auditCtx.body,
              responseStatus: auditCtx.statusCode,
              animalIds: resolved.animalIds,
              ip: getClientIp(req),
              userAgent: req.headers["user-agent"] || null
            });
          } catch (e) {}
        });
      }
    } catch (e) {}
  }
});

async function initializeLedger() {
  try {
    const exists = await ledgerExists();
    if (!exists) {
      console.log("Event ledger not found, migrating from snapshot...");
      const result = await migrateFromSnapshot({
        operator: { role: "system", name: "server_startup", key: "system" }
      });
      console.log(`Ledger migration complete: ${result.totalEvents} events from ${result.totalAnimals} animals`);
    } else {
      const info = await getLedgerInfo();
      console.log(`Event ledger loaded: ${info.totalEvents} events, ${info.uniqueAnimals} animals`);
      if (!info.migratedFromSnapshot) {
        console.log("Ledger not marked as migrated, you may need to run POST /ledger/migrate?force=true");
      }
    }
  } catch (error) {
    console.error("Ledger initialization failed:", error.message);
    console.error("Continuing without event ledger - write operations will attempt to record events");
  }
}

server.listen(port, async () => {
  console.log(`Lab animal room API listening on http://localhost:${port}`);
  console.log(`API Key source: ${getApiKeySource()}`);
  await initializeLedger();
});
