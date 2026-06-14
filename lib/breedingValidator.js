import { getAnimal } from "./animalData.js";
import { getCage, countOccupancy } from "./cageData.js";
import { VALID_SEX, ANIMAL_STATUS, ACTIVE_STOCK_STATUSES } from "./animalValidator.js";

export const PAIRING_STATUS = {
  PENDING: "pending",
  MATED: "mated",
  PREGNANT: "pregnant",
  DELIVERED: "delivered",
  WEANED: "weaned",
  CANCELLED: "cancelled"
};

export const VALID_PAIRING_STATUS = Object.values(PAIRING_STATUS);

export const LITTER_STATUS = {
  BORN: "born",
  WEANING: "weaning",
  WEANED: "weaned"
};

export const VALID_LITTER_STATUS = Object.values(LITTER_STATUS);

export const PAIRING_REQUIRED_FIELDS = ["cageId", "maleId", "femaleId", "pairDate"];
export const LITTER_REQUIRED_FIELDS = ["pairId", "birthDate", "totalPups"];

function isValidDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return false;
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(dateStr)) return false;
  const d = new Date(dateStr);
  return !isNaN(d.getTime());
}

function animalIsBreedingEligible(animal) {
  if (!animal) return { valid: false, reason: "动物不存在" };
  if (!ACTIVE_STOCK_STATUSES.includes(animal.status)) {
    return { valid: false, reason: `动物状态 ${animal.status} 不适合繁育（需为已放行状态）` };
  }
  return { valid: true };
}

export function validatePairingFields(input, db) {
  const errors = [];

  for (const field of PAIRING_REQUIRED_FIELDS) {
    if (input[field] === undefined || input[field] === null || input[field] === "") {
      errors.push({
        code: "missing_field",
        field,
        message: `缺少必填字段：${field}`
      });
    }
  }

  if (input.pairDate && !isValidDate(input.pairDate)) {
    errors.push({
      code: "invalid_pair_date",
      field: "pairDate",
      message: `合笼日期格式无效：${input.pairDate}`
    });
  }

  if (input.expectedDeliveryDate && !isValidDate(input.expectedDeliveryDate)) {
    errors.push({
      code: "invalid_expected_delivery_date",
      field: "expectedDeliveryDate",
      message: `预产期格式无效：${input.expectedDeliveryDate}`
    });
  }

  if (input.observationNodes !== undefined && !Array.isArray(input.observationNodes)) {
    errors.push({
      code: "invalid_observation_nodes",
      field: "observationNodes",
      message: "预产观察节点必须是数组"
    });
  }

  if (Array.isArray(input.observationNodes)) {
    for (let i = 0; i < input.observationNodes.length; i++) {
      const node = input.observationNodes[i];
      if (!isValidDate(node)) {
        errors.push({
          code: "invalid_observation_node",
          field: `observationNodes[${i}]`,
          message: `观察节点日期格式无效：${node}`
        });
      }
    }
  }

  if (input.status && !VALID_PAIRING_STATUS.includes(input.status)) {
    errors.push({
      code: "invalid_status",
      field: "status",
      message: `配对状态必须是 ${VALID_PAIRING_STATUS.join(" / ")}`
    });
  }

  return { valid: errors.length === 0, errors };
}

export function validatePairingRelations(input, db, excludePairingId = null) {
  const errors = [];

  const cage = getCage(db, input.cageId);
  if (!cage) {
    errors.push({ code: "cage_not_found", field: "cageId", message: `笼位 ${input.cageId} 不存在` });
  } else if (cage.status === "disabled") {
    errors.push({ code: "cage_disabled", field: "cageId", message: `笼位 ${input.cageId} 已停用` });
  }

  const male = getAnimal(db, input.maleId);
  const maleCheck = animalIsBreedingEligible(male);
  if (!male) {
    errors.push({ code: "male_not_found", field: "maleId", message: `父本动物 ${input.maleId} 不存在` });
  } else {
    if (!maleCheck.valid) {
      errors.push({ code: "male_not_eligible", field: "maleId", message: maleCheck.reason });
    }
    if (male.sex !== "male") {
      errors.push({ code: "male_wrong_sex", field: "maleId", message: "父本动物性别必须为雄性" });
    }
  }

  const female = getAnimal(db, input.femaleId);
  const femaleCheck = animalIsBreedingEligible(female);
  if (!female) {
    errors.push({ code: "female_not_found", field: "femaleId", message: `母本动物 ${input.femaleId} 不存在` });
  } else {
    if (!femaleCheck.valid) {
      errors.push({ code: "female_not_eligible", field: "femaleId", message: femaleCheck.reason });
    }
    if (female.sex !== "female") {
      errors.push({ code: "female_wrong_sex", field: "femaleId", message: "母本动物性别必须为雌性" });
    }
  }

  if (male && female && male.strain !== female.strain) {
    errors.push({
      code: "strain_mismatch",
      field: "strain",
      message: `父本品系(${male.strain})与母本品系(${female.strain})不一致`
    });
  }

  if (male && female && male.id === female.id) {
    errors.push({
      code: "same_animal",
      field: "maleId/femaleId",
      message: "父本和母本不能是同一只动物"
    });
  }

  if (!errors.length) {
    const activePairings = (db.breedingPairs || []).filter((p) => {
      if (excludePairingId && p.id === excludePairingId) return false;
      return p.status !== PAIRING_STATUS.CANCELLED && p.status !== PAIRING_STATUS.WEANED;
    });

    const maleConflict = activePairings.find((p) => p.maleId === input.maleId);
    if (maleConflict) {
      errors.push({
        code: "male_in_active_pairing",
        field: "maleId",
        message: `父本 ${input.maleId} 已参与配对 ${maleConflict.id}`
      });
    }

    const femaleConflict = activePairings.find((p) => p.femaleId === input.femaleId);
    if (femaleConflict) {
      errors.push({
        code: "female_in_active_pairing",
        field: "femaleId",
        message: `母本 ${input.femaleId} 已参与配对 ${femaleConflict.id}`
      });
    }
  }

  return { valid: errors.length === 0, errors, cage, male, female };
}

