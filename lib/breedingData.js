import { addAnimal, getAnimal, moveAnimal } from "./animalData.js";
import { getCage, countOccupancy } from "./cageData.js";
import { ANIMAL_STATUS } from "./animalValidator.js";
import {
  PAIRING_STATUS,
  LITTER_STATUS,
  calculateExpectedDeliveryDate,
  generateObservationNodes
} from "./breedingValidator.js";
import { EVENT_TYPES, recordEvent } from "./eventLedger.js";
import { DEFAULT_ROOM_ID } from "./facilityData.js";

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function addDays(dateStr, days) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function listBreedingPairs(db, filters = {}) {
  let pairs = db.breedingPairs || [];
  if (filters.cageId) pairs = pairs.filter((p) => p.cageId === filters.cageId);
  if (filters.maleId) pairs = pairs.filter((p) => p.maleId === filters.maleId);
  if (filters.femaleId) pairs = pairs.filter((p) => p.femaleId === filters.femaleId);
  if (filters.status) pairs = pairs.filter((p) => p.status === filters.status);
  if (filters.strain) pairs = pairs.filter((p) => p.strain === filters.strain);
  if (filters.project) pairs = pairs.filter((p) => p.project === filters.project);
  if (filters.roomId || filters.zoneId) {
    pairs = pairs.filter((p) => {
      const cage = getCage(db, p.cageId);
      if (!cage) return false;
      if (filters.roomId && cage.roomId !== filters.roomId) return false;
      if (filters.zoneId && cage.zoneId !== filters.zoneId) return false;
      return true;
    });
  }
  return pairs.map(enrichPairing.bind(null, db));
}

export function getBreedingPair(db, id) {
  const pair = (db.breedingPairs || []).find((p) => p.id === id);
  if (!pair) return null;
  return enrichPairing(db, pair);
}

function enrichPairing(db, pair) {
  const male = getAnimal(db, pair.maleId);
  const female = getAnimal(db, pair.femaleId);
  const cage = getCage(db, pair.cageId);
  const roomId = cage?.roomId || pair.roomId || DEFAULT_ROOM_ID;
  const zoneId = cage?.zoneId || pair.zoneId || null;
  const litters = (db.breedingLitters || []).filter((l) => l.pairId === pair.id);
  return {
    ...pair,
    roomId,
    zoneId,
    strain: male?.strain || pair.strain || null,
    project: pair.project || male?.project || null,
    projectId: pair.projectId || male?.projectId || null,
    maleSummary: male ? { id: male.id, strain: male.strain, birthDate: male.birthDate, status: male.status } : null,
    femaleSummary: female ? { id: female.id, strain: female.strain, birthDate: female.birthDate, status: female.status } : null,
    cageSummary: cage ? { id: cage.id, area: cage.area, rack: cage.rack, capacity: cage.capacity, roomId: cage.roomId, zoneId: cage.zoneId } : null,
    litterCount: litters.length,
    totalPups: litters.reduce((s, l) => s + (l.totalPups || 0), 0),
    weanedPups: litters.reduce((s, l) => s + (l.weanedCount || 0), 0),
    litters: litters.map((l) => ({
      id: l.id,
      birthDate: l.birthDate,
      totalPups: l.totalPups,
      malePups: l.malePups,
      femalePups: l.femalePups,
      status: l.status,
      weanedCount: l.weanedCount || 0,
      roomId: l.roomId || roomId
    }))
  };
}

export async function createBreedingPair(db, input, options = {}) {
  if (!db.breedingPairs) db.breedingPairs = [];

  const expectedDeliveryDate =
    input.expectedDeliveryDate || calculateExpectedDeliveryDate(input.pairDate);
  const observationNodes =
    input.observationNodes && input.observationNodes.length > 0
      ? input.observationNodes
      : generateObservationNodes(input.pairDate, expectedDeliveryDate);

  const male = getAnimal(db, input.maleId);
  const female = getAnimal(db, input.femaleId);
  const cage = getCage(db, input.cageId);
  const strain = male?.strain || null;
  const roomId = cage?.roomId || male?.roomId || DEFAULT_ROOM_ID;
  const zoneId = cage?.zoneId || male?.zoneId || null;
  const projectId = input.projectId || male?.projectId || null;
  const project = input.project || male?.project || null;

  const pair = {
    id: input.id || uid("pair"),
    cageId: input.cageId,
    roomId,
    zoneId,
    maleId: input.maleId,
    femaleId: input.femaleId,
    pairDate: input.pairDate,
    expectedDeliveryDate,
    observationNodes,
    status: input.status || PAIRING_STATUS.PENDING,
    strain,
    project,
    projectId,
    keeper: input.keeper || (male?.keeper) || null,
    notes: input.notes || "",
    createdAt: new Date().toISOString()
  };

  db.breedingPairs.push(pair);

  if (male && male.cageId !== input.cageId) {
    await moveAnimal(db, input.maleId, input.cageId, "合笼配对移入", { ...options, skipEvent: false });
  }
  if (female && female.cageId !== input.cageId) {
    await moveAnimal(db, input.femaleId, input.cageId, "合笼配对移入", { ...options, skipEvent: false });
  }

  if (!options.skipEvent) {
    const basePayload = {
      pairId: pair.id,
      maleId: pair.maleId,
      femaleId: pair.femaleId,
      cageId: pair.cageId,
      pairDate: pair.pairDate,
      strain: pair.strain
    };

    if (male) {
      await recordEvent(EVENT_TYPES.BREEDING_PAIR_CREATED, {
        ...basePayload,
        role: "male"
      }, {
        animalId: pair.maleId,
        roomId: pair.roomId || male.roomId || null,
        zoneId: pair.zoneId || male.zoneId || null,
        projectId: pair.projectId || male.projectId || null,
        operator: options.operator || null,
        snapshotAfter: male,
        metadata: options.metadata || null
      });
    }

    if (female) {
      await recordEvent(EVENT_TYPES.BREEDING_PAIR_CREATED, {
        ...basePayload,
        role: "female"
      }, {
        animalId: pair.femaleId,
        roomId: pair.roomId || female.roomId || null,
        zoneId: pair.zoneId || female.zoneId || null,
        projectId: pair.projectId || female.projectId || null,
        operator: options.operator || null,
        snapshotAfter: female,
        metadata: options.metadata || null
      });
    }
  }

  return getBreedingPair(db, pair.id);
}

