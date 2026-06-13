import http from "node:http";
import { loadDb, saveDb, send, body, readQuery } from "./lib/helpers.js";
import { handleCageRoutes } from "./routes/cageRoutes.js";
import { handleFeedingRoutes } from "./routes/feedingRoutes.js";
import { handleAnimalRoutes } from "./routes/animalRoutes.js";

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
  ],
  feedingPlans: [
    {
      id: "plan-1",
      targetType: "animal",
      targetId: "ani-1001",
      feedType: "标准颗粒饲料",
      feedTimes: ["08:00", "18:00"],
      dailyAmount: 5.0,
      keeper: "林青",
      status: "active",
      startDate: "2026-06-01",
      endDate: null,
      createdAt: "2026-06-01T00:00:00.000Z",
      notes: "代谢观察组，每日定量饲喂"
    },
    {
      id: "plan-2",
      targetType: "animal",
      targetId: "ani-1002",
      feedType: "高蛋白饲料",
      feedTimes: ["09:00"],
      dailyAmount: 4.5,
      keeper: "周遥",
      status: "active",
      startDate: "2026-06-05",
      endDate: null,
      createdAt: "2026-06-05T00:00:00.000Z",
      notes: "免疫实验组，每日一次"
    },
    {
      id: "plan-3",
      targetType: "cage",
      targetId: "A-01",
      feedType: "SPF级饲料",
      feedTimes: ["07:30", "19:30"],
      dailyAmount: 15.0,
      keeper: "林青",
      status: "active",
      startDate: "2026-05-15",
      endDate: null,
      createdAt: "2026-05-15T00:00:00.000Z",
      notes: "SPF区A架笼位统一饲喂"
    },
    {
      id: "plan-4",
      targetType: "cage",
      targetId: "B-03",
      feedType: "普通维持饲料",
      feedTimes: ["08:30"],
      dailyAmount: 10.0,
      keeper: "周遥",
      status: "active",
      startDate: "2026-05-20",
      endDate: null,
      createdAt: "2026-05-20T00:00:00.000Z",
      notes: "普通区B架笼位每日一次"
    }
  ],
  feedingRecords: [
    {
      id: "record-1",
      planId: "plan-1",
      targetType: "animal",
      targetId: "ani-1001",
      date: "2026-06-13",
      scheduledTime: "08:00",
      actualTime: "2026-06-13T08:05:00.000Z",
      feedType: "标准颗粒饲料",
      amount: 2.5,
      keeper: "林青",
      status: "completed",
      notes: "食欲良好，全部吃完"
    },
    {
      id: "record-2",
      planId: "plan-1",
      targetType: "animal",
      targetId: "ani-1001",
      date: "2026-06-13",
      scheduledTime: "18:00",
      actualTime: "2026-06-13T18:10:00.000Z",
      feedType: "标准颗粒饲料",
      amount: 2.5,
      keeper: "林青",
      status: "completed",
      notes: ""
    },
    {
      id: "record-3",
      planId: "plan-2",
      targetType: "animal",
      targetId: "ani-1002",
      date: "2026-06-13",
      scheduledTime: "09:00",
      actualTime: "2026-06-13T09:15:00.000Z",
      feedType: "高蛋白饲料",
      amount: 4.5,
      keeper: "周遥",
      status: "completed",
      notes: "进食正常"
    },
    {
      id: "record-4",
      planId: "plan-3",
      targetType: "cage",
      targetId: "A-01",
      date: "2026-06-12",
      scheduledTime: "07:30",
      actualTime: "2026-06-12T07:35:00.000Z",
      feedType: "SPF级饲料",
      amount: 7.5,
      keeper: "林青",
      status: "completed",
      notes: ""
    },
    {
      id: "record-5",
      planId: "plan-3",
      targetType: "cage",
      targetId: "A-01",
      date: "2026-06-12",
      scheduledTime: "19:30",
      actualTime: "2026-06-12T19:40:00.000Z",
      feedType: "SPF级饲料",
      amount: 7.5,
      keeper: "林青",
      status: "completed",
      notes: ""
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
          "POST /animals/import/preview",
          "POST /animals/import",
          "GET /reports/stock",
          "GET /reports/upcoming?days=7",
          "GET /feeding/plans?targetType=&targetId=&status=&keeper=",
          "POST /feeding/plans",
          "GET /feeding/plans/:id",
          "POST /feeding/plans/:id/disable",
          "GET /feeding/today?targetType=&keeper=&date=",
          "GET /feeding/today/summary",
          "POST /feeding/checkin",
          "GET /feeding/records?planId=&targetType=&targetId=&date=&keeper=&status=",
          "GET /feeding/records/:id",
          "GET /feeding/history?days=&targetType=&targetId=&keeper="
        ]
      });
    }

    const cageHandled = await handleCageRoutes(req, res, url, db);
    if (cageHandled) return;

    const feedingHandled = await handleFeedingRoutes(req, res, url, db);
    if (feedingHandled) return;

    const animalHandled = await handleAnimalRoutes(req, res, url, db);
    if (animalHandled) return;

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
