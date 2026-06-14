import { getCage } from "./cageData.js";

export const DEFAULT_ROOM_ID = "room-default";
export const DEFAULT_ZONE_ID = "zone-default";
export const DEFAULT_PROJECT_ID = "project-default";

export const ROOM_STATUS = {
  ACTIVE: "active",
  MAINTENANCE: "maintenance",
  DISABLED: "disabled"
};

export const PROJECT_STATUS = {
  ACTIVE: "active",
  COMPLETED: "completed",
  SUSPENDED: "suspended"
};

export function ensureFacilityCollections(db) {
  if (!db.rooms) db.rooms = [];
  if (!db.zones) db.zones = [];
  if (!db.projects) db.projects = [];
  if (!db.keepers) db.keepers = [];
}

export function ensureDefaults(db) {
  ensureFacilityCollections(db);
  const now = new Date().toISOString();

  if (!db.rooms.find(r => r.id === DEFAULT_ROOM_ID)) {
    db.rooms.push({
      id: DEFAULT_ROOM_ID,
      name: "主动物房",
      code: "MAIN",
      description: "系统默认动物房，所有历史数据自动归属到此房间",
      status: ROOM_STATUS.ACTIVE,
      address: "",
      manager: "",
      createdAt: now,
      isDefault: true
    });
  }

  if (!db.zones.find(z => z.id === DEFAULT_ZONE_ID)) {
    db.zones.push({
      id: DEFAULT_ZONE_ID,
      roomId: DEFAULT_ROOM_ID,
      name: "默认区域",
      code: "DEFAULT",
      description: "系统默认区域",
      createdAt: now,
      isDefault: true
    });
  }

  if (!db.projects.find(p => p.id === DEFAULT_PROJECT_ID)) {
    db.projects.push({
      id: DEFAULT_PROJECT_ID,
      name: "默认项目组",
      code: "DEFAULT",
      roomId: DEFAULT_ROOM_ID,
      description: "系统默认项目组，所有历史数据自动归属到此项目",
      status: PROJECT_STATUS.ACTIVE,
      manager: "",
      startDate: "",
      endDate: "",
      createdAt: now,
      isDefault: true
    });
  }
}