export function updateBreedingPairStatus(db, id, newStatus, notes) {
  const pair = (db.breedingPairs || []).find((p) => p.id === id);
  if (!pair) return null;
  pair.status = newStatus;
  pair.statusUpdatedAt = new Date().toISOString();
  if (notes) pair.statusNotes = notes;

  if (newStatus === PAIRING_STATUS.PENDING && pair.status === PAIRING_STATUS.PENDING) {
    if (!pair.expectedDeliveryDate) {
      pair.expectedDeliveryDate = calculateExpectedDeliveryDate(pair.pairDate);
    }
    if (!pair.observationNodes || pair.observationNodes.length === 0) {
      pair.observationNodes = generateObservationNodes(pair.pairDate, pair.expectedDeliveryDate);
    }
  }

  return getBreedingPair(db, id);
}

export function cancelBreedingPair(db, id, reason) {
  const pair = (db.breedingPairs || []).find((p) => p.id === id);
  if (!pair) return null;
  pair.status = PAIRING_STATUS.CANCELLED;
  pair.cancelledAt = new Date().toISOString();
  pair.cancelReason = reason || "配对取消";
  return getBreedingPair(db, id);
}

export function listBreedingLitters(db, filters = {}) {
  let litters = db.breedingLitters || [];
  if (filters.pairId) litters = litters.filter((l) => l.pairId === filters.pairId);
  if (filters.status) litters = litters.filter((l) => l.status === filters.status);
  if (filters.roomId || filters.zoneId || filters.cageId) {
    litters = litters.filter((l) => {
      const cage = l.cageId ? getCage(db, l.cageId) : null;
      const pairCage = l.pairId ? (db.breedingPairs || []).find(p => p.id === l.pairId)?.cageId : null;
      const resolvedCage = cage || (pairCage ? getCage(db, pairCage) : null);
      if (filters.cageId) {
        const lid = l.cageId || pairCage;
        if (lid !== filters.cageId) return false;
      }
      if (filters.roomId && resolvedCage?.roomId !== filters.roomId) return false;
      if (filters.zoneId && resolvedCage?.zoneId !== filters.zoneId) return false;
      return true;
    });
  }
  return litters.map(enrichLitter.bind(null, db));
}

export function getBreedingLitter(db, id) {
  const litter = (db.breedingLitters || []).find((l) => l.id === id);
  if (!litter) return null;
  return enrichLitter(db, litter);
}

function enrichLitter(db, litter) {
  const pair = (db.breedingPairs || []).find((p) => p.id === litter.pairId);
  const offspring = (db.animals || []).filter((a) => a.litterId === litter.id);
  const cage = litter.cageId ? getCage(db, litter.cageId) : (pair?.cageId ? getCage(db, pair.cageId) : null);
  const roomId = litter.roomId || cage?.roomId || pair?.roomId || DEFAULT_ROOM_ID;
  const zoneId = litter.zoneId || cage?.zoneId || pair?.zoneId || null;
  return {
    ...litter,
    roomId,
    zoneId,
    project: litter.project || pair?.project || null,
    projectId: litter.projectId || pair?.projectId || null,
    pairSummary: pair
      ? {
          id: pair.id,
          maleId: pair.maleId,
          femaleId: pair.femaleId,
          cageId: pair.cageId,
          roomId: pair.roomId,
          zoneId: pair.zoneId,
          pairDate: pair.pairDate,
          status: pair.status
        }
      : null,
    cageSummary: cage ? { id: cage.id, area: cage.area, rack: cage.rack, roomId: cage.roomId, zoneId: cage.zoneId } : null,
    fatherId: pair?.maleId || null,
    motherId: pair?.femaleId || null,
    weanedCount: offspring.length,
    offspringIds: offspring.map((a) => a.id)
  };
}

