import { ANIMAL_STATUS, VALID_STATUS } from "./animalValidator.js";
import { EVENT_TYPES, recordEvent } from "./eventLedger.js";
import { getCage } from "./cageData.js";
import { DEFAULT_ROOM_ID, resolveRoomIdByCage, resolveProjectIdByName } from "./facilityData.js";

export function listAnimals(db, filters = {}) {
  let animals = db.animals || [];
  if (filters.project) animals = animals.filter((a) => a.project === filters.project);
  if (filters.cageId) animals = animals.filter((a) => a.cageId === filters.cageId);
  if (filters.status) animals = animals.filter((a) => a.status === filters.status);
  if (filters.keeper) animals = animals.filter((a) => a.keeper === filters.keeper);
  if (filters.roomId || filters.zoneId) {
    animals = animals.filter((a) => {
      const cage = getCage(db, a.cageId);
      if (!cage) return false;
      if (filters.roomId && cage.roomId !== filters.roomId) return false;
      if (filters.zoneId && cage.zoneId !== filters.zoneId) return false;
      return true;
    });
  }
  if (filters.projectId) {
    const project = (db.projects || []).find(p => p.id === filters.projectId);
    if (project) {
      animals = animals.filter(a => a.project === project.name);
    } else {
      animals = [];
    }
  }
  return animals;
}

export function getAnimal(db, id) {
  return (db.animals || []).find((a) => a.id === id) || null;
}

export function getAnimalRoomId(db, animalId) {
  const animal = getAnimal(db, animalId);
  if (!animal) return DEFAULT_ROOM_ID;
  return resolveRoomIdByCage(db, animal.cageId);
}

export async function addAnimal(db, input, options = {}) {
  if (!db.animals) db.animals = [];
  const status = input.status && VALID_STATUS.includes(input.status) ? input.status : ANIMAL_STATUS.QUARANTINE;
  const cage = input.cageId ? getCage(db, input.cageId) : null;
  const roomId = cage?.roomId || input.roomId || DEFAULT_ROOM_ID;
  const zoneId = cage?.zoneId || input.zoneId || null;
  const projectId = input.projectId || resolveProjectIdByName(db, input.project);
  const animal = {
    id: input.id || `ani-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    strain: input.strain,
    cageId: input.cageId,
    roomId,
    zoneId,
    projectId,
    sex: input.sex,
    birthDate: input.birthDate,
    project: input.project,
    keeper: input.keeper,
    status,
    observationNodes: input.observationNodes || [],
    notes: [],
    moves: [],
    quarantineRecords: input.quarantineRecords || [],
    enteredQuarantineAt: status === ANIMAL_STATUS.QUARANTINE ? new Date().toISOString() : null,
    fatherId: input.fatherId || null,
    motherId: input.motherId || null,
    litterId: input.litterId || null,
    breedingInfo: input.breedingInfo || null
  };
  db.animals.push(animal);

  if (!options.skipEvent) {
    await recordEvent(EVENT_TYPES.ANIMAL_CREATED, {
      id: animal.id,
      strain: animal.strain,
      cageId: animal.cageId,
      sex: animal.sex,
      birthDate: animal.birthDate,
      project: animal.project,
      keeper: animal.keeper,
      initialStatus: animal.status,
      fatherId: animal.fatherId,
      motherId: animal.motherId,
      litterId: animal.litterId,
      source: options.source || "api"
    }, {
      animalId: animal.id,
      operator: options.operator || null,
      snapshotAfter: animal,
      metadata: options.metadata || null
    });
  }

  return animal;
}

export async function addNote(db, animalId, input, options = {}) {
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

  if (!options.skipEvent) {
    await recordEvent(EVENT_TYPES.ANIMAL_NOTE_ADDED, {
      noteId: note.id,
      date: note.date,
      weight: note.weight,
      condition: note.condition,
      type: input.type || "general"
    }, {
      animalId,
      operator: options.operator || null,
      snapshotAfter: animal,
      metadata: options.metadata || null
    });
  }

  return note;
}

export async function moveAnimal(db, animalId, targetCageId, reason, options = {}) {
  const animal = getAnimal(db, animalId);
  if (!animal) return null;
  const targetCage = getCage(db, targetCageId);
  const move = {
    id: `move-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    from: animal.cageId,
    to: targetCageId,
    fromRoomId: animal.roomId || null,
    toRoomId: targetCage?.roomId || null,
    movedAt: new Date().toISOString(),
    reason: reason || "笼位调整"
  };
  animal.cageId = targetCageId;
  animal.roomId = targetCage?.roomId || DEFAULT_ROOM_ID;
  animal.zoneId = targetCage?.zoneId || null;
  animal.moves.push(move);

  if (!options.skipEvent) {
    await recordEvent(EVENT_TYPES.ANIMAL_MOVED, {
      moveId: move.id,
      fromCage: move.from,
      toCage: move.to,
      reason: move.reason
    }, {
      animalId,
      operator: options.operator || null,
      snapshotAfter: animal,
      metadata: options.metadata || null
    });
  }

  return animal;
}

