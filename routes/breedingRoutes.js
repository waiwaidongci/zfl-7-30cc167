import { send, body, saveDb } from "../lib/helpers.js";
import {
  listBreedingPairs,
  getBreedingPair,
  createBreedingPair,
  updateBreedingPairStatus,
  cancelBreedingPair,
  listBreedingLitters,
  getBreedingLitter,
  createBreedingLitter,
  updateBreedingLitter,
  weanLitter,
  getFamilyTree,
  getBreedingStats,
  getOffspringByParent
} from "../lib/breedingData.js";
import {
  validatePairingFull,
  validateLitterFull,
  validateWeaningPlan,
  PAIRING_STATUS,
  LITTER_STATUS
} from "../lib/breedingValidator.js";
import { getAnimal } from "../lib/animalData.js";

export async function handleBreedingRoutes(req, res, url, db) {
  if (req.method === "GET" && url.pathname === "/breeding/pairs") {
    await handleListPairs(req, res, db, url);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/breeding/pairs") {
    await handleCreatePair(req, res, db);
    await saveDb(db);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/breeding/litters") {
    await handleListLitters(req, res, db, url);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/breeding/litters") {
    await handleCreateLitter(req, res, db);
    await saveDb(db);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/breeding/stats") {
    send(res, 200, getBreedingStats(db));
    return true;
  }

  const pairMatch = url.pathname.match(/^\/breeding\/pairs\/([^/]+)(?:\/([^/]+))?$/);
  if (pairMatch) {
    const [, id, action] = pairMatch;

    if (req.method === "GET" && !action) {
      const pair = getBreedingPair(db, id);
      if (!pair) { send(res, 404, { error: "pairing_not_found" }); return true; }
      send(res, 200, pair);
      return true;
    }

    if (req.method === "POST") {
      if (action === "status") {
        await handleUpdatePairStatus(req, res, db, id);
        await saveDb(db);
        return true;
      }
      if (action === "cancel") {
        await handleCancelPair(req, res, db, id);
        await saveDb(db);
        return true;
      }
    }
  }

  const litterMatch = url.pathname.match(/^\/breeding\/litters\/([^/]+)(?:\/([^/]+))?$/);
  if (litterMatch) {
    const [, id, action] = litterMatch;

    if (req.method === "GET" && !action) {
      const litter = getBreedingLitter(db, id);
      if (!litter) { send(res, 404, { error: "litter_not_found" }); return true; }
      send(res, 200, litter);
      return true;
    }

    if (req.method === "POST") {
      if (action === "update") {
        await handleUpdateLitter(req, res, db, id);
        await saveDb(db);
        return true;
      }
      if (action === "wean") {
        await handleWeanLitter(req, res, db, id);
        await saveDb(db);
        return true;
      }
    }
  }

  const genealogyMatch = url.pathname.match(/^\/breeding\/genealogy\/([^/]+)$/);
  if (genealogyMatch && req.method === "GET") {
    const animalId = genealogyMatch[1];
    const tree = getFamilyTree(db, animalId);
    if (!tree) { send(res, 404, { error: "animal_not_found" }); return true; }
    send(res, 200, tree);
    return true;
  }

  const offspringMatch = url.pathname.match(/^\/breeding\/offspring\/([^/]+)$/);
  if (offspringMatch && req.method === "GET") {
    const parentId = offspringMatch[1];
    const animal = getAnimal(db, parentId);
    if (!animal) { send(res, 404, { error: "animal_not_found" }); return true; }
    send(res, 200, getOffspringByParent(db, parentId));
    return true;
  }

  return false;
}

async function handleListPairs(req, res, db, url) {
  const filters = {
    cageId: url.searchParams.get("cageId"),
    maleId: url.searchParams.get("maleId"),
    femaleId: url.searchParams.get("femaleId"),
    status: url.searchParams.get("status"),
    strain: url.searchParams.get("strain")
  };
  send(res, 200, listBreedingPairs(db, filters));
}

