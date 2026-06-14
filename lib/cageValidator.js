import { getCage, countOccupancy } from "./cageData.js";
import { validateCrossRoomMove, validateRoomAccess } from "./permissions.js";
import { ROLES } from "./apiKeys.js";

export function validateCageForAnimal(db, cageId, currentCageId, principal = null) {
  const errors = [];

  const cage = getCage(db, cageId);
  if (!cage) {
    errors.push({ code: "cage_not_found", message: `笼位 ${cageId} 不存在` });
    return { valid: false, errors };
  }

  if (cage.status === "disabled") {
    errors.push({ code: "cage_disabled", message: `笼位 ${cageId} 已停用` });
  }

  let occupancy = countOccupancy(db, cageId);
  if (currentCageId && currentCageId === cageId) occupancy -= 1;
  if (occupancy >= cage.capacity) {
    errors.push({
      code: "cage_full",
      message: `笼位 ${cageId} 已满（${occupancy}/${cage.capacity}）`
    });
  }

  if (principal && principal.role !== ROLES.ADMIN) {
    const roomCheck = validateRoomAccess(principal, cage.roomId);
    if (!roomCheck.authorized) {
      errors.push({
        code: "cage_room_no_permission",
        message: `无权使用房间 ${cage.roomId} 的笼位：${cageId}`
      });
    }

    if (currentCageId && currentCageId !== cageId) {
      const crossRoomCheck = validateCrossRoomMove(db, principal, currentCageId, cageId);
      if (!crossRoomCheck.valid) {
        errors.push({
          code: crossRoomCheck.error,
          message: crossRoomCheck.message
        });
      }
    }
  }

  return { valid: errors.length === 0, errors, cage };
}
