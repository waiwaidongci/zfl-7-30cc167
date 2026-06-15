import { send, body, saveDb } from "../lib/helpers.js";
import { listAnimals, getAnimal, addAnimal, addNote, moveAnimal, removeAnimal, batchAddAnimals, addQuarantineRecord, releaseAnimal, markQuarantineAbnormal, resolveQuarantineAbnormal } from "../lib/animalData.js";
import { validateAnimalFull, validateAnimalFields, ANIMAL_STATUS } from "../lib/animalValidator.js";
import { validateCageForAnimal } from "../lib/cageValidator.js";
import { validateBatchImport, getValidImportItems } from "../lib/batchImportValidator.js";
import { detectAndCreateEvent, detectAbnormalKeywords, calculateWeightChange, findMergeableEvent, mergeToExistingEvent, createHealthEvent, EVENT_SEVERITY, inferSeverityFromKeywords } from "../lib/healthEventData.js";
import { checkRoomWriteAccess } from "../lib/permissions.js";

export async function handleAnimalRoutes(req, res, url, db) {
  if (req.method === "GET" && url.pathname === "/animals") {
    const filters = {
      project: url.searchParams.get("project"),
      projectId: url.searchParams.get("projectId") || undefined,
      cageId: url.searchParams.get("cageId"),
      status: url.searchParams.get("status"),
      roomId: url.searchParams.get("roomId") || undefined,
      zoneId: url.searchParams.get("zoneId") || undefined,
      keeper: url.searchParams.get("keeper") || undefined
    };
    send(res, 200, listAnimals(db, filters));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/animals/import/preview") {
    await handleImportPreview(req, res, db);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/animals/import") {
    await handleImportConfirm(req, res, db);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/animals") {
    await handleAddAnimal(req, res, db);
    await saveDb(db);
    return true;
  }

  const quarantineMatch = url.pathname.match(/^\/animals\/([^/]+)\/quarantine\/(record|release|abnormal|resolve)$/);
  if (quarantineMatch && req.method === "POST") {
    const [, id, subAction] = quarantineMatch;
    if (subAction === "record") {
      await handleQuarantineRecord(req, res, db, id);
    } else if (subAction === "release") {
      await handleQuarantineRelease(req, res, db, id);
    } else if (subAction === "abnormal") {
      await handleQuarantineAbnormal(req, res, db, id);
    } else if (subAction === "resolve") {
      await handleQuarantineResolve(req, res, db, id);
    }
    await saveDb(db);
    return true;
  }

  const animalMatch = url.pathname.match(/^\/animals\/([^/]+)(?:\/([^/]+))?$/);
  if (animalMatch) {
    const [, id, action] = animalMatch;

    if (req.method === "GET" && !action) {
      const animal = getAnimal(db, id);
      if (!animal) { send(res, 404, { error: "animal_not_found" }); return true; }
      send(res, 200, animal);
      return true;
    }

    if (req.method === "POST" && action === "notes") {
      await handleAddNote(req, res, db, id);
      await saveDb(db);
      return true;
    }

    if (req.method === "POST" && action === "move") {
      await handleMoveAnimal(req, res, db, id);
      await saveDb(db);
      return true;
    }

    if (req.method === "POST" && action === "remove") {
      await handleRemoveAnimal(req, res, db, id);
      await saveDb(db);
      return true;
    }
  }

  return false;
}

async function handleAddAnimal(req, res, db) {
  const input = await body(req);
  const fieldValidation = validateAnimalFields(input);
  if (!fieldValidation.valid) {
    return send(res, 400, { error: "field_validation_failed", details: fieldValidation.errors });
  }

  if (input.id && getAnimal(db, input.id)) {
    return send(res, 409, { error: "animal_id_exists" });
  }

  const cageValidation = validateCageForAnimal(db, input.cageId, null, req._principal);
  if (!cageValidation.valid) {
    return send(res, 422, { error: "cage_validation_failed", details: cageValidation.errors });
  }

  const animal = await addAnimal(db, input, { operator: req._principal });
  send(res, 201, animal);
}

