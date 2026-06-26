import type { FieldDef } from "../db/schema.js";

export class ValidationError extends Error {
  constructor(public issues: string[]) {
    super(`Validation failed:\n- ${issues.join("\n- ")}`);
    this.name = "ValidationError";
  }
}

/**
 * Validate a data object against a content type's field definitions.
 *
 * Returns a cleaned copy containing only declared fields (unknown keys are
 * dropped, not rejected — agents often send extra context). On a full (create)
 * validation, omitted fields fall back to their `default`; on a `partial`
 * update, omitted fields are left untouched and required/default are skipped.
 */
export function validateEntryData(
  fields: FieldDef[],
  data: Record<string, unknown>,
  opts: { partial?: boolean } = {},
): Record<string, unknown> {
  const issues: string[] = [];
  const clean: Record<string, unknown> = {};

  for (const field of fields) {
    const present = Object.prototype.hasOwnProperty.call(data, field.name);
    let value = data[field.name];

    if (!present || value === null || value === undefined) {
      // Apply defaults only on full validation (create), not partial updates.
      if (!opts.partial && field.default !== undefined) {
        value = field.default;
      } else {
        if (field.required && !opts.partial) {
          issues.push(`"${field.name}" is required`);
        }
        continue;
      }
    }

    const typeErr = checkType(field, value);
    if (typeErr) {
      issues.push(`"${field.name}": ${typeErr}`);
      continue;
    }
    const consErr = checkConstraints(field, value);
    if (consErr) {
      issues.push(`"${field.name}": ${consErr}`);
      continue;
    }
    clean[field.name] = value;
  }

  if (issues.length > 0) throw new ValidationError(issues);
  return clean;
}

function checkType(field: FieldDef, value: unknown): string | null {
  switch (field.type) {
    case "text":
    case "richtext":
    case "select":
      return typeof value === "string" ? null : "expected a string";
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : "expected a number";
    case "boolean":
      return typeof value === "boolean" ? null : "expected a boolean";
    case "date":
      // Accept ISO strings; reject anything unparseable.
      return typeof value === "string" && !Number.isNaN(Date.parse(value))
        ? null
        : "expected an ISO date string";
    case "json":
      return typeof value === "object" ? null : "expected an object or array";
    case "reference":
      // A reference holds the UUID of another entry.
      return typeof value === "string" && value.length > 0
        ? null
        : "expected an entry id (uuid string)";
    default:
      return `unknown field type "${(field as FieldDef).type}"`;
  }
}

/** Check value-level constraints (options, length/range, pattern). */
function checkConstraints(field: FieldDef, value: unknown): string | null {
  if (field.type === "select") {
    const options = field.options ?? [];
    if (!options.includes(value as string)) {
      return `must be one of: ${options.join(", ")}`;
    }
  }

  if (field.type === "number" && typeof value === "number") {
    if (field.min !== undefined && value < field.min) {
      return `must be >= ${field.min}`;
    }
    if (field.max !== undefined && value > field.max) {
      return `must be <= ${field.max}`;
    }
  }

  if ((field.type === "text" || field.type === "richtext") && typeof value === "string") {
    if (field.min !== undefined && value.length < field.min) {
      return `must be at least ${field.min} characters`;
    }
    if (field.max !== undefined && value.length > field.max) {
      return `must be at most ${field.max} characters`;
    }
    if (field.pattern !== undefined && !new RegExp(field.pattern).test(value)) {
      return `must match pattern ${field.pattern}`;
    }
  }

  return null;
}

const FIELD_NAME_RE = /^[a-z][a-z0-9_]*$/;
const VALID_TYPES = new Set([
  "text",
  "richtext",
  "number",
  "boolean",
  "date",
  "json",
  "reference",
  "select",
]);

/** Validate field definitions supplied when creating a content type. */
export function validateFieldDefs(fields: FieldDef[]): void {
  const issues: string[] = [];
  const seen = new Set<string>();

  for (const f of fields) {
    if (!FIELD_NAME_RE.test(f.name)) {
      issues.push(`field name "${f.name}" must be snake_case (a-z, 0-9, _)`);
    }
    if (seen.has(f.name)) issues.push(`duplicate field name "${f.name}"`);
    seen.add(f.name);

    if (!VALID_TYPES.has(f.type)) {
      issues.push(`field "${f.name}" has unknown type "${f.type}"`);
      continue;
    }
    if (f.type === "reference" && !f.refType) {
      issues.push(`reference field "${f.name}" must specify refType`);
    }
    if (f.type === "select" && (!Array.isArray(f.options) || f.options.length === 0)) {
      issues.push(`select field "${f.name}" must specify non-empty options`);
    }
    if (f.min !== undefined && f.max !== undefined && f.min > f.max) {
      issues.push(`field "${f.name}" has min greater than max`);
    }
    if (f.pattern !== undefined) {
      try {
        new RegExp(f.pattern);
      } catch {
        issues.push(`field "${f.name}" has an invalid pattern`);
      }
    }
    // A default, if given, must itself satisfy the field's type and constraints.
    if (f.default !== undefined) {
      const typeErr = checkType(f, f.default);
      const consErr = typeErr ? null : checkConstraints(f, f.default);
      if (typeErr || consErr) {
        issues.push(`field "${f.name}" default is invalid: ${typeErr ?? consErr}`);
      }
    }
  }

  if (issues.length > 0) throw new ValidationError(issues);
}
