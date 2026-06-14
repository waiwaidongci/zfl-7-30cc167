import { send, body, saveDb } from "../lib/helpers.js";
import { validateCageForAnimal } from "../lib/cageValidator.js";
import { checkRoomWriteAccess } from "../lib/permissions.js";
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
import { getCage } from "../lib/cageData.js";

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
    const filters = {
      roomId: url.searchParams.get("roomId") || undefined,
      projectId: url.searchParams.get("projectId") || undefined
    };
    send(res, 200, getBreedingStats(db, filters));
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
    strain: url.searchParams.get("strain"),
    roomId: url.searchParams.get("roomId") || undefined,
    zoneId: url.searchParams.get("zoneId") || undefined,
    project: url.searchParams.get("project") || undefined
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

  const cage = getCage(db, input.cageId);
  const roomCheck = checkRoomWriteAccess(req._principal, cage?.roomId);
  if (!roomCheck.authorized) {
    return send(res, 403, { error: roomCheck.error, message: roomCheck.message });
  }

  const pair = await createBreedingPair(db, input, { operator: req._principal });
  send(res, 201, pair);
}

async function handleUpdatePairStatus(req, res, db, id) {
  const pair = getBreedingPair(db, id);
  if (!pair) { send(res, 404, { error: "pairing_not_found" }); return; }

  const roomCheck = checkRoomWriteAccess(req._principal, pair.roomId);
  if (!roomCheck.authorized) {
    return send(res, 403, { error: roomCheck.error, message: roomCheck.message });
  }

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

  const roomCheck = checkRoomWriteAccess(req._principal, pair.roomId);
  if (!roomCheck.authorized) {
    return send(res, 403, { error: roomCheck.error, message: roomCheck.message });
  }

  const input = await body(req);
  const updated = cancelBreedingPair(db, id, input?.reason);
  send(res, 200, updated);
}

async function handleListLitters(req, res, db, url) {
  const filters = {
    pairId: url.searchParams.get("pairId"),
    status: url.searchParams.get("status"),
    cageId: url.searchParams.get("cageId") || undefined,
    roomId: url.searchParams.get("roomId") || undefined,
    zoneId: url.searchParams.get("zoneId") || undefined
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

  if (validation.pairing?.roomId) {
    const roomCheck = checkRoomWriteAccess(req._principal, validation.pairing.roomId);
    if (!roomCheck.authorized) {
      return send(res, 403, { error: roomCheck.error, message: roomCheck.message });
    }
  }

  const litter = createBreedingLitter(db, input, validation.pairing);
  send(res, 201, litter);
}

async function handleUpdateLitter(req, res, db, id) {
  const litter = getBreedingLitter(db, id);
  if (!litter) { send(res, 404, { error: "litter_not_found" }); return; }

  const roomCheck = checkRoomWriteAccess(req._principal, litter.roomId);
  if (!roomCheck.authorized) {
    return send(res, 403, { error: roomCheck.error, message: roomCheck.message });
  }

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
      for (let slot = 0; slot < group.count; slot++) {
        const cageValidation = validateCageForAnimal(db, group.cageId, null, req._principal);
        if (!cageValidation.valid) {
          const firstErr = cageValidation.errors[0];
          const codeMap = {
            cage_not_found: "offspring_cage_not_found",
            cage_disabled: "offspring_cage_disabled",
            cage_full: "offspring_cage_full",
            cage_room_no_permission: "offspring_cage_room_no_permission",
            target_room_access_denied: "offspring_cage_room_no_permission"
          };
          return send(res, 422, {
            error: codeMap[firstErr?.code] || "weaning_cage_invalid",
            message: `子代数组第${i + 1}项笼位：${firstErr?.message || firstErr}`
          });
        }
      }
    }
  }

  const pairing = litter.pairSummary
    ? (db.breedingPairs || []).find((p) => p.id === litter.pairSummary.id)
    : null;

  const result = await weanLitter(db, id, input.weanDate, input.offspring, pairing, { operator: req._principal });

  if (result.error) {
    return send(res, 422, { error: result.error, message: result.message });
  }

  send(res, 201, result);
}