async function handleAddNote(req, res, db, animalId) {
  const animal = getAnimal(db, animalId);
  if (!animal) { send(res, 404, { error: "animal_not_found" }); return; }

  const roomCheck = checkRoomWriteAccess(req._principal, animal.roomId);
  if (!roomCheck.authorized) {
    return send(res, 403, { error: roomCheck.error, message: roomCheck.message });
  }

  const input = await body(req);
  const note = await addNote(db, animalId, input, { operator: req._principal });

  let healthResult = null;
  const condition = input.condition || "";
  const weight = input.weight;
  if (condition || weight != null) {
    healthResult = detectAndCreateEvent(db, {
      animalId,
      condition,
      weight,
      source: "animal_note",
      sourceRecordId: note.id,
      keeper: input.keeper || animal.keeper
    });
  }

  await saveDb(db);

  if (healthResult && healthResult.created) {
    send(res, 201, {
      ...note,
      healthEvent: {
        created: healthResult.created,
        merged: healthResult.merged || false,
        eventId: healthResult.event ? healthResult.event.id : null,
        event: healthResult.event || null
      }
    });
  } else {
    send(res, 201, note);
  }
}

async function handleMoveAnimal(req, res, db, animalId) {
  const animal = getAnimal(db, animalId);
  if (!animal) { send(res, 404, { error: "animal_not_found" }); return; }

  const input = await body(req);
  if (!input.cageId) {
    return send(res, 400, { error: "cageId_required" });
  }

  const validation = validateCageForAnimal(db, input.cageId, animal.cageId, req._principal);
  if (!validation.valid) {
    return send(res, 422, { error: "cage_validation_failed", details: validation.errors });
  }

  const updated = await moveAnimal(db, animalId, input.cageId, input.reason, { operator: req._principal });
  send(res, 200, updated);
}

async function handleRemoveAnimal(req, res, db, animalId) {
  const animal = getAnimal(db, animalId);
  if (!animal) { send(res, 404, { error: "animal_not_found" }); return; }

  const roomCheck = checkRoomWriteAccess(req._principal, animal.roomId);
  if (!roomCheck.authorized) {
    return send(res, 403, { error: roomCheck.error, message: roomCheck.message });
  }

  const input = await body(req);
  const updated = await removeAnimal(db, animalId, input.reason, { operator: req._principal });
  send(res, 200, updated);
}

async function handleImportPreview(req, res, db) {
  const input = await body(req);

  if (!Array.isArray(input)) {
    return send(res, 400, {
      error: "invalid_input",
      message: "请求体必须是动物数组"
    });
  }

  if (input.length === 0) {
    return send(res, 400, {
      error: "empty_batch",
      message: "导入批次不能为空"
    });
  }

  const preview = validateBatchImport(db, input, req._principal);
  send(res, 200, {
    total: preview.total,
    importable: preview.importable,
    fieldErrors: preview.fieldErrors,
    duplicateIds: preview.duplicateIds,
    missingCages: preview.missingCages,
    missingRooms: preview.missingRooms,
    missingZones: preview.missingZones,
    missingProjects: preview.missingProjects,
    roomMismatches: preview.roomMismatches,
    zoneMismatches: preview.zoneMismatches,
    projectMismatches: preview.projectMismatches,
    projectPermissionErrors: preview.projectPermissionErrors,
    capacityConflicts: preview.capacityConflicts,
    roomPermissionErrors: preview.roomPermissionErrors,
    autoResolvedWarnings: preview.autoResolvedWarnings,
    validItems: preview.validItems
  });
}

