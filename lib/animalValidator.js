import { validateCageForAnimal } from "./cageValidator.js";

export const REQUIRED_FIELDS = ["strain", "cageId", "sex", "birthDate", "project", "keeper"];

export const VALID_SEX = ["male", "female"];

export const ANIMAL_STATUS = {
  QUARANTINE: "quarantine",
  RELEASED: "released",
  QUARANTINE_ABNORMAL: "quarantine_abnormal",
  REMOVED: "removed"
};

export const VALID_STATUS = Object.values(ANIMAL_STATUS);

export const STATUS_LABELS = {
  [ANIMAL_STATUS.QUARANTINE]: "检疫中",
  [ANIMAL_STATUS.RELEASED]: "已放行",
  [ANIMAL_STATUS.QUARANTINE_ABNORMAL]: "检疫异常",
  [ANIMAL_STATUS.REMOVED]: "已移出"
};

export const ACTIVE_STOCK_STATUSES = [ANIMAL_STATUS.RELEASED];

export const OCCUPANCY_STATUSES = [
  ANIMAL_STATUS.QUARANTINE,
  ANIMAL_STATUS.RELEASED,
  ANIMAL_STATUS.QUARANTINE_ABNORMAL
];

export function validateAnimalFields(input) {
  const errors = [];

  for (const field of REQUIRED_FIELDS) {
    if (input[field] === undefined || input[field] === null || input[field] === "") {
      errors.push({
        code: "missing_field",
        field,
        message: `缺少必填字段：${field}`
      });
    }
  }

  if (input.sex !== undefined && input.sex !== null && !VALID_SEX.includes(input.sex)) {
    errors.push({
      code: "invalid_sex",
      field: "sex",
      message: `性别必须是 male 或 female，当前值：${input.sex}`
    });
  }

  if (input.birthDate !== undefined && input.birthDate !== null) {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(input.birthDate)) {
      errors.push({
        code: "invalid_birth_date",
        field: "birthDate",
        message: `出生日期格式应为 YYYY-MM-DD，当前值：${input.birthDate}`
      });
    } else {
      const date = new Date(input.birthDate);
      if (isNaN(date.getTime())) {
        errors.push({
          code: "invalid_birth_date",
          field: "birthDate",
          message: `出生日期无效：${input.birthDate}`
        });
      }
    }
  }

  if (input.observationNodes !== undefined && !Array.isArray(input.observationNodes)) {
    errors.push({
      code: "invalid_observation_nodes",
      field: "observationNodes",
      message: "observationNodes 必须是数组"
    });
  }

  if (input.id !== undefined && (typeof input.id !== "string" || input.id.trim() === "")) {
    errors.push({
      code: "invalid_id",
      field: "id",
      message: "id 必须是非空字符串"
    });
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function validateAnimalCage(db, cageId, principal = null) {
  return validateCageForAnimal(db, cageId, null, principal);
}

export function validateAnimalFull(db, input, principal = null) {
  const fieldValidation = validateAnimalFields(input);
  if (!fieldValidation.valid) {
    return { valid: false, errors: fieldValidation.errors };
  }

  const cageValidation = validateAnimalCage(db, input.cageId, principal);
  if (!cageValidation.valid) {
    return { valid: false, errors: cageValidation.errors };
  }

  return { valid: true, errors: [] };
}