export function migrateLegacyFacilityData(db) {
  ensureDefaults(db);

  let migrated = false;

  if (db.cages) {
    for (const cage of db.cages) {
      if (!cage.roomId) {
        cage.roomId = DEFAULT_ROOM_ID;
        migrated = true;
      }
      if (!cage.zoneId) {
        if (cage.area) {
          let zone = db.zones.find(z => z.name === cage.area && z.roomId === cage.roomId);
          if (!zone) {
            zone = {
              id: `zone-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
              roomId: cage.roomId,
              name: cage.area,
              code: cage.area.replace(/区$/, "").toUpperCase() || `Z${db.zones.length + 1}`,
              description: `从旧数据区域字段自动创建：${cage.area}`,
              createdAt: new Date().toISOString()
            };
            db.zones.push(zone);
          }
          cage.zoneId = zone.id;
        } else {
          cage.zoneId = DEFAULT_ZONE_ID;
        }
        migrated = true;
      }
    }
  }

  if (db.projects && db.animals) {
    const projectNames = new Set();
    for (const animal of db.animals) {
      if (animal.project) projectNames.add(animal.project);
    }
    for (const pname of projectNames) {
      if (!db.projects.find(p => p.name === pname)) {
        db.projects.push({
          id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          name: pname,
          code: pname.replace(/[^\w]/g, "").toUpperCase().slice(0, 8) || `PRJ${db.projects.length + 1}`,
          roomId: DEFAULT_ROOM_ID,
          description: `从旧数据项目字段自动创建：${pname}`,
          status: PROJECT_STATUS.ACTIVE,
          manager: "",
          startDate: "",
          endDate: "",
          createdAt: new Date().toISOString(),
          migratedFromAnimal: true
        });
        migrated = true;
      }
    }
  }

  if (db.animals) {
    const uniqueKeepers = new Set();
    for (const animal of db.animals) {
      if (animal.keeper) uniqueKeepers.add(animal.keeper);
    }
    for (const kname of uniqueKeepers) {
      if (!db.keepers.find(k => k.name === kname)) {
        db.keepers.push({
          id: `keeper-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          name: kname,
          code: kname.replace(/[^\w]/g, "").toUpperCase() || `K${db.keepers.length + 1}`,
          roomIds: [DEFAULT_ROOM_ID],
          projectIds: db.projects.filter(p => p.roomId === DEFAULT_ROOM_ID).map(p => p.id),
          role: "keeper",
          phone: "",
          email: "",
          description: `从旧数据饲养员字段自动创建：${kname}`,
          createdAt: new Date().toISOString(),
          migratedFromAnimal: true
        });
        migrated = true;
      }
    }
  }

  if (db.breedingPairs) {
    for (const pair of db.breedingPairs) {
      if (!pair.roomId) {
        const cage = (db.cages || []).find(c => c.id === pair.cageId);
        pair.roomId = cage?.roomId || DEFAULT_ROOM_ID;
        migrated = true;
      }
    }
  }
  if (db.breedingLitters) {
    for (const litter of db.breedingLitters) {
      if (!litter.roomId) {
        const cage = (db.cages || []).find(c => c.id === litter.cageId);
        litter.roomId = cage?.roomId || DEFAULT_ROOM_ID;
        migrated = true;
      }
    }
  }
  if (db.feedingPlans) {
    for (const plan of db.feedingPlans) {
      if (!plan.roomId) {
        if (plan.targetType === "cage") {
          const cage = (db.cages || []).find(c => c.id === plan.targetId);
          plan.roomId = cage?.roomId || DEFAULT_ROOM_ID;
        } else if (plan.targetType === "animal") {
          const animal = (db.animals || []).find(a => a.id === plan.targetId);
          const cage = animal ? (db.cages || []).find(c => c.id === animal.cageId) : null;
          plan.roomId = cage?.roomId || DEFAULT_ROOM_ID;
        } else {
          plan.roomId = DEFAULT_ROOM_ID;
        }
        migrated = true;
      }
    }
  }
  if (db.feedingRecords) {
    for (const record of db.feedingRecords) {
      if (!record.roomId) {
        if (record.targetType === "cage") {
          const cage = (db.cages || []).find(c => c.id === record.targetId);
          record.roomId = cage?.roomId || DEFAULT_ROOM_ID;
        } else if (record.targetType === "animal") {
          const animal = (db.animals || []).find(a => a.id === record.targetId);
          const cage = animal ? (db.cages || []).find(c => c.id === animal.cageId) : null;
          record.roomId = cage?.roomId || DEFAULT_ROOM_ID;
        } else {
          record.roomId = DEFAULT_ROOM_ID;
        }
        migrated = true;
      }
    }
  }
  if (db.healthEvents) {
    for (const event of db.healthEvents) {
      if (!event.roomId) {
        const animal = (db.animals || []).find(a => a.id === event.animalId);
        const cage = animal ? (db.cages || []).find(c => c.id === animal.cageId) : null;
        event.roomId = cage?.roomId || DEFAULT_ROOM_ID;
        migrated = true;
      }
    }
  }

  return migrated;
}

export function listRooms(db, filters = {}) {
  ensureFacilityCollections(db);
  let rooms = [...db.rooms];
  if (filters.status) rooms = rooms.filter(r => r.status === filters.status);
  return rooms.map(room => enrichRoom(db, room));
}

export function getRoom(db, id) {
  ensureFacilityCollections(db);
  const room = db.rooms.find(r => r.id === id);
  if (!room) return null;
  return enrichRoom(db, room);
}

function enrichRoom(db, room) {
  const zones = db.zones.filter(z => z.roomId === room.id);
  const projects = db.projects.filter(p => p.roomId === room.id);
  const cages = (db.cages || []).filter(c => c.roomId === room.id);
  const keepers = (db.keepers || []).filter(k => k.roomIds?.includes(room.id));
  const animalCount = (db.animals || []).filter(a => {
    const cage = (db.cages || []).find(c => c.id === a.cageId);
    return cage?.roomId === room.id && ["quarantine", "released", "quarantine_abnormal"].includes(a.status);
  }).length;
  return {
    ...room,
    zoneCount: zones.length,
    projectCount: projects.length,
    cageCount: cages.length,
    keeperCount: keepers.length,
    animalCount
  };
}

export function addRoom(db, input) {
  ensureFacilityCollections(db);
  const room = {
    id: input.id || `room-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    name: input.name,
    code: input.code || `R${db.rooms.length + 1}`,
    description: input.description || "",
    status: input.status || ROOM_STATUS.ACTIVE,
    address: input.address || "",
    manager: input.manager || "",
    createdAt: new Date().toISOString()
  };
  db.rooms.push(room);
  return enrichRoom(db, room);
}

export function updateRoom(db, id, updates) {
  const room = db.rooms?.find(r => r.id === id);
  if (!room) return null;
  if (updates.name !== undefined) room.name = updates.name;
  if (updates.code !== undefined) room.code = updates.code;
  if (updates.description !== undefined) room.description = updates.description;
  if (updates.status !== undefined) room.status = updates.status;
  if (updates.address !== undefined) room.address = updates.address;
  if (updates.manager !== undefined) room.manager = updates.manager;
  room.updatedAt = new Date().toISOString();
  return enrichRoom(db, room);
}

export function listZones(db, filters = {}) {
  ensureFacilityCollections(db);
  let zones = [...db.zones];
  if (filters.roomId) zones = zones.filter(z => z.roomId === filters.roomId);
  return zones.map(zone => enrichZone(db, zone));
}

export function getZone(db, id) {
  ensureFacilityCollections(db);
  const zone = db.zones.find(z => z.id === id);
  if (!zone) return null;
  return enrichZone(db, zone);
}

function enrichZone(db, zone) {
  const room = db.rooms.find(r => r.id === zone.roomId);
  const cages = (db.cages || []).filter(c => c.zoneId === zone.id);
  return {
    ...zone,
    roomName: room?.name || null,
    cageCount: cages.length,
    animalCount: (db.animals || []).filter(a => {
      const cage = (db.cages || []).find(c => c.id === a.cageId);
      return cage?.zoneId === zone.id && ["quarantine", "released", "quarantine_abnormal"].includes(a.status);
    }).length
  };
}

export function addZone(db, input) {
  ensureFacilityCollections(db);
  const zone = {
    id: input.id || `zone-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    roomId: input.roomId || DEFAULT_ROOM_ID,
    name: input.name,
    code: input.code || `Z${db.zones.length + 1}`,
    description: input.description || "",
    createdAt: new Date().toISOString()
  };
  db.zones.push(zone);
  return enrichZone(db, zone);
}

export function listProjects(db, filters = {}) {
  ensureFacilityCollections(db);
  let projects = [...db.projects];
  if (filters.roomId) projects = projects.filter(p => p.roomId === filters.roomId);
  if (filters.status) projects = projects.filter(p => p.status === filters.status);
  return projects.map(p => enrichProject(db, p));
}

export function getProject(db, id) {
  ensureFacilityCollections(db);
  const project = db.projects.find(p => p.id === id);
  if (!project) return null;
  return enrichProject(db, project);
}

function enrichProject(db, project) {
  const room = db.rooms.find(r => r.id === project.roomId);
  const animals = (db.animals || []).filter(a => {
    if (a.project === project.name) return true;
    return false;
  });
  return {
    ...project,
    roomName: room?.name || null,
    animalCount: animals.filter(a => ["quarantine", "released", "quarantine_abnormal"].includes(a.status)).length,
    totalAnimalCount: animals.length,
    keeperCount: new Set(animals.map(a => a.keeper).filter(Boolean)).size
  };
}

export function addProject(db, input) {
  ensureFacilityCollections(db);
  const project = {
    id: input.id || `proj-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    name: input.name,
    code: input.code || `PRJ${db.projects.length + 1}`,
    roomId: input.roomId || DEFAULT_ROOM_ID,
    description: input.description || "",
    status: input.status || PROJECT_STATUS.ACTIVE,
    manager: input.manager || "",
    startDate: input.startDate || "",
    endDate: input.endDate || "",
    createdAt: new Date().toISOString()
  };
  db.projects.push(project);
  return enrichProject(db, project);
}

export function updateProject(db, id, updates) {
  const project = db.projects?.find(p => p.id === id);
  if (!project) return null;
  if (updates.name !== undefined) project.name = updates.name;
  if (updates.code !== undefined) project.code = updates.code;
  if (updates.roomId !== undefined) project.roomId = updates.roomId;
  if (updates.description !== undefined) project.description = updates.description;
  if (updates.status !== undefined) project.status = updates.status;
  if (updates.manager !== undefined) project.manager = updates.manager;
  if (updates.startDate !== undefined) project.startDate = updates.startDate;
  if (updates.endDate !== undefined) project.endDate = updates.endDate;
  project.updatedAt = new Date().toISOString();
  return enrichProject(db, project);
}

export function listKeepers(db, filters = {}) {
  ensureFacilityCollections(db);
  let keepers = [...db.keepers];
  if (filters.roomId) keepers = keepers.filter(k => k.roomIds?.includes(filters.roomId));
  if (filters.projectId) keepers = keepers.filter(k => k.projectIds?.includes(filters.projectId));
  return keepers.map(k => enrichKeeper(db, k));
}

export function getKeeper(db, id) {
  ensureFacilityCollections(db);
  const keeper = db.keepers.find(k => k.id === id);
  if (!keeper) return null;
  return enrichKeeper(db, keeper);
}

function enrichKeeper(db, keeper) {
  const rooms = (db.rooms || []).filter(r => keeper.roomIds?.includes(r.id));
  const projects = (db.projects || []).filter(p => keeper.projectIds?.includes(p.id));
  const animals = (db.animals || []).filter(a => a.keeper === keeper.name);
  return {
    ...keeper,
    rooms: rooms.map(r => ({ id: r.id, name: r.name, code: r.code })),
    projects: projects.map(p => ({ id: p.id, name: p.name, code: p.code })),
    animalCount: animals.filter(a => ["quarantine", "released", "quarantine_abnormal"].includes(a.status)).length,
    totalAnimalCount: animals.length
  };
}

export function addKeeper(db, input) {
  ensureFacilityCollections(db);
  const keeper = {
    id: input.id || `keeper-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    name: input.name,
    code: input.code || `K${db.keepers.length + 1}`,
    roomIds: input.roomIds || [DEFAULT_ROOM_ID],
    projectIds: input.projectIds || [],
    role: input.role || "keeper",
    phone: input.phone || "",
    email: input.email || "",
    description: input.description || "",
    createdAt: new Date().toISOString()
  };
  db.keepers.push(keeper);
  return enrichKeeper(db, keeper);
}

export function updateKeeper(db, id, updates) {
  const keeper = db.keepers?.find(k => k.id === id);
  if (!keeper) return null;
  if (updates.name !== undefined) keeper.name = updates.name;
  if (updates.code !== undefined) keeper.code = updates.code;
  if (updates.roomIds !== undefined) keeper.roomIds = updates.roomIds;
  if (updates.projectIds !== undefined) keeper.projectIds = updates.projectIds;
  if (updates.role !== undefined) keeper.role = updates.role;
  if (updates.phone !== undefined) keeper.phone = updates.phone;
  if (updates.email !== undefined) keeper.email = updates.email;
  if (updates.description !== undefined) keeper.description = updates.description;
  keeper.updatedAt = new Date().toISOString();
  return enrichKeeper(db, keeper);
}

export function resolveRoomIdByCage(db, cageId) {
  const cage = getCage(db, cageId);
  return cage?.roomId || DEFAULT_ROOM_ID;
}

export function resolveProjectIdByName(db, projectName) {
  ensureFacilityCollections(db);
  const project = db.projects.find(p => p.name === projectName);
  return project?.id || DEFAULT_PROJECT_ID;
}

export function canKeeperAccessRoom(principalOrKeeper, roomId) {
  if (!principalOrKeeper) return false;
  const allowedRooms = principalOrKeeper.allowedRoomIds || principalOrKeeper.roomIds;
  if (!allowedRooms || allowedRooms.length === 0) return true;
  return allowedRooms.includes("*") || allowedRooms.includes(roomId);
}

export function canKeeperAccessProject(principalOrKeeper, projectId) {
  if (!principalOrKeeper) return false;
  const allowedProjects = principalOrKeeper.allowedProjectIds || principalOrKeeper.projectIds;
  if (!allowedProjects || allowedProjects.length === 0) return true;
  return allowedProjects.includes("*") || allowedProjects.includes(projectId);
}

export function getFacilityOverview(db) {
  ensureFacilityCollections(db);
  const rooms = db.rooms || [];
  const zones = db.zones || [];
  const projects = db.projects || [];
  const keepers = db.keepers || [];
  const activeCages = (db.cages || []).filter(c => c.status === "active");
  const activeAnimals = (db.animals || []).filter(a => ["quarantine", "released", "quarantine_abnormal"].includes(a.status));

  const byRoom = {};
  for (const room of rooms) {
    const rCages = activeCages.filter(c => c.roomId === room.id);
    const rAnimals = activeAnimals.filter(a => {
      const cage = (db.cages || []).find(c => c.id === a.cageId);
      return cage?.roomId === room.id;
    });
    byRoom[room.id] = {
      name: room.name,
      code: room.code,
      status: room.status,
      cageCount: rCages.length,
      animalCount: rAnimals.length,
      projectCount: projects.filter(p => p.roomId === room.id).length,
      zoneCount: zones.filter(z => z.roomId === room.id).length
    };
  }

  return {
    rooms: rooms.length,
    zones: zones.length,
    projects: projects.length,
    keepers: keepers.length,
    cages: activeCages.length,
    animals: activeAnimals.length,
    byRoom,
    defaultRoomId: DEFAULT_ROOM_ID,
    defaultZoneId: DEFAULT_ZONE_ID,
    defaultProjectId: DEFAULT_PROJECT_ID,
    roomStatuses: ROOM_STATUS,
    projectStatuses: PROJECT_STATUS
  };
}