async function handleImportConfirm(req, res, db) {
  const input = await body(req);

  if (!Array.isArray(input)) {
    return send(res, 400, {
      error: "invalid_input",
      message: "请求体必须是动物数组"
    });
  }

  if (input.length === 0) {
    return send(res, 400, {
      error: "empty_batch",
      message: "导入批次不能为空"
    });
  }

  const validation = validateBatchImport(db, input, req._principal);

  if (validation.importable === 0) {
    return send(res, 422, {
      error: "no_importable_items",
      message: "没有可导入的有效动物记录",
      details: {
        fieldErrors: validation.fieldErrors,
        duplicateIds: validation.duplicateIds,
        missingCages: validation.missingCages,
        missingRooms: validation.missingRooms,
        missingZones: validation.missingZones,
        missingProjects: validation.missingProjects,
        roomMismatches: validation.roomMismatches,
        zoneMismatches: validation.zoneMismatches,
        projectMismatches: validation.projectMismatches,
        projectPermissionErrors: validation.projectPermissionErrors,
        capacityConflicts: validation.capacityConflicts,
        roomPermissionErrors: validation.roomPermissionErrors,
        autoResolvedWarnings: validation.autoResolvedWarnings
      }
    });
  }

  const validItems = getValidImportItems(db, input, req._principal);
  const imported = await batchAddAnimals(db, validItems, { operator: req._principal });
  await saveDb(db);

  send(res, 201, {
    imported: imported.length,
    totalRequested: input.length,
    skipped: input.length - imported.length,
    animals: imported,
    warnings: {
      fieldErrors: validation.fieldErrors,
      duplicateIds: validation.duplicateIds,
      missingCages: validation.missingCages,
      missingRooms: validation.missingRooms,
      missingZones: validation.missingZones,
      missingProjects: validation.missingProjects,
      roomMismatches: validation.roomMismatches,
      zoneMismatches: validation.zoneMismatches,
      projectMismatches: validation.projectMismatches,
      projectPermissionErrors: validation.projectPermissionErrors,
      capacityConflicts: validation.capacityConflicts,
      roomPermissionErrors: validation.roomPermissionErrors,
      autoResolvedWarnings: validation.autoResolvedWarnings
    }
  });
}

async function handleQuarantineRecord(req, res, db, animalId) {
  const animal = getAnimal(db, animalId);
  if (!animal) { send(res, 404, { error: "animal_not_found" }); return; }

  if (animal.status !== ANIMAL_STATUS.QUARANTINE && animal.status !== ANIMAL_STATUS.QUARANTINE_ABNORMAL) {
    return send(res, 422, {
      error: "invalid_status",
      message: `当前状态 ${animal.status} 无法添加检疫记录`
    });
  }

  const input = await body(req);
  const record = await addQuarantineRecord(db, animalId, input, { operator: req._principal });

  let healthResult = null;
  const conditionText = [input.condition || "", ...(input.symptoms || []), input.notes || ""].join(" ");
  const weight = input.weight;
  if (conditionText || weight != null || input.isAbnormal) {
    healthResult = detectAndCreateEvent(db, {
      animalId,
      condition: conditionText,
      weight,
      source: input.isAbnormal ? "quarantine_record_abnormal" : "quarantine_record",
      sourceRecordId: record.id,
      keeper: input.examiner || animal.keeper
    });
    if (!healthResult.created && input.isAbnormal) {
      const allKeywords = ["检疫标记异常", ...detectAbnormalKeywords(conditionText)];
      const weightResult = weight != null ? calculateWeightChange(animal, weight) : null;
      const existing = findMergeableEvent(db, animalId, allKeywords);
      const inferredSeverity = inferSeverityFromKeywords(allKeywords, weightResult, EVENT_SEVERITY.WARNING);
      const eventParams = {
        animalId,
        condition: conditionText || "检疫记录标记异常",
        abnormalKeywords: allKeywords,
        weightChange: weightResult,
        source: "quarantine_record_abnormal",
        sourceRecordId: record.id,
        keeper: input.examiner || animal.keeper,
        severity: inferredSeverity
      };
      if (existing) {
        const merged = mergeToExistingEvent(db, existing, eventParams);
        healthResult = { created: true, merged: true, event: merged };
      } else {
        const event = createHealthEvent(db, eventParams);
        healthResult = { created: true, merged: false, event };
      }
    }
  }

  await saveDb(db);

  if (healthResult && healthResult.created) {
    send(res, 201, {
      ...record,
      healthEvent: {
        created: healthResult.created,
        merged: healthResult.merged || false,
        eventId: healthResult.event ? healthResult.event.id : null,
        event: healthResult.event || null
      }
    });
  } else {
    send(res, 201, record);
  }
}

