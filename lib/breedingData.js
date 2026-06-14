import { addAnimal, getAnimal, moveAnimal } from "./animalData.js";
import { getCage, countOccupancy } from "./cageData.js";
import { ANIMAL_STATUS } from "./animalValidator.js";
import {
  PAIRING_STATUS,
  LITTER_STATUS,
  calculateExpectedDeliveryDate,
  generateObservationNodes
} from "./breedingValidator.js";

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
  const litters = (db.breedingLitters || []).filter((l) => l.pairId === pair.id);
  return {
    ...pair,
    strain: male?.strain || pair.strain || null,
    maleSummary: male ? { id: male.id, strain: male.strain, birthDate: male.birthDate, status: male.status } : null,
    femaleSummary: female ? { id: female.id, strain: female.strain, birthDate: female.birthDate, status: female.status } : null,
    cageSummary: cage ? { id: cage.id, area: cage.area, rack: cage.rack, capacity: cage.capacity } : null,
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
      weanedCount: l.weanedCount || 0
    }))
  };
}

export function createBreedingPair(db, input) {
  if (!db.breedingPairs) db.breedingPairs = [];

  const expectedDeliveryDate =
    input.expectedDeliveryDate || calculateExpectedDeliveryDate(input.pairDate);
  const observationNodes =
    input.observationNodes && input.observationNodes.length > 0
      ? input.observationNodes
      : generateObservationNodes(input.pairDate, expectedDeliveryDate);

  const male = getAnimal(db, input.maleId);
  const strain = male?.strain || null;

  const pair = {
    id: input.id || uid("pair"),
    cageId: input.cageId,
    maleId: input.maleId,
    femaleId: input.femaleId,
    pairDate: input.pairDate,
    expectedDeliveryDate,
    observationNodes,
    status: input.status || PAIRING_STATUS.PENDING,
    strain,
    keeper: input.keeper || (male?.keeper) || null,
    notes: input.notes || "",
    createdAt: new Date().toISOString()
  };

  db.breedingPairs.push(pair);

  if (male && male.cageId !== input.cageId) {
    moveAnimal(db, input.maleId, input.cageId, "合笼配对移入");
  }
  const female = getAnimal(db, input.femaleId);
  if (female && female.cageId !== input.cageId) {
    moveAnimal(db, input.femaleId, input.cageId, "合笼配对移入");
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
  return {
    ...litter,
    pairSummary: pair
      ? {
          id: pair.id,
          maleId: pair.maleId,
          femaleId: pair.femaleId,
          cageId: pair.cageId,
          pairDate: pair.pairDate,
          status: pair.status
        }
      : null,
    fatherId: pair?.maleId || null,
    motherId: pair?.femaleId || null,
    weanedCount: offspring.length,
    offspringIds: offspring.map((a) => a.id)
  };
}

export function createBreedingLitter(db, input, pairing) {
  if (!db.breedingLitters) db.breedingLitters = [];

  const litter = {
    id: input.id || uid("litter"),
    pairId: input.pairId,
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

export function weanLitter(db, litterId, weanDate, offspringPlan, pairing) {
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

      const animal = addAnimal(db, animalInput);
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

export function getBreedingStats(db) {
  const pairs = db.breedingPairs || [];
  const litters = db.breedingLitters || [];
  const animals = db.animals || [];

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
  for (const a of animals) {
    if (!a.litterId) continue;
    offspringByStrain[a.strain] = (offspringByStrain[a.strain] || 0) + 1;
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
    offspringByStrain
  };
}