export function createBreedingLitter(db, input, pairing) {
  if (!db.breedingLitters) db.breedingLitters = [];

  const cage = pairing?.cageId ? getCage(db, pairing.cageId) : (input.cageId ? getCage(db, input.cageId) : null);
  const roomId = input.roomId || cage?.roomId || pairing?.roomId || DEFAULT_ROOM_ID;
  const zoneId = input.zoneId || cage?.zoneId || pairing?.zoneId || null;
  const project = input.project || pairing?.project || null;
  const projectId = input.projectId || pairing?.projectId || null;

  const litter = {
    id: input.id || uid("litter"),
    pairId: input.pairId,
    roomId,
    zoneId,
    project,
    projectId,
    birthDate: input.birthDate,
    totalPups: input.totalPups,
    malePups: input.malePups || 0,
    femalePups: input.femalePups || 0,
    unknownSexPups:
      input.totalPups - (input.malePups || 0) - (input.femalePups || 0),
    status: input.status || LITTER_STATUS.BORN,
    cageId: pairing?.cageId || input.cageId || null,
    keeper: input.keeper || (pairing?.keeper) || null,
    notes: input.notes || "",
    createdAt: new Date().toISOString()
  };

  db.breedingLitters.push(litter);

  if (pairing) {
    const pair = (db.breedingPairs || []).find((p) => p.id === pairing.id);
    if (pair && pair.status !== PAIRING_STATUS.DELIVERED && pair.status !== PAIRING_STATUS.WEANED) {
      pair.status = PAIRING_STATUS.DELIVERED;
      pair.deliveredAt = new Date().toISOString();
    }
  }

  return getBreedingLitter(db, litter.id);
}

export function updateBreedingLitter(db, id, updates) {
  const litter = (db.breedingLitters || []).find((l) => l.id === id);
  if (!litter) return null;

  if (updates.totalPups !== undefined) litter.totalPups = updates.totalPups;
  if (updates.malePups !== undefined) litter.malePups = updates.malePups;
  if (updates.femalePups !== undefined) litter.femalePups = updates.femalePups;
  if (updates.notes !== undefined) litter.notes = updates.notes;
  if (updates.status !== undefined) litter.status = updates.status;

  if (litter.totalPups !== undefined) {
    litter.unknownSexPups =
      litter.totalPups - (litter.malePups || 0) - (litter.femalePups || 0);
  }

  litter.updatedAt = new Date().toISOString();
  return getBreedingLitter(db, id);
}

export async function weanLitter(db, litterId, weanDate, offspringPlan, pairing, options = {}) {
  const litter = (db.breedingLitters || []).find((l) => l.id === litterId);
  if (!litter) return { error: "litter_not_found", message: "窝仔记录不存在" };

  const createdAnimals = [];
  const fatherId = pairing?.maleId || null;
  const motherId = pairing?.femaleId || null;
  const strain = pairing?.strain || null;

  let seqCounter = 1;
  for (const group of offspringPlan) {
    for (let i = 0; i < group.count; i++) {
      const weaningWeight = group.weaningWeights?.[i] || null;
      const animalInput = {
        strain: group.strain || strain || "未记录品系",
        cageId: group.cageId,
        sex: group.sex,
        birthDate: litter.birthDate,
        project: group.project,
        keeper: group.keeper,
        status: ANIMAL_STATUS.QUARANTINE,
        observationNodes: group.observationNodes || defaultOffspringObservationNodes(weanDate),
        fatherId,
        motherId,
        litterId,
        breedingInfo: {
          fatherId,
          motherId,
          litterId,
          pairingId: litter.pairId,
          weanDate,
          weaningWeight
        }
      };

      const animal = await addAnimal(db, animalInput, { ...options, skipEvent: true });
      animal.weanedAt = new Date().toISOString();
      animal.weaningWeight = weaningWeight;
      animal.notes.push({
        id: uid("note"),
        date: weanDate,
        weight: weaningWeight,
        condition: group.condition || "断奶分笼",
        keeper: group.keeper,
        type: "weaning"
      });

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
          fatherId,
          motherId,
          litterId,
          weanedAt: animal.weanedAt,
          weaningWeight,
          fromBreeding: true,
          pairingId: litter.pairId
        }, {
          animalId: animal.id,
          roomId: animal.roomId || null,
          zoneId: animal.zoneId || null,
          projectId: animal.projectId || null,
          operator: options.operator || null,
          snapshotAfter: animal,
          metadata: options.metadata || null
        });

        await recordEvent(EVENT_TYPES.BREEDING_LITTER_WEANED, {
          litterId,
          fatherId,
          motherId,
          weanDate,
          weaningWeight,
          pairingId: litter.pairId,
          animalId: animal.id
        }, {
          animalId: animal.id,
          roomId: animal.roomId || null,
          zoneId: animal.zoneId || null,
          projectId: animal.projectId || null,
          operator: options.operator || null,
          snapshotAfter: animal,
          metadata: options.metadata || null
        });
      }

      createdAnimals.push(animal);
      seqCounter++;
    }
  }

  litter.status = LITTER_STATUS.WEANED;
  litter.weanDate = weanDate;
  litter.weanedAt = new Date().toISOString();
  litter.weanedCount = createdAnimals.length;
  litter.weaningPlan = offspringPlan.map((g) => ({
    sex: g.sex,
    count: g.count,
    cageId: g.cageId,
    project: g.project,
    keeper: g.keeper
  }));

  if (pairing) {
    const pair = (db.breedingPairs || []).find((p) => p.id === pairing.id);
    if (pair) {
      pair.status = PAIRING_STATUS.WEANED;
      pair.weanedAt = new Date().toISOString();
    }
  }

  return {
    litter: getBreedingLitter(db, litterId),
    offspring: createdAnimals,
    totalCreated: createdAnimals.length
  };
}

