export function listAnimals(db, filters = {}) {
  let animals = db.animals || [];
  if (filters.project) animals = animals.filter((a) => a.project === filters.project);
  if (filters.cageId) animals = animals.filter((a) => a.cageId === filters.cageId);
  if (filters.status) animals = animals.filter((a) => a.status === filters.status);
  return animals;
}

export function getAnimal(db, id) {
  return (db.animals || []).find((a) => a.id === id) || null;
}

export function addAnimal(db, input) {
  if (!db.animals) db.animals = [];
  const animal = {
    id: input.id || `ani-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
  return animal;
}

export function addNote(db, animalId, input) {
  const animal = getAnimal(db, animalId);
  if (!animal) return null;
  const note = {
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date: input.date || new Date().toISOString().slice(0, 10),
    weight: input.weight,
    condition: input.condition,
    keeper: input.keeper || animal.keeper
  };
  animal.notes.push(note);
  return note;
}

export function moveAnimal(db, animalId, targetCageId, reason) {
  const animal = getAnimal(db, animalId);
  if (!animal) return null;
  const move = {
    id: `move-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    from: animal.cageId,
    to: targetCageId,
    movedAt: new Date().toISOString(),
    reason: reason || "笼位调整"
  };
  animal.cageId = targetCageId;
  animal.moves.push(move);
  return animal;
}

export function removeAnimal(db, animalId, reason) {
  const animal = getAnimal(db, animalId);
  if (!animal) return null;
  animal.status = "removed";
  animal.removedAt = new Date().toISOString();
  animal.removeReason = reason || "移出";
  return animal;
}

export function batchAddAnimals(db, animalsInput) {
  const results = [];
  for (const input of animalsInput) {
    const animal = addAnimal(db, input);
    results.push(animal);
  }
  return results;
}

export function getAnimalIds(db) {
  return (db.animals || []).map((a) => a.id);
}