export function validatePairingFull(input, db, excludePairingId = null) {
  const fieldResult = validatePairingFields(input, db);
  if (!fieldResult.valid) return fieldResult;
  return validatePairingRelations(input, db, excludePairingId);
}

export function validateLitterFields(input) {
  const errors = [];

  for (const field of LITTER_REQUIRED_FIELDS) {
    if (input[field] === undefined || input[field] === null) {
      errors.push({
        code: "missing_field",
        field,
        message: `缺少必填字段：${field}`
      });
    }
  }

  if (input.birthDate && !isValidDate(input.birthDate)) {
    errors.push({
      code: "invalid_birth_date",
      field: "birthDate",
      message: `出生日期格式无效：${input.birthDate}`
    });
  }

  if (input.weanDate && !isValidDate(input.weanDate)) {
    errors.push({
      code: "invalid_wean_date",
      field: "weanDate",
      message: `断奶日期格式无效：${input.weanDate}`
    });
  }

  if (input.totalPups !== undefined) {
    if (typeof input.totalPups !== "number" || input.totalPups < 0 || !Number.isInteger(input.totalPups)) {
      errors.push({
        code: "invalid_total_pups",
        field: "totalPups",
        message: "出生总数必须是非负整数"
      });
    }
  }

  if (input.malePups !== undefined) {
    if (typeof input.malePups !== "number" || input.malePups < 0 || !Number.isInteger(input.malePups)) {
      errors.push({
        code: "invalid_male_pups",
        field: "malePups",
        message: "雄性数必须是非负整数"
      });
    }
  }

  if (input.femalePups !== undefined) {
    if (typeof input.femalePups !== "number" || input.femalePups < 0 || !Number.isInteger(input.femalePups)) {
      errors.push({
        code: "invalid_female_pups",
        field: "femalePups",
        message: "雌性数必须是非负整数"
      });
    }
  }

  if (input.totalPups !== undefined && input.malePups !== undefined && input.femalePups !== undefined) {
    if (input.malePups + input.femalePups > input.totalPups) {
      errors.push({
        code: "pups_count_mismatch",
        field: "totalPups/malePups/femalePups",
        message: "雄性数 + 雌性数不能超过出生总数"
      });
    }
  }

  if (input.status && !VALID_LITTER_STATUS.includes(input.status)) {
    errors.push({
      code: "invalid_status",
      field: "status",
      message: `窝仔状态必须是 ${VALID_LITTER_STATUS.join(" / ")}`
    });
  }

  return { valid: errors.length === 0, errors };
}

export function validateLitterRelations(input, db) {
  const errors = [];

  const pairing = (db.breedingPairs || []).find((p) => p.id === input.pairId);
  if (!pairing) {
    errors.push({ code: "pairing_not_found", field: "pairId", message: `配对记录 ${input.pairId} 不存在` });
    return { valid: false, errors, pairing: null };
  }

  if (pairing.status === PAIRING_STATUS.CANCELLED) {
    errors.push({
      code: "pairing_cancelled",
      field: "pairId",
      message: `配对 ${pairing.id} 已取消，不能登记窝仔`
    });
  }

  if (input.birthDate && pairing.pairDate && input.birthDate < pairing.pairDate) {
    errors.push({
      code: "birth_before_pair",
      field: "birthDate",
      message: `出生日期 ${input.birthDate} 不能早于合笼日期 ${pairing.pairDate}`
    });
  }

  return { valid: errors.length === 0, errors, pairing };
}

export function validateLitterFull(input, db) {
  const fieldResult = validateLitterFields(input);
  if (!fieldResult.valid) return fieldResult;
  return validateLitterRelations(input, db);
}

