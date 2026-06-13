import { send, body, saveDb } from "../lib/helpers.js";
import { listAnimals, getAnimal, addAnimal, addNote, moveAnimal, removeAnimal, batchAddAnimals } from "../lib/animalData.js";
import { validateAnimalFull, validateAnimalFields } from "../lib/animalValidator.js";
import { validateCageForAnimal } from "../lib/cageValidator.js";
import { validateBatchImport, getValidImportItems } from "../lib/batchImportValidator.js";

export async function handleAnimalRoutes(req, res, url, db) {
  if (req.method === "GET" && url.pathname === "/animals") {
    const filters = {
      project: url.searchParams.get("project"),
      cageId: url.searchParams.get("cageId"),
      status: url.searchParams.get("status")
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

  const cageValidation = validateCageForAnimal(db, input.cageId);
  if (!cageValidation.valid) {
    return send(res, 422, { error: "cage_validation_failed", details: cageValidation.errors });
  }

  const animal = addAnimal(db, input);
  send(res, 201, animal);
}

async function handleAddNote(req, res, db, animalId) {
  const animal = getAnimal(db, animalId);
  if (!animal) { send(res, 404, { error: "animal_not_found" }); return; }

  const input = await body(req);
  const note = addNote(db, animalId, input);
  send(res, 201, note);
}

async function handleMoveAnimal(req, res, db, animalId) {
  const animal = getAnimal(db, animalId);
  if (!animal) { send(res, 404, { error: "animal_not_found" }); return; }

  const input = await body(req);
  if (!input.cageId) {
    return send(res, 400, { error: "cageId_required" });
  }

  const validation = validateCageForAnimal(db, input.cageId, animal.cageId);
  if (!validation.valid) {
    return send(res, 422, { error: "cage_validation_failed", details: validation.errors });
  }

  const updated = moveAnimal(db, animalId, input.cageId, input.reason);
  send(res, 200, updated);
}

async function handleRemoveAnimal(req, res, db, animalId) {
  const animal = getAnimal(db, animalId);
  if (!animal) { send(res, 404, { error: "animal_not_found" }); return; }

  const input = await body(req);
  const updated = removeAnimal(db, animalId, input.reason);
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

  const preview = validateBatchImport(db, input);
  send(res, 200, {
    total: preview.total,
    importable: preview.importable,
    fieldErrors: preview.fieldErrors,
    duplicateIds: preview.duplicateIds,
    missingCages: preview.missingCages,
    capacityConflicts: preview.capacityConflicts,
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

  const validation = validateBatchImport(db, input);

  if (validation.importable === 0) {
    return send(res, 422, {
      error: "no_importable_items",
      message: "没有可导入的有效动物记录",
      details: {
        fieldErrors: validation.fieldErrors,
        duplicateIds: validation.duplicateIds,
        missingCages: validation.missingCages,
        capacityConflicts: validation.capacityConflicts
      }
    });
  }

  const validItems = getValidImportItems(db, input);
  const imported = batchAddAnimals(db, validItems);
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
      capacityConflicts: validation.capacityConflicts
    }
  });
}