async function handleQuarantineRelease(req, res, db, animalId) {
  const animal = getAnimal(db, animalId);
  if (!animal) { send(res, 404, { error: "animal_not_found" }); return; }

  if (animal.status !== ANIMAL_STATUS.QUARANTINE && animal.status !== ANIMAL_STATUS.QUARANTINE_ABNORMAL) {
    return send(res, 422, {
      error: "invalid_status",
      message: `当前状态 ${animal.status} 无法放行`
    });
  }

  const input = await body(req);
  if (input.targetCageId) {
    const validation = validateCageForAnimal(db, input.targetCageId, animal.cageId, req._principal);
    if (!validation.valid) {
      return send(res, 422, { error: "cage_validation_failed", details: validation.errors });
    }
  }

  const result = await releaseAnimal(db, animalId, input, { operator: req._principal });
  if (result.error) {
    return send(res, 422, { error: result.error, message: result.message });
  }
  send(res, 200, result);
}

async function handleQuarantineAbnormal(req, res, db, animalId) {
  const animal = getAnimal(db, animalId);
  if (!animal) { send(res, 404, { error: "animal_not_found" }); return; }

  if (animal.status !== ANIMAL_STATUS.QUARANTINE && animal.status !== ANIMAL_STATUS.QUARANTINE_ABNORMAL) {
    return send(res, 422, {
      error: "invalid_status",
      message: `当前状态 ${animal.status} 无法标记为异常`
    });
  }

  const input = await body(req);
  const result = await markQuarantineAbnormal(db, animalId, input, { operator: req._principal });
  if (result.error) {
    return send(res, 422, { error: result.error, message: result.message });
  }

  const markerId = `abnormal-mark-${animalId}-${Date.now()}`;
  const conditionText = (input.reason || "检疫异常") + (input.notes ? `：${input.notes}` : "");
  const allKeywords = ["检疫标记异常", ...detectAbnormalKeywords(conditionText)];
  const existing = findMergeableEvent(db, animalId, allKeywords);
  const inferredSeverity = inferSeverityFromKeywords(allKeywords, null, EVENT_SEVERITY.WARNING);
  const eventParams = {
    animalId,
    condition: conditionText,
    abnormalKeywords: allKeywords,
    source: "quarantine_abnormal_mark",
    sourceRecordId: markerId,
    keeper: input.handler || animal.keeper,
    severity: inferredSeverity
  };

  let healthResult;
  if (existing) {
    const merged = mergeToExistingEvent(db, existing, eventParams);
    healthResult = { created: true, merged: true, event: merged };
  } else {
    const event = createHealthEvent(db, eventParams);
    healthResult = { created: true, merged: false, event };
  }

  await saveDb(db);

  send(res, 200, {
    ...result,
    healthEvent: {
      created: healthResult.created,
      merged: healthResult.merged,
      eventId: healthResult.event.id,
      event: healthResult.event
    }
  });
}

async function handleQuarantineResolve(req, res, db, animalId) {
  const animal = getAnimal(db, animalId);
  if (!animal) { send(res, 404, { error: "animal_not_found" }); return; }

  if (animal.status !== ANIMAL_STATUS.QUARANTINE_ABNORMAL) {
    return send(res, 422, {
      error: "invalid_status",
      message: `当前状态 ${animal.status} 无法解除异常`
    });
  }

  const input = await body(req);
  const result = await resolveQuarantineAbnormal(db, animalId, input, { operator: req._principal });
  if (result.error) {
    return send(res, 422, { error: result.error, message: result.message });
  }
  send(res, 200, result);
}
