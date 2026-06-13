import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "lab.json");
const port = Number(process.env.PORT || 3007);

const seed = {
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

async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  return JSON.parse(await readFile(dbPath, "utf8"));
}

async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function readQuery(req) {
  return new URL(req.url, `http://${req.headers.host}`);
}

function hoursUntil(dateText) {
  return (new Date(dateText).getTime() - Date.now()) / 36e5;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = readQuery(req);
    const db = await loadDb();

    if (req.method === "GET" && url.pathname === "/") {
      return send(res, 200, {
        service: "实验动物房笼位和饲养记录API",
        endpoints: [
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

    if (req.method === "GET" && url.pathname === "/animals") {
      const project = url.searchParams.get("project");
      const cageId = url.searchParams.get("cageId");
      const status = url.searchParams.get("status");
      let animals = db.animals;
      if (project) animals = animals.filter((animal) => animal.project === project);
      if (cageId) animals = animals.filter((animal) => animal.cageId === cageId);
      if (status) animals = animals.filter((animal) => animal.status === status);
      return send(res, 200, animals);
    }

    if (req.method === "POST" && url.pathname === "/animals") {
      const input = await body(req);
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
      const active = db.animals.filter((animal) => animal.status === "active");
      const byProject = Object.fromEntries(active.reduce((map, animal) => map.set(animal.project, (map.get(animal.project) || 0) + 1), new Map()));
      const byCage = Object.fromEntries(active.reduce((map, animal) => map.set(animal.cageId, (map.get(animal.cageId) || 0) + 1), new Map()));
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