export async function removeAnimal(db, animalId, reason, options = {}) {
  const animal = getAnimal(db, animalId);
  if (!animal) return null;
  animal.status = ANIMAL_STATUS.REMOVED;
  animal.removedAt = new Date().toISOString();
  animal.removeReason = reason || "移出";

  if (!options.skipEvent) {
    await recordEvent(EVENT_TYPES.ANIMAL_REMOVED, {
      reason: animal.removeReason,
      removedAt: animal.removedAt
    }, {
      animalId,
      operator: options.operator || null,
      snapshotAfter: animal,
      metadata: options.metadata || null
    });
  }

  return animal;
}

export async function addQuarantineRecord(db, animalId, input, options = {}) {
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

  if (!options.skipEvent) {
    await recordEvent(EVENT_TYPES.ANIMAL_QUARANTINE_RECORD, {
      recordId: record.id,
      date: record.date,
      temperature: record.temperature,
      weight: record.weight,
      condition: record.condition,
      symptoms: record.symptoms,
      isAbnormal: record.isAbnormal,
      notes: record.notes,
      examiner: record.examiner
    }, {
      animalId,
      operator: options.operator || null,
      snapshotAfter: animal,
      metadata: options.metadata || null
    });
  }

  return record;
}

export async function releaseAnimal(db, animalId, input, options = {}) {
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
    const targetCage = getCage(db, input.targetCageId);
    const move = {
      id: `move-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      from: animal.cageId,
      to: input.targetCageId,
      fromRoomId: animal.roomId || null,
      toRoomId: targetCage?.roomId || null,
      movedAt: approval.approvedAt,
      reason: "检疫放行"
    };
    animal.cageId = input.targetCageId;
    animal.roomId = targetCage?.roomId || DEFAULT_ROOM_ID;
    animal.zoneId = targetCage?.zoneId || null;
    animal.moves.push(move);
  }

  if (!options.skipEvent) {
    await recordEvent(EVENT_TYPES.ANIMAL_QUARANTINE_RELEASED, {
      approvalId: approval.id,
      approver: approval.approver,
      targetCageId: approval.targetCageId,
      notes: approval.notes,
      includedMove: input?.targetCageId && input.targetCageId !== animal.enteredQuarantineAt ? input.targetCageId : null
    }, {
      animalId,
      operator: options.operator || null,
      snapshotAfter: animal,
      metadata: options.metadata || null
    });
  }

  return animal;
}

export async function markQuarantineAbnormal(db, animalId, input, options = {}) {
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

  if (!options.skipEvent) {
    await recordEvent(EVENT_TYPES.ANIMAL_QUARANTINE_ABNORMAL, {
      reason: animal.abnormalReason,
      handler: animal.abnormalHandler,
      notes: animal.abnormalNotes,
      markedAt: animal.abnormalMarkedAt
    }, {
      animalId,
      operator: options.operator || null,
      snapshotAfter: animal,
      metadata: options.metadata || null
    });
  }

  return animal;
}

export async function resolveQuarantineAbnormal(db, animalId, input, options = {}) {
  const animal = getAnimal(db, animalId);
  if (!animal) return null;
  if (animal.status !== ANIMAL_STATUS.QUARANTINE_ABNORMAL) {
    return { error: "invalid_status", message: `当前状态 ${animal.status} 无法解除异常` };
  }
  animal.status = ANIMAL_STATUS.QUARANTINE;
  animal.abnormalResolvedAt = new Date().toISOString();
  animal.abnormalResolution = input?.resolution || "已处理恢复检疫";
  animal.abnormalResolver = input?.resolver || animal.keeper;

  if (!options.skipEvent) {
    await recordEvent(EVENT_TYPES.ANIMAL_QUARANTINE_RESOLVED, {
      resolution: animal.abnormalResolution,
      resolver: animal.abnormalResolver,
      resolvedAt: animal.abnormalResolvedAt
    }, {
      animalId,
      operator: options.operator || null,
      snapshotAfter: animal,
      metadata: options.metadata || null
    });
  }

  return animal;
}

export async function batchAddAnimals(db, animalsInput, options = {}) {
  const results = [];
  const eventsToRecord = [];

  for (const input of animalsInput) {
    const animal = await addAnimal(db, input, { ...options, skipEvent: true });
    results.push(animal);

    if (!options.skipEvent) {
      eventsToRecord.push({
        eventType: EVENT_TYPES.ANIMAL_CREATED,
        payload: {
          id: animal.id,
          strain: animal.strain,
          cageId: animal.cageId,
          sex: animal.sex,
          birthDate: animal.birthDate,
          project: animal.project,
          keeper: animal.keeper,
          initialStatus: animal.status,
          fatherId: animal.fatherId,
          motherId: animal.motherId,
          litterId: animal.litterId,
          batchImported: true
        },
        animalId: animal.id,
        snapshotAfter: animal
      });
    }
  }

  if (!options.skipEvent && eventsToRecord.length > 0) {
    const recordOptions = {
      operator: options.operator || null,
      metadata: options.metadata || null
    };
    for (const evt of eventsToRecord) {
      await recordEvent(evt.eventType, evt.payload, {
        animalId: evt.animalId,
        snapshotAfter: evt.snapshotAfter,
        ...recordOptions
      });
    }

    await recordEvent(EVENT_TYPES.ANIMAL_BATCH_IMPORTED, {
      count: results.length,
      animalIds: results.map(a => a.id),
      source: options.source || "api"
    }, recordOptions);
  }

  return results;
}

export function getAnimalIds(db) {
  return (db.animals || []).map((a) => a.id);
}
