export function listCages(db, filters = {}) {
  let cages = db.cages || [];
  if (filters.area) cages = cages.filter((c) => c.area === filters.area);
  if (filters.rack) cages = cages.filter((c) => c.rack === filters.rack);
  if (filters.status) cages = cages.filter((c) => c.status === filters.status);
  return cages.map((cage) => ({
    ...cage,
    occupancy: countOccupancy(db, cage.id)
  }));
}

export function getCage(db, id) {
  const cage = (db.cages || []).find((c) => c.id === id);
  if (!cage) return null;
  return { ...cage, occupancy: countOccupancy(db, cage.id) };
}

export function addCage(db, input) {
  if (!db.cages) db.cages = [];
  const cage = {
    id: input.id || `cage-${Date.now()}`,
    area: input.area,
    rack: input.rack,
    capacity: input.capacity || 5,
    status: "active",
    createdAt: new Date().toISOString()
  };
  db.cages.push(cage);
  return cage;
}

export function disableCage(db, id) {
  const cage = (db.cages || []).find((c) => c.id === id);
  if (!cage) return null;
  cage.status = "disabled";
  cage.disabledAt = new Date().toISOString();
  return cage;
}

export function countOccupancy(db, cageId) {
  return (db.animals || []).filter(
    (a) => a.cageId === cageId && a.status === "active"
  ).length;
}
