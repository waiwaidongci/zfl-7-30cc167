import { send, body, saveDb } from "../lib/helpers.js";
import { listCages, getCage, addCage, disableCage } from "../lib/cageData.js";

export async function handleCageRoutes(req, res, url, db) {
  if (req.method === "GET" && url.pathname === "/cages") {
    const filters = {
      area: url.searchParams.get("area"),
      rack: url.searchParams.get("rack"),
      status: url.searchParams.get("status")
    };
    send(res, 200, listCages(db, filters));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/cages") {
    await handleAddCage(req, res, db);
    await saveDb(db);
    return true;
  }

  const cageDetailMatch = url.pathname.match(/^\/cages\/([^/]+)$/);
  if (cageDetailMatch && req.method === "GET") {
    const cageId = cageDetailMatch[1];
    const cage = getCage(db, cageId);
    if (!cage) { send(res, 404, { error: "cage_not_found" }); return true; }
    send(res, 200, cage);
    return true;
  }

  const cageDisableMatch = url.pathname.match(/^\/cages\/([^/]+)\/disable$/);
  if (cageDisableMatch && req.method === "POST") {
    const cageId = cageDisableMatch[1];
    const cage = disableCage(db, cageId);
    if (!cage) { send(res, 404, { error: "cage_not_found" }); return true; }
    await saveDb(db);
    send(res, 200, cage);
    return true;
  }

  return false;
}

async function handleAddCage(req, res, db) {
  const input = await body(req);
  if (!input.area || !input.rack) {
    return send(res, 400, { error: "area_and_rack_required" });
  }
  const existing = getCage(db, input.id);
  if (input.id && existing) {
    return send(res, 409, { error: "cage_id_exists" });
  }
  const cage = addCage(db, input);
  send(res, 201, cage);
}
