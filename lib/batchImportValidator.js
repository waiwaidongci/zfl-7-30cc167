import { validateAnimalFields } from "./animalValidator.js";
import { getCage, countOccupancy } from "./cageData.js";
import { getAnimalIds } from "./animalData.js";
import { validateCageForAnimal } from "./cageValidator.js";

export function validateBatchImport(db, animalsInput, principal = null) {
  const result = {
    total: animalsInput.length,
    importable: 0,
    fieldErrors: [],
    duplicateIds: [],
    missingCages: [],
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
    } else if (cage.status === "disabled") {
      if (!missingCageSet.has(cageId)) {
        missingCageSet.add(cageId);
        result.missingCages.push({
          cageId,
          message: `笼位 ${cageId} 已停用`
        });
      }
    } else {
      cageValidItems.push({ index, item, cage });
    }
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
      result.capacityConflicts.push({
        cageId,
        currentOccupancy,
        batchCount,
        capacity: cage.capacity,
        afterImport,
        overflow: afterImport - cage.capacity,
        message: `笼位 ${cageId} 容量不足：当前 ${currentOccupancy} 只，导入 ${batchCount} 只，共 ${afterImport}/${cage.capacity}，超出 ${afterImport - cage.capacity} 只`
      });
    }
  }

  const duplicateIdSet = new Set(
    result.duplicateIds.filter(d => d.type === "duplicate_in_batch").map(d => d.id)
  );
  const dbDuplicateIdSet = new Set(
    result.duplicateIds.filter(d => d.type === "exists_in_db").map(d => d.id)
  );

  for (const { index, item, cage } of cageValidItems) {
    const id = item.id;
    const hasIdConflict = id && (duplicateIdSet.has(id) || dbDuplicateIdSet.has(id));
    const hasCapacityConflict = capacityConflictSet.has(item.cageId);

    if (!hasIdConflict && !hasCapacityConflict) {
      result.validItems.push({
        index,
        id: id || null,
        strain: item.strain,
        cageId: item.cageId,
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