async function handleCreatePair(req, res, db) {
  const input = await body(req);

  const validation = validatePairingFull(input, db);
  if (!validation.valid) {
    return send(res, 400, { error: "validation_failed", details: validation.errors });
  }

  if (input.id && getBreedingPair(db, input.id)) {
    return send(res, 409, { error: "pairing_id_exists" });
  }

  const pair = createBreedingPair(db, input);
  send(res, 201, pair);
}

async function handleUpdatePairStatus(req, res, db, id) {
  const pair = getBreedingPair(db, id);
  if (!pair) { send(res, 404, { error: "pairing_not_found" }); return; }

  const input = await body(req);
  const newStatus = input.status;

  if (!Object.values(PAIRING_STATUS).includes(newStatus)) {
    return send(res, 400, {
      error: "invalid_status",
      message: `状态必须是 ${Object.values(PAIRING_STATUS).join(" / ")}`
    });
  }

  const updated = updateBreedingPairStatus(db, id, newStatus, input.notes);
  send(res, 200, updated);
}

async function handleCancelPair(req, res, db, id) {
  const pair = getBreedingPair(db, id);
  if (!pair) { send(res, 404, { error: "pairing_not_found" }); return; }

  const input = await body(req);
  const updated = cancelBreedingPair(db, id, input?.reason);
  send(res, 200, updated);
}

async function handleListLitters(req, res, db, url) {
  const filters = {
    pairId: url.searchParams.get("pairId"),
    status: url.searchParams.get("status")
  };
  send(res, 200, listBreedingLitters(db, filters));
}

async function handleCreateLitter(req, res, db) {
  const input = await body(req);

  const validation = validateLitterFull(input, db);
  if (!validation.valid) {
    return send(res, 400, { error: "validation_failed", details: validation.errors });
  }

  if (input.id && getBreedingLitter(db, input.id)) {
    return send(res, 409, { error: "litter_id_exists" });
  }

  const litter = createBreedingLitter(db, input, validation.pairing);
  send(res, 201, litter);
}

async function handleUpdateLitter(req, res, db, id) {
  const litter = getBreedingLitter(db, id);
  if (!litter) { send(res, 404, { error: "litter_not_found" }); return; }

  const input = await body(req);
  const updated = updateBreedingLitter(db, id, input);
  send(res, 200, updated);
}

async function handleWeanLitter(req, res, db, id) {
  const litter = getBreedingLitter(db, id);
  if (!litter) { send(res, 404, { error: "litter_not_found" }); return; }

  const input = await body(req);

  const rawLitter = (db.breedingLitters || []).find((l) => l.id === id);
  const validation = validateWeaningPlan(input, db, rawLitter);
  if (!validation.valid) {
    return send(res, 400, { error: "weaning_validation_failed", details: validation.errors });
  }

  if (rawLitter.status === LITTER_STATUS.WEANED) {
    return send(res, 422, { error: "litter_already_weaned", message: "该窝仔已完成断奶" });
  }

  if (input.offspring && Array.isArray(input.offspring)) {
    for (let i = 0; i < input.offspring.length; i++) {
      const group = input.offspring[i];
      const cageOccupancy = (db.animals || []).filter(
        (a) => a.cageId === group.cageId && ["quarantine", "released", "quarantine_abnormal"].includes(a.status)
      ).length;
      const cage = (db.cages || []).find((c) => c.id === group.cageId);
      const expectedAfter = cageOccupancy + group.count;
      if (cage && expectedAfter > cage.capacity) {
        return send(res, 422, {
          error: "offspring_cage_full",
          message: `子代数组第${i + 1}项笼位 ${group.cageId} 容量不足（现有${cageOccupancy}，需放入${group.count}，容量${cage.capacity}）`
        });
      }
    }
  }

  const pairing = litter.pairSummary
    ? (db.breedingPairs || []).find((p) => p.id === litter.pairSummary.id)
    : null;

  const result = weanLitter(db, id, input.weanDate, input.offspring, pairing);

  if (result.error) {
    return send(res, 422, { error: result.error, message: result.message });
  }

  send(res, 201, result);
}