function defaultOffspringObservationNodes(weanDate) {
  const nodes = [];
  for (const days of [7, 14, 21]) {
    const d = addDays(weanDate, days);
    if (d) nodes.push(d);
  }
  return nodes;
}

export function getOffspringByParent(db, parentId) {
  return (db.animals || []).filter(
    (a) =>
      (a.fatherId === parentId || a.motherId === parentId) &&
      a.status !== ANIMAL_STATUS.REMOVED
  );
}

export function getFamilyTree(db, animalId, depth = 3) {
  const result = {
    animal: null,
    father: null,
    mother: null,
    offspring: [],
    siblings: []
  };

  const animal = getAnimal(db, animalId);
  if (!animal) return null;

  result.animal = {
    id: animal.id,
    strain: animal.strain,
    sex: animal.sex,
    birthDate: animal.birthDate,
    cageId: animal.cageId,
    status: animal.status
  };

  if (animal.fatherId) {
    const father = getAnimal(db, animal.fatherId);
    if (father) {
      result.father = {
        id: father.id,
        strain: father.strain,
        sex: father.sex,
        birthDate: father.birthDate
      };
    }
  }

  if (animal.motherId) {
    const mother = getAnimal(db, animal.motherId);
    if (mother) {
      result.mother = {
        id: mother.id,
        strain: mother.strain,
        sex: mother.sex,
        birthDate: mother.birthDate
      };
    }
  }

  if (animal.litterId) {
    const siblings = (db.animals || []).filter(
      (a) => a.litterId === animal.litterId && a.id !== animalId
    );
    result.siblings = siblings.map((s) => ({
      id: s.id,
      sex: s.sex,
      cageId: s.cageId,
      status: s.status
    }));
  }

  result.offspring = getOffspringByParent(db, animalId).map((o) => ({
    id: o.id,
    sex: o.sex,
    birthDate: o.birthDate,
    cageId: o.cageId,
    status: o.status,
    litterId: o.litterId
  }));

  return result;
}

export function getBreedingStats(db, filters = {}) {
  let pairs = db.breedingPairs || [];
  let litters = db.breedingLitters || [];
  let animals = db.animals || [];

  if (filters.roomId) {
    pairs = pairs.filter((p) => p.roomId === filters.roomId);
    litters = litters.filter((l) => l.roomId === filters.roomId);
    const pairIdsInRoom = new Set(pairs.map(p => p.id));
    const litterIdsInRoom = new Set(litters.map(l => l.id));
    animals = animals.filter((a) => a.roomId === filters.roomId || a.litterId && litterIdsInRoom.has(a.litterId));
  }
  if (filters.projectId) {
    pairs = pairs.filter((p) => p.projectId === filters.projectId);
    litters = litters.filter((l) => l.projectId === filters.projectId);
  }

  const activePairs = pairs.filter((p) =>
    [PAIRING_STATUS.PENDING, PAIRING_STATUS.MATED, PAIRING_STATUS.PREGNANT, PAIRING_STATUS.DELIVERED].includes(p.status)
  );
  const pendingPairs = pairs.filter((p) => p.status === PAIRING_STATUS.PENDING);
  const pregnantPairs = pairs.filter((p) => p.status === PAIRING_STATUS.PREGNANT);
  const deliveredPairs = pairs.filter((p) => p.status === PAIRING_STATUS.DELIVERED);
  const weanedPairs = pairs.filter((p) => p.status === PAIRING_STATUS.WEANED);
  const cancelledPairs = pairs.filter((p) => p.status === PAIRING_STATUS.CANCELLED);

  const pendingLitters = litters.filter((l) => l.status === LITTER_STATUS.BORN);
  const weanedLitters = litters.filter((l) => l.status === LITTER_STATUS.WEANED);

  const totalPupsBorn = litters.reduce((s, l) => s + (l.totalPups || 0), 0);
  const totalWeaned = animals.filter((a) => a.litterId).length;

  const weaningRate = totalPupsBorn > 0 ? Math.round((totalWeaned / totalPupsBorn) * 10000) / 100 : 0;

  const avgLitterSize =
    litters.length > 0
      ? Math.round((totalPupsBorn / litters.length) * 100) / 100
      : 0;

  const offspringByStrain = {};
  const byRoom = {};
  for (const a of animals) {
    if (!a.litterId) continue;
    offspringByStrain[a.strain] = (offspringByStrain[a.strain] || 0) + 1;
    if (a.roomId) {
      byRoom[a.roomId] = byRoom[a.roomId] || { offspringCount: 0, litterIds: new Set(), pairIds: new Set() };
      byRoom[a.roomId].offspringCount += 1;
    }
  }
  for (const l of litters) {
    if (l.roomId) {
      byRoom[l.roomId] = byRoom[l.roomId] || { offspringCount: 0, litterIds: new Set(), pairIds: new Set() };
      byRoom[l.roomId].litterIds.add(l.id);
      byRoom[l.roomId].pupsBorn = (byRoom[l.roomId].pupsBorn || 0) + (l.totalPups || 0);
      if (l.pairId) byRoom[l.roomId].pairIds.add(l.pairId);
    }
  }
  for (const p of pairs) {
    if (p.roomId) {
      byRoom[p.roomId] = byRoom[p.roomId] || { offspringCount: 0, litterIds: new Set(), pairIds: new Set() };
      byRoom[p.roomId].pairIds.add(p.id);
    }
  }
  const byRoomSummary = {};
  for (const [roomId, data] of Object.entries(byRoom)) {
    byRoomSummary[roomId] = {
      pairCount: data.pairIds.size,
      litterCount: data.litterIds.size,
      offspringCount: data.offspringCount || 0,
      pupsBorn: data.pupsBorn || 0
    };
  }

  return {
    pairings: {
      total: pairs.length,
      active: activePairs.length,
      pending: pendingPairs.length,
      pregnant: pregnantPairs.length,
      delivered: deliveredPairs.length,
      weaned: weanedPairs.length,
      cancelled: cancelledPairs.length
    },
    litters: {
      total: litters.length,
      pending: pendingLitters.length,
      weaned: weanedLitters.length,
      totalPupsBorn,
      totalWeaned,
      weaningRate,
      avgLitterSize
    },
    offspringByStrain,
    byRoom: byRoomSummary,
    filtersApplied: filters
  };
}

