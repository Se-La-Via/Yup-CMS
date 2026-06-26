import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  jsonb,
  integer,
  boolean,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";

/**
 * Who or what performed a change. This distinction is first-class in Yup CMS:
 * an agent-native CMS must always be able to answer "did a human or a machine
 * write this?" — it is the basis of trust, review gates, and rollback.
 */
export const authorType = pgEnum("author_type", ["human", "agent", "system"]);

export const entryStatus = pgEnum("entry_status", [
  "draft",
  "pending_review",
  "published",
  "archived",
]);

export const reviewStatus = pgEnum("review_status", [
  "pending",
  "approved",
  "rejected",
]);

/**
 * A content type is a self-describing schema. Agents read this to learn what
 * shapes of content exist and what fields each one has, then operate on entries
 * without any out-of-band knowledge.
 *
 * `fields` is an array of field definitions — see src/core/validation.ts for the
 * supported field types and their validation rules.
 */
export const contentTypes = pgTable("content_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Machine name, e.g. "blog_post". Stable identifier used by agents.
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  fields: jsonb("fields").$type<FieldDef[]>().notNull().default([]),
  // When true, an *agent* cannot publish entries of this type directly — a
  // publish request is queued for a human to approve. Humans bypass the gate.
  requireApproval: boolean("require_approval").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A content entry is one record of a given type. `data` holds the field values,
 * validated against the type's schema. `revision` always points at the latest
 * snapshot in content_revisions.
 */
export const contentEntries = pgTable(
  "content_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    typeId: uuid("type_id")
      .notNull()
      .references(() => contentTypes.id, { onDelete: "cascade" }),
    slug: text("slug"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    status: entryStatus("status").notNull().default("draft"),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Slugs are unique within a content type, when present.
    slugPerType: unique("entries_slug_per_type").on(t.typeId, t.slug),
    // Listing entries by type + status is the hottest read path.
    byTypeStatus: index("entries_type_status").on(t.typeId, t.status),
  }),
);

/**
 * The audit trail. Every create, update, publish, and revert appends an
 * immutable snapshot here — with the author and an optional human-readable note
 * explaining *why*. This is the spine of the product: agents can act, but every
 * action is recorded, attributable, and reversible.
 */
export const contentRevisions = pgTable(
  "content_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => contentEntries.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    status: entryStatus("status").notNull(),
    // What action produced this snapshot, e.g. "create", "update", "publish".
    action: text("action").notNull(),
    authorType: authorType("author_type").notNull(),
    authorId: text("author_id").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    revPerEntry: unique("revision_per_entry").on(t.entryId, t.revision),
  }),
);

/**
 * Review gate. When an agent tries to publish an entry of a type that requires
 * approval, the publish is held and a review request is queued here for a human
 * to approve or reject. This is the trust boundary: agents propose, humans
 * dispose. Pairs with author attribution — the gate keys on author.type.
 */
export const reviewRequests = pgTable("review_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryId: uuid("entry_id")
    .notNull()
    .references(() => contentEntries.id, { onDelete: "cascade" }),
  // The entry revision being reviewed.
  revision: integer("revision").notNull(),
  requestedByType: authorType("requested_by_type").notNull(),
  requestedById: text("requested_by_id").notNull(),
  requestNote: text("request_note"),
  status: reviewStatus("status").notNull().default("pending"),
  decidedByType: authorType("decided_by_type"),
  decidedById: text("decided_by_id"),
  decisionNote: text("decision_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
}, (t) => ({
  // The approval queue is listed by status; the gate looks up open requests by entry.
  byStatus: index("reviews_status").on(t.status),
  byEntryStatus: index("reviews_entry_status").on(t.entryId, t.status),
}));

/**
 * Outbound webhook subscriptions. This is what makes Yup CMS a node in an
 * automation graph rather than an island: n8n (or anything that accepts an HTTP
 * POST) subscribes to content events and reacts to them.
 *
 * `events` lists the event types this hook wants; an empty array means "all".
 */
export const webhooks = pgTable("webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  events: text("events")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  // Optional shared secret. When set, deliveries are signed with HMAC-SHA256 so
  // the receiver can verify the payload really came from this CMS.
  secret: text("secret"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Delivery log — one row per webhook attempt. This is the observability /
 * debug surface for integrations: which events fired, where they went, whether
 * they succeeded, the HTTP status, and how long they took.
 */
export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  webhookId: uuid("webhook_id")
    .notNull()
    .references(() => webhooks.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull(), // "success" | "failed"
  statusCode: integer("status_code"),
  error: text("error"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // The delivery log is inspected per webhook, newest first.
  byWebhookCreated: index("deliveries_webhook_created").on(t.webhookId, t.createdAt),
}));

/**
 * API keys for the read API. Only the SHA-256 hash is stored — the raw key is
 * shown once at creation and never again. `scopes` controls what a key may do
 * (e.g. read drafts vs. only published).
 */
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // First chars of the raw key, for identifying it in listings without storing it.
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  scopes: text("scopes")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Field definition shape (stored inside content_types.fields)
// ---------------------------------------------------------------------------

export type FieldType =
  | "text"
  | "richtext"
  | "number"
  | "boolean"
  | "date"
  | "json"
  | "reference";

export interface FieldDef {
  name: string;
  type: FieldType;
  required?: boolean;
  description?: string;
  // For `reference` fields: the machine name of the content type referenced.
  refType?: string;
}
