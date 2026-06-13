import http from "node:http";
import { loadDb, saveDb, send, body, readQuery } from "./lib/helpers.js";
import { handleCageRoutes } from "./routes/cageRoutes.js";
import { validateCageForAnimal } from "./lib/cageValidator.js";

const seed = {
  cages: [
    { id: "A-01", area: "SPF区", rack: "A", capacity: 5, status: "active", createdAt: "2026-05-01T00:00:00.000Z" },
    { id: "A-02", area: "SPF区", rack: "A", capacity: 5, status: "active", createdAt: "2026-05-01T00:00:00.000Z" },
    { id: "B-03", area: "普通区", rack: "B", capacity: 5, status: "active", createdAt: "2026-05-01T00:00:00.000Z" },
    { id: "B-04", area: "普通区", rack: "B", capacity: 5, status: "active", createdAt: "2026-05-01T00:00:00.000Z" },
    { id: "C-01", area: "检疫区", rack: "C", capacity: 3, status: "active", createdAt: "2026-05-01T00:00:00.000Z" }
  ],
  animals: [
    {
      id: "ani-1001",
      strain: "C57BL/6J",
      cageId: "A-01",
      sex: "female",
      birthDate: "2026-01-20",
      project: "代谢观察",
      keeper: "林青",
      status: "active",
      observationNodes: ["2026-06-18", "2026-07-02"],
      notes: [
        { id: "note-1", date: "2026-06-10", weight: 21.4, condition: "正常进食", keeper: "林青" }
      ],
      moves: [
        { id: "move-1", from: "检疫区", to: "A-01", movedAt: "2026-05-01T09:30:00.000Z", reason: "检疫结束" }
      ]
    },
    {
      id: "ani-1002",
      strain: "BALB/c",
      cageId: "B-03",
      sex: "male",
      birthDate: "2026-02-03",
      project: "免疫反应",
      keeper: "周遥",
      status: "active",
      observationNodes: ["2026-06-15"],
      notes: [],
      moves: []
    }
  ]
};

const port = Number(process.env.PORT || 3007);

function hoursUntil(dateText) {
  return (new Date(dateText).getTime() - Date.now()) / 36e5;
}

const server = http.createServer(async (req, res) => {
  try {
    let db = await loadDb();
    if (!db) {
      await saveDb(seed);
      db = JSON.parse(JSON.stringify(seed));
    }

    const url = readQuery(req);

    if (req.method === "GET" && url.pathname === "/") {
      return send(res, 200, {
        service: "实验动物房笼位和饲养记录API",
        endpoints: [
          "GET /cages?area=&rack=&status=",
          "GET /cages/:id",
          "POST /cages",
          "POST /cages/:id/disable",
          "GET /animals?project=&cageId=&status=",
          "POST /animals",
          "GET /animals/:id",
          "POST /animals/:id/notes",
          "POST /animals/:id/move",
          "POST /animals/:id/remove",
          "GET /reports/stock",
          "GET /reports/upcoming?days=7"
        ]
      });
    }

    const handled = await handleCageRoutes(req, res, url, db);
    if (handled) return;

    if (req.method === "GET" && url.pathname === "/animals") {
      const project = url.searchParams.get("project");
      const cageId = url.searchParams.get("cageId");
      const status = url.searchParams.get("status");
      let animals = db.animals;
      if (project) animals = animals.filter((a) => a.project === project);
      if (cageId) animals = animals.filter((a) => a.cageId === cageId);
      if (status) animals = animals.filter((a) => a.status === status);
      return send(res, 200, animals);
    }

    if (req.method === "POST" && url.pathname === "/animals") {
      const input = await body(req);
      const validation = validateCageForAnimal(db, input.cageId);
      if (!validation.valid) {
        return send(res, 422, { error: "cage_validation_failed", details: validation.errors });
      }
      const animal = {
        id: input.id || `ani-${Date.now()}`,
        strain: input.strain,
        cageId: input.cageId,
        sex: input.sex,
        birthDate: input.birthDate,
        project: input.project,
        keeper: input.keeper,
        status: "active",
        observationNodes: input.observationNodes || [],
        notes: [],
        moves: []
      };
      db.animals.push(animal);
      await saveDb(db);
      return send(res, 201, animal);
    }

    const animalMatch = url.pathname.match(/^\/animals\/([^/]+)(?:\/([^/]+))?$/);
    if (animalMatch) {
      const [, id, action] = animalMatch;
      const animal = db.animals.find((item) => item.id === id);
      if (!animal) return send(res, 404, { error: "animal_not_found" });

      if (req.method === "GET" && !action) return send(res, 200, animal);

      if (req.method === "POST" && action === "notes") {
        const input = await body(req);
        const note = { id: `note-${Date.now()}`, date: input.date || new Date().toISOString().slice(0, 10), weight: input.weight, condition: input.condition, keeper: input.keeper || animal.keeper };
        animal.notes.push(note);
        await saveDb(db);
        return send(res, 201, note);
      }

      if (req.method === "POST" && action === "move") {
        const input = await body(req);
        const validation = validateCageForAnimal(db, input.cageId);
        if (!validation.valid) {
          return send(res, 422, { error: "cage_validation_failed", details: validation.errors });
        }
        const move = { id: `move-${Date.now()}`, from: animal.cageId, to: input.cageId, movedAt: new Date().toISOString(), reason: input.reason || "笼位调整" };
        animal.cageId = input.cageId;
        animal.moves.push(move);
        await saveDb(db);
        return send(res, 200, animal);
      }

      if (req.method === "POST" && action === "remove") {
        const input = await body(req);
        animal.status = "removed";
        animal.removedAt = new Date().toISOString();
        animal.removeReason = input.reason || "移出";
        await saveDb(db);
        return send(res, 200, animal);
      }
    }

    if (req.method === "GET" && url.pathname === "/reports/stock") {
      const active = db.animals.filter((a) => a.status === "active");
      const byProject = Object.fromEntries(active.reduce((map, a) => map.set(a.project, (map.get(a.project) || 0) + 1), new Map()));
      const byCage = Object.fromEntries(active.reduce((map, a) => map.set(a.cageId, (map.get(a.cageId) || 0) + 1), new Map()));
      return send(res, 200, { total: active.length, byProject, byCage });
    }

    if (req.method === "GET" && url.pathname === "/reports/upcoming") {
      const days = Number(url.searchParams.get("days") || 7);
      const upcoming = db.animals.flatMap((animal) =>
        animal.observationNodes
          .filter((node) => hoursUntil(node) >= 0 && hoursUntil(node) <= days * 24)
          .map((node) => ({ animalId: animal.id, cageId: animal.cageId, project: animal.project, keeper: animal.keeper, date: node }))
      );
      return send(res, 200, upcoming.sort((a, b) => a.date.localeCompare(b.date)));
    }

    send(res, 404, { error: "not_found" });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`Lab animal room API listening on http://localhost:${port}`);
});
