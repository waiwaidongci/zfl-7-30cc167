import { getAnimal } from "./animalData.js";
import { getCage } from "./cageData.js";
import { DEFAULT_ROOM_ID, DEFAULT_PROJECT_ID, resolveProjectIdByName } from "./facilityData.js";

export function resolveTargetOwnership(db, { targetType, targetId }) {
  if (targetType === "cage" && targetId) {
    const cage = getCage(db, targetId);
    return {
      roomId: cage?.roomId || null,
      zoneId: cage?.zoneId || null,
      projectId: null,
      project: null
    };
  }

  if (targetType === "animal" && targetId) {
    const animal = getAnimal(db, targetId);
    if (!animal) {
      return { roomId: null, zoneId: null, projectId: null, project: null };
    }
    const cage = animal.cageId ? getCage(db, animal.cageId) : null;
    return {
      roomId: cage?.roomId || animal.roomId || null,
      zoneId: cage?.zoneId || animal.zoneId || null,
      projectId: animal.projectId || null,
      project: animal.project || null
    };
  }

  return { roomId: null, zoneId: null, projectId: null, project: null };
}

export function resolveTargetOwnershipWithDefaults(db, { targetType, targetId }) {
  const raw = resolveTargetOwnership(db, { targetType, targetId });
  return {
    roomId: raw.roomId || DEFAULT_ROOM_ID,
    zoneId: raw.zoneId || null,
    projectId: raw.projectId || (raw.project ? resolveProjectIdByName(db, raw.project) : null),
    project: raw.project || null
  };
}

export function resolveOperationOwnership(db, operation) {
  const opType = operation.operationType;
  const payload = operation.payload || {};

  if (opType === "animal_note" || opType === "animal_move") {
    if (payload.animalId) {
      return resolveTargetOwnership(db, { targetType: "animal", targetId: payload.animalId });
    }
  } else if (opType === "feeding_record") {
    if (payload.targetType && payload.targetId) {
      return resolveTargetOwnership(db, { targetType: payload.targetType, targetId: payload.targetId });
    }
  } else if (opType === "cage_abnormal") {
    if (payload.cageId) {
      return resolveTargetOwnership(db, { targetType: "cage", targetId: payload.cageId });
    }
  }

  return { roomId: null, zoneId: null, projectId: null, project: null };
}