export function validateWeaningPlan(input, db, litter) {
  const errors = [];

  if (!litter) {
    errors.push({ code: "litter_not_found", message: "窝仔记录不存在" });
    return { valid: false, errors };
  }

  if (litter.status === LITTER_STATUS.WEANED) {
    errors.push({ code: "litter_already_weaned", message: "该窝仔已完成断奶" });
  }

  if (!input.weanDate || !isValidDate(input.weanDate)) {
    errors.push({ code: "invalid_wean_date", field: "weanDate", message: "断奶日期格式无效" });
  }

  if (input.weanDate && litter.birthDate && input.weanDate < litter.birthDate) {
    errors.push({
      code: "wean_before_birth",
      field: "weanDate",
      message: `断奶日期不能早于出生日期 ${litter.birthDate}`
    });
  }

  if (!Array.isArray(input.offspring)) {
    errors.push({ code: "missing_offspring", field: "offspring", message: "缺少子代配置数组 offspring" });
  } else {
    const totalWeaning = input.offspring.reduce((sum, o) => sum + (o.count || 0), 0);
    if (totalWeaning === 0) {
      errors.push({ code: "no_offspring", field: "offspring", message: "子代配置数量不能为0" });
    }
    if (totalWeaning > litter.totalPups) {
      errors.push({
        code: "offspring_exceed_total",
        field: "offspring",
        message: `断量子代数(${totalWeaning})不能超过窝仔总数(${litter.totalPups})`
      });
    }

    input.offspring.forEach((item, idx) => {
      if (!item.sex || !VALID_SEX.includes(item.sex)) {
        errors.push({
          code: "invalid_offspring_sex",
          field: `offspring[${idx}].sex`,
          message: `子代数组第${idx + 1}项性别无效`
        });
      }
      if (!item.cageId) {
        errors.push({
          code: "missing_offspring_cage",
          field: `offspring[${idx}].cageId`,
          message: `子代数组第${idx + 1}项缺少 cageId`
        });
      } else {
        const cage = getCage(db, item.cageId);
        if (!cage) {
          errors.push({
            code: "offspring_cage_not_found",
            field: `offspring[${idx}].cageId`,
            message: `子代数组第${idx + 1}项笼位 ${item.cageId} 不存在`
          });
        } else if (cage.status === "disabled") {
          errors.push({
            code: "offspring_cage_disabled",
            field: `offspring[${idx}].cageId`,
            message: `子代数组第${idx + 1}项笼位 ${item.cageId} 已停用`
          });
        }
      }
      if (item.count === undefined || item.count === null || item.count <= 0 || !Number.isInteger(item.count)) {
        errors.push({
          code: "invalid_offspring_count",
          field: `offspring[${idx}].count`,
          message: `子代数组第${idx + 1}项 count 必须是正整数`
        });
      }
      if (!item.keeper) {
        errors.push({
          code: "missing_offspring_keeper",
          field: `offspring[${idx}].keeper`,
          message: `子代数组第${idx + 1}项缺少 keeper`
        });
      }
      if (!item.project) {
        errors.push({
          code: "missing_offspring_project",
          field: `offspring[${idx}].project`,
          message: `子代数组第${idx + 1}项缺少 project`
        });
      }
    });

    if (!errors.some(e => e.code.startsWith("offspring_cage_") || e.code === "invalid_offspring_count")) {
      const cageCounts = {};
      input.offspring.forEach(item => {
        if (!cageCounts[item.cageId]) cageCounts[item.cageId] = 0;
        cageCounts[item.cageId] += item.count || 0;
      });
      for (const [cageId, addCount] of Object.entries(cageCounts)) {
        const cage = getCage(db, cageId);
        if (!cage) continue;
        const currentOccupancy = countOccupancy(db, cageId);
        const capacity = cage.capacity || 5;
        if (currentOccupancy + addCount > capacity) {
          errors.push({
            code: "offspring_cage_over_capacity",
            field: `offspring`,
            message: `笼位 ${cageId} 容量不足：当前 ${currentOccupancy} 只 + 新增 ${addCount} 只 > 容量 ${capacity} 只`
          });
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function calculateExpectedDeliveryDate(pairDate, gestationDays = 21) {
  if (!isValidDate(pairDate)) return null;
  const d = new Date(pairDate);
  d.setDate(d.getDate() + gestationDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function generateObservationNodes(pairDate, expectedDeliveryDate) {
  const nodes = [];
  if (!isValidDate(pairDate)) return nodes;

  const start = new Date(pairDate);

  const milestones = [7, 14];
  for (const days of milestones) {
    const d = new Date(start);
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    nodes.push(`${y}-${m}-${day}`);
  }

  if (isValidDate(expectedDeliveryDate)) {
    const edd = new Date(expectedDeliveryDate);
    for (const days of [-2, 0, 3]) {
      const d = new Date(edd);
      d.setDate(d.getDate() + days);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      nodes.push(`${y}-${m}-${day}`);
    }
  }

  return [...new Set(nodes)].sort();
}
