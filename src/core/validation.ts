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
 * dropped, not rejected — agents often send extra context). On `partial`
 * updates, required checks are skipped for omitted fields.
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
    const value = data[field.name];

    if (!present || value === null || value === undefined) {
      if (field.required && !opts.partial) {
        issues.push(`"${field.name}" is required`);
      }
      continue;
    }

    const err = checkType(field, value);
    if (err) {
      issues.push(`"${field.name}": ${err}`);
    } else {
      clean[field.name] = value;
    }
  }

  if (issues.length > 0) throw new ValidationError(issues);
  return clean;
}

function checkType(field: FieldDef, value: unknown): string | null {
  switch (field.type) {
    case "text":
    case "richtext":
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

const FIELD_NAME_RE = /^[a-z][a-z0-9_]*$/;
const VALID_TYPES = new Set([
  "text",
  "richtext",
  "number",
  "boolean",
  "date",
  "json",
  "reference",
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
    }
    if (f.type === "reference" && !f.refType) {
      issues.push(`reference field "${f.name}" must specify refType`);
    }
  }

  if (issues.length > 0) throw new ValidationError(issues);
}
