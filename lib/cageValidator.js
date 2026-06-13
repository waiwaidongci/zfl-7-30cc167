import { getCage, countOccupancy } from "./cageData.js";

export function validateCageForAnimal(db, cageId, currentCageId) {
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

  return { valid: errors.length === 0, errors, cage };
}