const DEFAULT_WEANING_DAYS = 21;
const FORECAST_DAYS = 30;
const RISK_LEVEL = {
  NONE: "none",
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical"
};

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function diffDays(from, to) {
  const a = new Date(from);
  const b = new Date(to);
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function calculateWeaningForecast(db, options = {}) {
  const {
    weaningDays = DEFAULT_WEANING_DAYS,
    forecastDays = FORECAST_DAYS,
    principal = null,
    roomId = null,
    projectId = null
  } = options;

  const today = todayStr();
  const todayDate = new Date(today);
  const endDate = new Date(todayDate);
  endDate.setDate(endDate.getDate() + forecastDays - 1);
  const endDateStr = formatDate(endDate);

  const allRooms = db.rooms || [];
  const allProjects = db.projects || [];
  const allowedRoomIds = new Set();
  const allowedProjectIds = new Set();

  if (principal) {
    if (principal.role === "admin" || !principal.allowedRoomIds || principal.allowedRoomIds.includes("*")) {
      for (const r of allRooms) allowedRoomIds.add(r.id);
    } else {
      for (const rid of principal.allowedRoomIds) allowedRoomIds.add(rid);
    }
    if (principal.role === "admin" || !principal.allowedProjectIds || principal.allowedProjectIds.includes("*")) {
      for (const p of allProjects) allowedProjectIds.add(p.id);
    } else {
      for (const pid of principal.allowedProjectIds) allowedProjectIds.add(pid);
    }
  } else {
    for (const r of allRooms) allowedRoomIds.add(r.id);
    for (const p of allProjects) allowedProjectIds.add(p.id);
  }

  const rawLitters = (db.breedingLitters || []).filter((l) => {
    if (l.status === LITTER_STATUS.WEANED) return false;
    if (!l.birthDate) return false;
    return true;
  });

  const unweanedLitters = [];
  for (const l of rawLitters) {
    const enriched = enrichLitter(db, l);
    const litterRoomId = enriched.roomId || DEFAULT_ROOM_ID;
    const litterProjectId = enriched.projectId || null;

    if (!allowedRoomIds.has(litterRoomId)) continue;
    if (litterProjectId && !allowedProjectIds.has(litterProjectId)) continue;

    if (roomId && litterRoomId !== roomId) continue;
    if (projectId && litterProjectId !== projectId) continue;

    let expectedWeanDate = addDays(l.birthDate, weaningDays);
    if (!expectedWeanDate) continue;

    const isOverdue = expectedWeanDate < today;
    const scheduledDate = isOverdue ? today : expectedWeanDate;

    if (scheduledDate > endDateStr) continue;

    unweanedLitters.push({
      raw: l,
      enriched,
      _expectedWeanDate: expectedWeanDate,
      _scheduledDate: scheduledDate,
      _isOverdue: isOverdue
    });
  }

  const dailyPressure = {};
  const dateKeys = [];
  for (let i = 0; i < forecastDays; i++) {
    const d = new Date(todayDate);
    d.setDate(d.getDate() + i);
    const dateStr = formatDate(d);
    dateKeys.push(dateStr);
    dailyPressure[dateStr] = {
      date: dateStr,
      dayOfWeek: d.getDay(),
      litterIds: [],
      overdueLitterIds: [],
      maleCount: 0,
      femaleCount: 0,
      unknownSexCount: 0,
      totalCount: 0,
      overdueCount: 0,
      byRoom: {},
      byProject: {}
    };
  }

  const litterWeaningPlans = [];

  for (const entry of unweanedLitters) {
    const litter = entry.enriched;
    const scheduledDate = entry._scheduledDate;
    const isOverdue = entry._isOverdue;
    const expectedWeanDate = entry._expectedWeanDate;

    if (!dailyPressure[scheduledDate]) {
      continue;
    }

    const dayEntry = dailyPressure[scheduledDate];
    const maleCount = litter.malePups || 0;
    const femaleCount = litter.femalePups || 0;
    const unknownCount = litter.unknownSexPups || 0;
    const totalCount = litter.totalPups || 0;

    dayEntry.litterIds.push(litter.id);
    dayEntry.maleCount += maleCount;
    dayEntry.femaleCount += femaleCount;
    dayEntry.unknownSexCount += unknownCount;
    dayEntry.totalCount += totalCount;

    if (isOverdue) {
      dayEntry.overdueLitterIds.push(litter.id);
      dayEntry.overdueCount += totalCount;
    }

    const litterRoomId = litter.roomId || DEFAULT_ROOM_ID;
    const litterProjectId = litter.projectId || null;

    if (!dayEntry.byRoom[litterRoomId]) {
      dayEntry.byRoom[litterRoomId] = { maleCount: 0, femaleCount: 0, unknownSexCount: 0, totalCount: 0, litterIds: [], overdueCount: 0 };
    }
    dayEntry.byRoom[litterRoomId].maleCount += maleCount;
    dayEntry.byRoom[litterRoomId].femaleCount += femaleCount;
    dayEntry.byRoom[litterRoomId].unknownSexCount += unknownCount;
    dayEntry.byRoom[litterRoomId].totalCount += totalCount;
    dayEntry.byRoom[litterRoomId].litterIds.push(litter.id);
    if (isOverdue) dayEntry.byRoom[litterRoomId].overdueCount += totalCount;

    if (litterProjectId) {
      if (!dayEntry.byProject[litterProjectId]) {
        dayEntry.byProject[litterProjectId] = { maleCount: 0, femaleCount: 0, unknownSexCount: 0, totalCount: 0, litterIds: [], overdueCount: 0 };
      }
      dayEntry.byProject[litterProjectId].maleCount += maleCount;
      dayEntry.byProject[litterProjectId].femaleCount += femaleCount;
      dayEntry.byProject[litterProjectId].unknownSexCount += unknownCount;
      dayEntry.byProject[litterProjectId].totalCount += totalCount;
      dayEntry.byProject[litterProjectId].litterIds.push(litter.id);
      if (isOverdue) dayEntry.byProject[litterProjectId].overdueCount += totalCount;
    }

    const pair = litter.pairSummary
      ? (db.breedingPairs || []).find((p) => p.id === litter.pairSummary.id)
      : null;

    litterWeaningPlans.push({
      litterId: litter.id,
      pairId: litter.pairSummary?.id || null,
      birthDate: litter.birthDate,
      expectedWeanDate,
      scheduledWeanDate: scheduledDate,
      daysUntilWean: diffDays(today, scheduledDate),
      isOverdue,
      overdueDays: isOverdue ? diffDays(expectedWeanDate, today) : 0,
      strain: pair?.strain || null,
      roomId: litterRoomId,
      zoneId: litter.zoneId || null,
      project: litter.project || null,
      projectId: litterProjectId,
      keeper: litter.keeper || null,
      maleCount,
      femaleCount,
      unknownSexCount: unknownCount,
      totalCount,
      cageId: litter.cageId || litter.pairSummary?.cageId || null
    });
  }

  const activeCages = (db.cages || []).filter((c) => {
    if (c.status !== "active") return false;
    if (!allowedRoomIds.has(c.roomId)) return false;
    return true;
  });

  const cageCapacityMap = {};
  for (const cage of activeCages) {
    const occ = (db.animals || []).filter(
      (a) => a.cageId === cage.id && ["quarantine", "released", "quarantine_abnormal"].includes(a.status)
    ).length;
    cageCapacityMap[cage.id] = {
      ...cage,
      currentOccupancy: occ,
      availableSlots: Math.max(0, (cage.capacity || 5) - occ)
    };
  }

  const cageRecommendations = [];
  const riskItems = [];

  const sortedLitters = [...litterWeaningPlans].sort((a, b) => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    return a.daysUntilWean - b.daysUntilWean;
  });
  const cageFutureOccupancy = {};
  for (const cid of Object.keys(cageCapacityMap)) {
    cageFutureOccupancy[cid] = 0;
  }

  for (const plan of sortedLitters) {
    const groups = [];

    if (plan.maleCount > 0) {
      groups.push({ sex: "male", count: plan.maleCount, needAllocate: plan.maleCount });
    }
    if (plan.femaleCount > 0) {
      groups.push({ sex: "female", count: plan.femaleCount, needAllocate: plan.femaleCount });
    }
    if (plan.unknownSexCount > 0) {
      const halfMale = Math.floor(plan.unknownSexCount / 2);
      const halfFemale = plan.unknownSexCount - halfMale;
      if (halfMale > 0) {
        groups.push({ sex: "male", count: halfMale, needAllocate: halfMale, isUnknownSplit: true });
      }
      if (halfFemale > 0) {
        groups.push({ sex: "female", count: halfFemale, needAllocate: halfFemale, isUnknownSplit: true });
      }
    }

    const preferredRoomIds = plan.roomId ? [plan.roomId] : [...allowedRoomIds];

    for (const group of groups) {
      const candidateCages = Object.values(cageCapacityMap).filter((c) => {
        if (!preferredRoomIds.includes(c.roomId)) return false;
        return true;
      });

      candidateCages.sort((a, b) => {
        const aFuture = cageFutureOccupancy[a.id] || 0;
        const bFuture = cageFutureOccupancy[b.id] || 0;
        const aAvail = (a.availableSlots - aFuture);
        const bAvail = (b.availableSlots - bFuture);
        if (bAvail !== aAvail) return bAvail - aAvail;
        if (a.roomId !== b.roomId && plan.roomId) {
          if (a.roomId === plan.roomId) return -1;
          if (b.roomId === plan.roomId) return 1;
        }
        return (a.capacity || 5) - (b.capacity || 5);
      });

      let allocated = 0;
      const groupAllocations = [];

      for (const cage of candidateCages) {
        if (allocated >= group.needAllocate) break;
        const currentFuture = cageFutureOccupancy[cage.id] || 0;
        const realAvail = cage.availableSlots - currentFuture;
        if (realAvail <= 0) continue;

        const putCount = Math.min(realAvail, group.needAllocate - allocated);
        cageFutureOccupancy[cage.id] = currentFuture + putCount;
        allocated += putCount;
        groupAllocations.push({
          cageId: cage.id,
          roomId: cage.roomId,
          zoneId: cage.zoneId || null,
          capacity: cage.capacity || 5,
          currentOccupancy: cage.currentOccupancy,
          availableBefore: cage.availableSlots,
          availableAfterFutureAlloc: cage.availableSlots - cageFutureOccupancy[cage.id],
          allocatedCount: putCount
        });
      }

      if (allocated < group.needAllocate) {
        const shortfall = group.needAllocate - allocated;
        riskItems.push({
          litterId: plan.litterId,
          date: plan.scheduledWeanDate,
          daysUntilWean: plan.daysUntilWean,
          isOverdue: plan.isOverdue,
          overdueDays: plan.overdueDays,
          roomId: plan.roomId,
          projectId: plan.projectId || null,
          project: plan.project || null,
          sex: group.sex,
          requiredCount: group.needAllocate,
          allocatedCount: allocated,
          shortfall,
          reason: plan.isOverdue
            ? (shortfall === group.needAllocate ? "逾期未断奶且无可用笼位" : "逾期未断奶且笼位容量不足")
            : (shortfall === group.needAllocate ? "无可用笼位" : "笼位容量不足"),
          isUnknownSplit: group.isUnknownSplit || false
        });
      }

      if (groupAllocations.length > 0) {
        cageRecommendations.push({
          litterId: plan.litterId,
          pairId: plan.pairId,
          expectedWeanDate: plan.expectedWeanDate,
          scheduledWeanDate: plan.scheduledWeanDate,
          daysUntilWean: plan.daysUntilWean,
          isOverdue: plan.isOverdue,
          overdueDays: plan.overdueDays,
          strain: plan.strain,
          roomId: plan.roomId,
          projectId: plan.projectId || null,
          project: plan.project || null,
          keeper: plan.keeper,
          sex: group.sex,
          totalCount: group.count,
          allocatedCount: allocated,
          allocations: groupAllocations
        });
      }
    }
  }

  const byRoomPressure = {};
  const byProjectPressure = {};
  for (const dateStr of dateKeys) {
    const entry = dailyPressure[dateStr];
    for (const [rid, data] of Object.entries(entry.byRoom)) {
      if (!byRoomPressure[rid]) byRoomPressure[rid] = { maleCount: 0, femaleCount: 0, unknownSexCount: 0, totalCount: 0, overdueCount: 0, litterIds: new Set(), peakDate: null, peakTotal: 0 };
      byRoomPressure[rid].maleCount += data.maleCount;
      byRoomPressure[rid].femaleCount += data.femaleCount;
      byRoomPressure[rid].unknownSexCount += data.unknownSexCount;
      byRoomPressure[rid].totalCount += data.totalCount;
      byRoomPressure[rid].overdueCount += data.overdueCount || 0;
      for (const lid of data.litterIds) byRoomPressure[rid].litterIds.add(lid);
      if (data.totalCount > byRoomPressure[rid].peakTotal) {
        byRoomPressure[rid].peakTotal = data.totalCount;
        byRoomPressure[rid].peakDate = dateStr;
      }
    }
    for (const [pid, data] of Object.entries(entry.byProject)) {
      if (!byProjectPressure[pid]) byProjectPressure[pid] = { maleCount: 0, femaleCount: 0, unknownSexCount: 0, totalCount: 0, overdueCount: 0, litterIds: new Set(), peakDate: null, peakTotal: 0 };
      byProjectPressure[pid].maleCount += data.maleCount;
      byProjectPressure[pid].femaleCount += data.femaleCount;
      byProjectPressure[pid].unknownSexCount += data.unknownSexCount;
      byProjectPressure[pid].totalCount += data.totalCount;
      byProjectPressure[pid].overdueCount += data.overdueCount || 0;
      for (const lid of data.litterIds) byProjectPressure[pid].litterIds.add(lid);
      if (data.totalCount > byProjectPressure[pid].peakTotal) {
        byProjectPressure[pid].peakTotal = data.totalCount;
        byProjectPressure[pid].peakDate = dateStr;
      }
    }
  }

  const byRoomPressureResult = {};
  for (const [rid, data] of Object.entries(byRoomPressure)) {
    byRoomPressureResult[rid] = {
      roomId: rid,
      maleCount: data.maleCount,
      femaleCount: data.femaleCount,
      unknownSexCount: data.unknownSexCount,
      totalCount: data.totalCount,
      overdueCount: data.overdueCount,
      litterCount: data.litterIds.size,
      peakDate: data.peakDate,
      peakTotal: data.peakTotal
    };
  }
  const byProjectPressureResult = {};
  for (const [pid, data] of Object.entries(byProjectPressure)) {
    byProjectPressureResult[pid] = {
      projectId: pid,
      maleCount: data.maleCount,
      femaleCount: data.femaleCount,
      unknownSexCount: data.unknownSexCount,
      totalCount: data.totalCount,
      overdueCount: data.overdueCount,
      litterCount: data.litterIds.size,
      peakDate: data.peakDate,
      peakTotal: data.peakTotal
    };
  }

  let totalShortfall = 0;
  let totalAtRisk = 0;
  let totalOverdue = 0;
  let totalOverdueAnimals = 0;
  for (const risk of riskItems) {
    totalShortfall += risk.shortfall;
    totalAtRisk += risk.requiredCount;
  }
  for (const plan of litterWeaningPlans) {
    if (plan.isOverdue) {
      totalOverdue += 1;
      totalOverdueAnimals += plan.totalCount;
    }
  }

  let overallRisk = RISK_LEVEL.NONE;
  const totalPending = litterWeaningPlans.reduce((s, l) => s + l.totalCount, 0);
  if (totalPending > 0) {
    const riskRatio = totalShortfall / totalPending;
    const overdueRatio = totalOverdueAnimals / totalPending;
    const pressureRatio = Math.max(riskRatio, overdueRatio);
    if (pressureRatio === 0) overallRisk = RISK_LEVEL.NONE;
    else if (pressureRatio < 0.1) overallRisk = RISK_LEVEL.LOW;
    else if (pressureRatio < 0.3) overallRisk = RISK_LEVEL.MEDIUM;
    else if (pressureRatio < 0.6) overallRisk = RISK_LEVEL.HIGH;
    else overallRisk = RISK_LEVEL.CRITICAL;
  }

  const dailyPressureArray = dateKeys.map((d) => dailyPressure[d]);
  const peakDay = dailyPressureArray.reduce((max, cur) => cur.totalCount > max.totalCount ? cur : max, dailyPressureArray[0] || { totalCount: 0, date: null });

  return {
    period: {
      startDate: today,
      endDate: endDateStr,
      days: forecastDays,
      weaningDays
    },
    scope: {
      allowedRoomIds: [...allowedRoomIds],
      allowedProjectIds: [...allowedProjectIds]
    },
    summary: {
      totalLitters: litterWeaningPlans.length,
      totalPendingAnimals: totalPending,
      totalMale: litterWeaningPlans.reduce((s, l) => s + l.maleCount, 0),
      totalFemale: litterWeaningPlans.reduce((s, l) => s + l.femaleCount, 0),
      totalUnknownSex: litterWeaningPlans.reduce((s, l) => s + l.unknownSexCount, 0),
      totalOverdueLitters: totalOverdue,
      totalOverdueAnimals,
      totalAtRisk,
      totalShortfall,
      riskLevel: overallRisk,
      peakDate: peakDay.date,
      peakCount: peakDay.totalCount,
      roomsInScope: [...allowedRoomIds],
      projectsInScope: [...allowedProjectIds]
    },
    dailyPressure: dailyPressureArray,
    byRoom: byRoomPressureResult,
    byProject: byProjectPressureResult,
    litters: litterWeaningPlans,
    recommendations: cageRecommendations,
    risks: riskItems,
    cageCapacitySnapshot: Object.values(cageCapacityMap).map((c) => ({
      id: c.id,
      roomId: c.roomId,
      zoneId: c.zoneId || null,
      area: c.area || null,
      rack: c.rack || null,
      capacity: c.capacity || 5,
      currentOccupancy: c.currentOccupancy,
      availableSlots: c.availableSlots,
      futureAllocated: cageFutureOccupancy[c.id] || 0,
      remainingAfterFuture: c.availableSlots - (cageFutureOccupancy[c.id] || 0)
    }))
  };
}
