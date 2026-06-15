import { validateAnimalFields } from "./animalValidator.js";
import { getCage, countOccupancy } from "./cageData.js";
import { getAnimalIds } from "./animalData.js";
import { validateCageForAnimal } from "./cageValidator.js";
import {
  getRoom,
  getZone,
  getProject,
  resolveRoomIdByCage,
  resolveProjectIdByName,
  DEFAULT_ROOM_ID,
  DEFAULT_ZONE_ID,
  DEFAULT_PROJECT_ID
} from "./facilityData.js";
import { validateRoomAccess, validateProjectAccess } from "./permissions.js";

function resolveZoneIdByName(db, zoneName, roomId) {
  if (!zoneName) return null;
  const zones = db.zones || [];
  const zone = zones.find(z => {
    if (roomId) return z.name === zoneName && z.roomId === roomId;
    return z.name === zoneName;
  });
  return zone?.id || null;
}

export function validateBatchImport(db, animalsInput, principal = null) {
  const result = {
    total: animalsInput.length,
    importable: 0,
    fieldErrors: [],
    duplicateIds: [],
    missingCages: [],
    missingRooms: [],
    missingZones: [],
    missingProjects: [],
    roomMismatches: [],
    zoneMismatches: [],
    projectMismatches: [],
    projectPermissionErrors: [],
    capacityConflicts: [],
    roomPermissionErrors: [],
    validItems: []
  };

  if (!Array.isArray(animalsInput)) {
    return {
      ...result,
      fieldErrors: [{
        index: -1,
        errors: [{ code: "invalid_input", message: "请求体必须是动物数组" }]
      }]
    };
  }

  const existingIds = new Set(getAnimalIds(db));
  const batchIdMap = new Map();
  const fieldValidItems = [];

  for (let i = 0; i < animalsInput.length; i++) {
    const item = animalsInput[i];
    const validation = validateAnimalFields(item);

    if (!validation.valid) {
      result.fieldErrors.push({
        index: i,
        id: item.id || null,
        errors: validation.errors
      });
    } else {
      fieldValidItems.push({ index: i, item });
    }
  }

  for (const { index, item } of fieldValidItems) {
    const id = item.id;
    if (id) {
      if (existingIds.has(id)) {
        result.duplicateIds.push({
          index,
          id,
          type: "exists_in_db",
          message: `动物 ID ${id} 已存在于数据库中`
        });
      } else if (batchIdMap.has(id)) {
        const firstIndex = batchIdMap.get(id);
        if (!result.duplicateIds.find(d => d.id === id && d.type === "duplicate_in_batch")) {
          result.duplicateIds.push({
            index: firstIndex,
            id,
            type: "duplicate_in_batch",
            message: `动物 ID ${id} 在导入批次中重复出现`
          });
        }
        result.duplicateIds.push({
          index,
          id,
          type: "duplicate_in_batch",
          message: `动物 ID ${id} 在导入批次中重复出现`
        });
      } else {
        batchIdMap.set(id, index);
      }
    }
  }

  const cageValidItems = [];
  const missingCageSet = new Set();
  const missingRoomSet = new Set();
  const missingZoneSet = new Set();
  const missingProjectSet = new Set();
  const roomMismatchSet = new Set();
  const zoneMismatchSet = new Set();
  const projectMismatchSet = new Set();
  const projectPermissionErrorSet = new Set();

  for (const { index, item } of fieldValidItems) {
    const cageId = item.cageId;
    const cageValidation = validateCageForAnimal(db, cageId, null, principal);
    const hasPermissionError = cageValidation.errors.some(e =>
      e.code === "cage_room_no_permission" || e.code === "target_room_access_denied"
    );

    if (hasPermissionError) {
      result.roomPermissionErrors.push({
        index,
        id: item.id || null,
        cageId,
        errors: cageValidation.errors.filter(e =>
          e.code === "cage_room_no_permission" || e.code === "target_room_access_denied"
        )
      });
      continue;
    }

    const cage = getCage(db, cageId);
    if (!cage) {
      if (!missingCageSet.has(cageId)) {
        missingCageSet.add(cageId);
        result.missingCages.push({
          cageId,
          message: `笼位 ${cageId} 不存在`
        });
      }
      continue;
    }

    if (cage.status === "disabled") {
      if (!missingCageSet.has(cageId)) {
        missingCageSet.add(cageId);
        result.missingCages.push({
          cageId,
          message: `笼位 ${cageId} 已停用`
        });
      }
      continue;
    }

    const cageRoomId = cage.roomId || DEFAULT_ROOM_ID;
    const cageZoneId = cage.zoneId || DEFAULT_ZONE_ID;

    const cageRoom = getRoom(db, cageRoomId);
    const cageZone = getZone(db, cageZoneId);

    let resolvedRoomId = cageRoomId;
    let resolvedZoneId = cageZoneId;
    let resolvedProjectId = item.projectId || resolveProjectIdByName(db, item.project);

    if (item.roomId && item.roomId !== cageRoomId) {
      const inputRoom = getRoom(db, item.roomId);
      if (!inputRoom) {
        if (!missingRoomSet.has(item.roomId)) {
          missingRoomSet.add(item.roomId);
          result.missingRooms.push({
            index,
            id: item.id || null,
            roomId: item.roomId,
            message: `指定的房间 ${item.roomId} 不存在`
          });
        }
      } else {
        const key = `${index}:${item.roomId}:${cageRoomId}`;
        if (!roomMismatchSet.has(key)) {
          roomMismatchSet.add(key);
          result.roomMismatches.push({
            index,
            id: item.id || null,
            inputRoomId: item.roomId,
            inputRoomName: inputRoom.name,
            cageRoomId,
            cageRoomName: cageRoom?.name || cageRoomId,
            cageId,
            message: `指定的房间 ${inputRoom.name || item.roomId} 与笼位 ${cageId} 所属房间 ${cageRoom?.name || cageRoomId} 不一致，将以笼位所属房间为准`
          });
        }
      }
    }

    if (item.zoneId && item.zoneId !== cageZoneId) {
      const inputZone = getZone(db, item.zoneId);
      if (!inputZone) {
        if (!missingZoneSet.has(item.zoneId)) {
          missingZoneSet.add(item.zoneId);
          result.missingZones.push({
            index,
            id: item.id || null,
            zoneId: item.zoneId,
            message: `指定的区域 ${item.zoneId} 不存在`
          });
        }
      } else {
        const key = `${index}:${item.zoneId}:${cageZoneId}`;
        if (!zoneMismatchSet.has(key)) {
          zoneMismatchSet.add(key);
          result.zoneMismatches.push({
            index,
            id: item.id || null,
            inputZoneId: item.zoneId,
            inputZoneName: inputZone.name,
            cageZoneId,
            cageZoneName: cageZone?.name || cageZoneId,
            cageId,
            message: `指定的区域 ${inputZone.name || item.zoneId} 与笼位 ${cageId} 所属区域 ${cageZone?.name || cageZoneId} 不一致，将以笼位所属区域为准`
          });
        }
      }
    }

    if (item.projectId) {
      const inputProject = getProject(db, item.projectId);
      if (!inputProject) {
        if (!missingProjectSet.has(item.projectId)) {
          missingProjectSet.add(item.projectId);
          result.missingProjects.push({
            index,
            id: item.id || null,
            projectId: item.projectId,
            message: `指定的项目 ${item.projectId} 不存在`
          });
        }
      } else {
        const resolvedByNameId = resolveProjectIdByName(db, item.project);
        if (resolvedByNameId && resolvedByNameId !== item.projectId) {
          const nameProject = getProject(db, resolvedByNameId);
          const key = `${index}:${item.projectId}:${resolvedByNameId}`;
          if (!projectMismatchSet.has(key)) {
            projectMismatchSet.add(key);
            result.projectMismatches.push({
              index,
              id: item.id || null,
              inputProjectId: item.projectId,
              inputProjectName: inputProject.name,
              nameProjectId: resolvedByNameId,
              nameProjectName: nameProject?.name || item.project,
              project: item.project,
              message: `指定的项目ID ${inputProject.name || item.projectId} 与项目名称 ${item.project} (${nameProject?.name || resolvedByNameId}) 不一致，将以项目ID为准`
            });
          }
        }
        resolvedProjectId = item.projectId;
      }
    }

    if (principal && resolvedProjectId && principal.role !== "admin") {
      const projPermissionCheck = validateProjectAccess(principal, resolvedProjectId);
      if (!projPermissionCheck.authorized) {
        const key = `${index}:${resolvedProjectId}`;
        if (!projectPermissionErrorSet.has(key)) {
          projectPermissionErrorSet.add(key);
          result.projectPermissionErrors.push({
            index,
            id: item.id || null,
            projectId: resolvedProjectId,
            projectName: getProject(db, resolvedProjectId)?.name || resolvedProjectId,
            errors: [{
              code: "project_access_denied",
              message: projPermissionCheck.message
            }]
          });
        }
        continue;
      }
    }

    cageValidItems.push({
      index,
      item,
      cage,
      resolvedRoomId,
      resolvedZoneId,
      resolvedProjectId,
      cageRoomName: cageRoom?.name || cageRoomId,
      cageZoneName: cageZone?.name || cageZoneId
    });
  }

  const cageCountMap = new Map();
  for (const { item } of cageValidItems) {
    const cageId = item.cageId;
    cageCountMap.set(cageId, (cageCountMap.get(cageId) || 0) + 1);
  }

  const capacityConflictSet = new Set();
  for (const [cageId, batchCount] of cageCountMap.entries()) {
    const currentOccupancy = countOccupancy(db, cageId);
    const cage = getCage(db, cageId);
    const afterImport = currentOccupancy + batchCount;

    if (afterImport > cage.capacity) {
      capacityConflictSet.add(cageId);
      const cageRoom = getRoom(db, cage.roomId);
      result.capacityConflicts.push({
        cageId,
        roomId: cage.roomId,
        roomName: cageRoom?.name || cage.roomId,
        currentOccupancy,
        batchCount,
        capacity: cage.capacity,
        afterImport,
        overflow: afterImport - cage.capacity,
        message: `笼位 ${cageId}（房间：${cageRoom?.name || cage.roomId}）容量不足：当前 ${currentOccupancy} 只，导入 ${batchCount} 只，共 ${afterImport}/${cage.capacity}，超出 ${afterImport - cage.capacity} 只`
      });
    }
  }

  const duplicateIdSet = new Set(
    result.duplicateIds.filter(d => d.type === "duplicate_in_batch").map(d => d.id)
  );
  const dbDuplicateIdSet = new Set(
    result.duplicateIds.filter(d => d.type === "exists_in_db").map(d => d.id)
  );

  for (const { index, item, cage, resolvedRoomId, resolvedZoneId, resolvedProjectId, cageRoomName, cageZoneName } of cageValidItems) {
    const id = item.id;
    const hasIdConflict = id && (duplicateIdSet.has(id) || dbDuplicateIdSet.has(id));
    const hasCapacityConflict = capacityConflictSet.has(item.cageId);

    if (!hasIdConflict && !hasCapacityConflict) {
      const project = getProject(db, resolvedProjectId);
      result.validItems.push({
        index,
        id: id || null,
        strain: item.strain,
        cageId: item.cageId,
        roomId: resolvedRoomId,
        roomName: cageRoomName,
        zoneId: resolvedZoneId,
        zoneName: cageZoneName,
        projectId: resolvedProjectId,
        projectName: project?.name || item.project,
        sex: item.sex,
        birthDate: item.birthDate,
        project: item.project,
        keeper: item.keeper
      });
    }
  }

  result.importable = result.validItems.length;

  return result;
}

export function getValidImportItems(db, animalsInput, principal = null) {
  const validation = validateBatchImport(db, animalsInput, principal);
  const validIndexes = new Set(validation.validItems.map(v => v.index));
  return animalsInput.filter((_, i) => validIndexes.has(i));
}
