import { ANIMAL_STATUS, VALID_STATUS } from "./animalValidator.js";

export function listAnimals(db, filters = {}) {
  let animals = db.animals || [];
  if (filters.project) animals = animals.filter((a) => a.project === filters.project);
  if (filters.cageId) animals = animals.filter((a) => a.cageId === filters.cageId);
  if (filters.status) animals = animals.filter((a) => a.status === filters.status);
  return animals;
}

export function getAnimal(db, id) {
  return (db.animals || []).find((a) => a.id === id) || null;
}

export function addAnimal(db, input) {
  if (!db.animals) db.animals = [];
  const status = input.status && VALID_STATUS.includes(input.status) ? input.status : ANIMAL_STATUS.QUARANTINE;
  const animal = {
    id: input.id || `ani-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    strain: input.strain,
    cageId: input.cageId,
    sex: input.sex,
    birthDate: input.birthDate,
    project: input.project,
    keeper: input.keeper,
    status,
    observationNodes: input.observationNodes || [],
    notes: [],
    moves: [],
    quarantineRecords: input.quarantineRecords || [],
    enteredQuarantineAt: status === ANIMAL_STATUS.QUARANTINE ? new Date().toISOString() : null
  };
  db.animals.push(animal);
  return animal;
}

export function addNote(db, animalId, input) {
  const animal = getAnimal(db, animalId);
  if (!animal) return null;
  const note = {
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date: input.date || new Date().toISOString().slice(0, 10),
    weight: input.weight,
    condition: input.condition,
    keeper: input.keeper || animal.keeper
  };
  animal.notes.push(note);
  return note;
}

export function moveAnimal(db, animalId, targetCageId, reason) {
  const animal = getAnimal(db, animalId);
  if (!animal) return null;
  const move = {
    id: `move-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    from: animal.cageId,
    to: targetCageId,
    movedAt: new Date().toISOString(),
    reason: reason || "笼位调整"
  };
  animal.cageId = targetCageId;
  animal.moves.push(move);
  return animal;
}

export function removeAnimal(db, animalId, reason) {
  const animal = getAnimal(db, animalId);
  if (!animal) return null;
  animal.status = ANIMAL_STATUS.REMOVED;
  animal.removedAt = new Date().toISOString();
  animal.removeReason = reason || "移出";
  return animal;
}

export function addQuarantineRecord(db, animalId, input) {
  const animal = getAnimal(db, animalId);
  if (!animal) return null;
  if (!animal.quarantineRecords) animal.quarantineRecords = [];
  const record = {
    id: `qr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date: input.date || new Date().toISOString().slice(0, 10),
    temperature: input.temperature,
    weight: input.weight,
    condition: input.condition,
    symptoms: input.symptoms || [],
    isAbnormal: input.isAbnormal || false,
    notes: input.notes || "",
    examiner: input.examiner || animal.keeper,
    createdAt: new Date().toISOString()
  };
  animal.quarantineRecords.push(record);
  if (record.isAbnormal && animal.status === ANIMAL_STATUS.QUARANTINE) {
    animal.status = ANIMAL_STATUS.QUARANTINE_ABNORMAL;
  }
  return record;
}

export function releaseAnimal(db, animalId, input) {
  const animal = getAnimal(db, animalId);
  if (!animal) return null;
  if (animal.status !== ANIMAL_STATUS.QUARANTINE && animal.status !== ANIMAL_STATUS.QUARANTINE_ABNORMAL) {
    return { error: "invalid_status", message: `当前状态 ${animal.status} 无法放行` };
  }
  const approval = {
    id: `qa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    approvedAt: new Date().toISOString(),
    approver: input?.approver || animal.keeper,
    targetCageId: input?.targetCageId || animal.cageId,
    notes: input?.notes || ""
  };
  animal.status = ANIMAL_STATUS.RELEASED;
  animal.quarantineReleasedAt = approval.approvedAt;
  animal.quarantineApproval = approval;
  if (input?.targetCageId && input.targetCageId !== animal.cageId) {
    const move = {
      id: `move-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      from: animal.cageId,
      to: input.targetCageId,
      movedAt: approval.approvedAt,
      reason: "检疫放行"
    };
    animal.cageId = input.targetCageId;
    animal.moves.push(move);
  }
  return animal;
}

export function markQuarantineAbnormal(db, animalId, input) {
  const animal = getAnimal(db, animalId);
  if (!animal) return null;
  if (animal.status !== ANIMAL_STATUS.QUARANTINE && animal.status !== ANIMAL_STATUS.QUARANTINE_ABNORMAL) {
    return { error: "invalid_status", message: `当前状态 ${animal.status} 无法标记为异常` };
  }
  animal.status = ANIMAL_STATUS.QUARANTINE_ABNORMAL;
  animal.abnormalMarkedAt = new Date().toISOString();
  animal.abnormalReason = input?.reason || "检疫异常";
  animal.abnormalHandler = input?.handler || animal.keeper;
  animal.abnormalNotes = input?.notes || "";
  return animal;
}

export function resolveQuarantineAbnormal(db, animalId, input) {
  const animal = getAnimal(db, animalId);
  if (!animal) return null;
  if (animal.status !== ANIMAL_STATUS.QUARANTINE_ABNORMAL) {
    return { error: "invalid_status", message: `当前状态 ${animal.status} 无法解除异常` };
  }
  animal.status = ANIMAL_STATUS.QUARANTINE;
  animal.abnormalResolvedAt = new Date().toISOString();
  animal.abnormalResolution = input?.resolution || "已处理恢复检疫";
  animal.abnormalResolver = input?.resolver || animal.keeper;
  return animal;
}

export function batchAddAnimals(db, animalsInput) {
  const results = [];
  for (const input of animalsInput) {
    const animal = addAnimal(db, input);
    results.push(animal);
  }
  return results;
}

export function getAnimalIds(db) {
  return (db.animals || []).map((a) => a.id);
}
