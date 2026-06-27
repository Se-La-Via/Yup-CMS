import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as content from "../core/content.js";
import { ValidationError, NotFoundError } from "../core/content.js";
import * as events from "../core/events.js";
import * as auth from "../core/auth.js";
import * as assets from "../core/assets.js";
import * as tenant from "../core/tenant.js";
import * as read from "../core/read.js";

const server = new McpServer({
  name: "yup-cms",
  version: "0.1.0",
});

/** Wrap a handler so domain errors become readable, non-fatal tool responses. */
function tool<T>(handler: (args: T) => Promise<unknown>) {
  return async (args: T) => {
    try {
      const result = await handler(args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message =
        err instanceof ValidationError || err instanceof NotFoundError
          ? err.message
          : `Unexpected error: ${(err as Error).message}`;
      return {
        content: [{ type: "text" as const, text: message }],
        isError: true,
      };
    }
  };
}

// Reusable schema fragments -------------------------------------------------

const fieldDefSchema = z.object({
  name: z.string().describe("snake_case field name, e.g. 'title'"),
  type: z.enum([
    "text",
    "richtext",
    "number",
    "boolean",
    "date",
    "json",
    "reference",
    "select",
  ]),
  required: z.boolean().optional(),
  description: z.string().optional(),
  refType: z
    .string()
    .optional()
    .describe("for 'reference' fields: machine name of the referenced content type"),
  default: z.unknown().optional().describe("value used on create when omitted"),
  options: z
    .array(z.string())
    .optional()
    .describe("for 'select' fields: the allowed values"),
  min: z.number().optional().describe("number: min value; text: min length"),
  max: z.number().optional().describe("number: max value; text: max length"),
  pattern: z.string().optional().describe("text: regex the value must match"),
  unique: z.boolean().optional().describe("value must be unique within the type"),
  localized: z
    .boolean()
    .optional()
    .describe("store a { locale: value } map; reads flatten to a requested locale"),
});

// The trusted principal for this MCP connection. Identity is bound to the
// deployment (env), NOT to request arguments — this is what makes the audit
// trail and the review gate impossible for a caller to spoof. An agent-typed
// connection can never claim to be a human, nor approve its own reviews.
const PRINCIPAL_TYPE: "human" | "agent" | "system" = (() => {
  const t = process.env.CMS_PRINCIPAL_TYPE;
  return t === "human" || t === "agent" || t === "system" ? t : "agent";
})();
const PRINCIPAL_ID = process.env.CMS_PRINCIPAL_ID ?? "mcp-agent";

// This connection's tenant — resolved from CMS_TENANT at boot. Every core call
// is scoped to it, so an MCP connection can only ever touch its own tenant.
const TENANT_SLUG = process.env.CMS_TENANT ?? tenant.DEFAULT_TENANT_SLUG;
let TENANT_ID = tenant.DEFAULT_TENANT_ID;

function principalAuthor(note?: string) {
  return { type: PRINCIPAL_TYPE, id: PRINCIPAL_ID, note };
}

const noteSchema = z
  .string()
  .optional()
  .describe("optional note recorded in the audit trail (why this change was made)");

// --- Schema discovery ------------------------------------------------------

server.registerTool(
  "list_content_types",
  {
    title: "List content types",
    description:
      "List all content types (schemas) defined in the CMS. Call this first to discover what kinds of content exist.",
    inputSchema: {},
  },
  tool(async () => content.listContentTypes(TENANT_ID)),
);

server.registerTool(
  "get_content_type",
  {
    title: "Get content type",
    description: "Get one content type by its machine name, including its full field schema.",
    inputSchema: { name: z.string() },
  },
  tool(async ({ name }) => content.getContentType(name, TENANT_ID)),
);

server.registerTool(
  "create_content_type",
  {
    title: "Create content type",
    description:
      "Define a new content type (schema). Fields describe the shape of every entry of this type.",
    inputSchema: {
      name: z.string().describe("snake_case machine name, e.g. 'blog_post'"),
      displayName: z.string(),
      description: z.string().optional(),
      fields: z.array(fieldDefSchema),
      requireApproval: z
        .boolean()
        .optional()
        .describe("if true, an agent's publish is held for human approval (review gate)"),
    },
  },
  tool(async (args) => content.createContentType({ ...args, tenantId: TENANT_ID })),
);

// --- Entries ---------------------------------------------------------------

server.registerTool(
  "list_entries",
  {
    title: "List entries",
    description: "List entries of a given content type, optionally filtered by status.",
    inputSchema: {
      type: z.string().describe("content type machine name"),
      status: z
        .enum(["draft", "scheduled", "pending_review", "published", "archived"])
        .optional(),
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().nonnegative().optional(),
    },
  },
  tool(async (args) => content.listEntries({ ...args, tenantId: TENANT_ID })),
);

server.registerTool(
  "search_entries",
  {
    title: "Search entries",
    description:
      "Full-text search over entry content within this tenant. Optionally narrow by type and status (default published).",
    inputSchema: {
      q: z.string().describe("search query"),
      type: z.string().optional(),
      status: z
        .enum(["draft", "scheduled", "pending_review", "published", "archived"])
        .optional(),
      limit: z.number().int().positive().max(100).optional(),
    },
  },
  tool(async (args) => read.search({ ...args, tenantId: TENANT_ID })),
);

server.registerTool(
  "get_entry",
  {
    title: "Get entry",
    description: "Get a single entry by its id, including current data and status.",
    inputSchema: { id: z.string() },
  },
  tool(async ({ id }) => content.getEntry(id, TENANT_ID)),
);

server.registerTool(
  "create_entry",
  {
    title: "Create entry",
    description:
      "Create a new content entry. Data is validated against the content type's schema. Defaults to draft.",
    inputSchema: {
      type: z.string().describe("content type machine name"),
      data: z.record(z.unknown()).describe("field values for this entry"),
      slug: z.string().optional(),
      status: z.enum(["draft", "published"]).optional(),
      note: noteSchema,
    },
  },
  tool(async ({ note, ...args }) =>
    content.createEntry({ ...args, author: principalAuthor(note), tenantId: TENANT_ID }),
  ),
);

server.registerTool(
  "update_entry",
  {
    title: "Update entry",
    description:
      "Update an entry's fields (partial — only supplied fields change). Creates a new revision in the audit trail.",
    inputSchema: {
      id: z.string(),
      data: z.record(z.unknown()).describe("fields to change"),
      note: noteSchema,
    },
  },
  tool(async ({ note, ...args }) =>
    content.updateEntry({ ...args, author: principalAuthor(note), tenantId: TENANT_ID }),
  ),
);

server.registerTool(
  "set_entry_status",
  {
    title: "Set entry status",
    description:
      "Publish, unpublish (draft), or archive an entry. Recorded as a revision attributed to this server's principal. If the principal is an agent and the type requires approval, publishing queues a review instead.",
    inputSchema: {
      id: z.string(),
      status: z.enum(["draft", "published", "archived"]),
      note: noteSchema,
    },
  },
  tool(async ({ note, ...args }) =>
    content.setEntryStatus({ ...args, author: principalAuthor(note), tenantId: TENANT_ID }),
  ),
);

server.registerTool(
  "get_entry_history",
  {
    title: "Get entry history",
    description:
      "Get the full revision history of an entry — every change, who made it (human/agent), and why.",
    inputSchema: { id: z.string() },
  },
  tool(async ({ id }) => content.getEntryHistory(id, TENANT_ID)),
);

server.registerTool(
  "revert_entry",
  {
    title: "Revert entry",
    description:
      "Restore an entry's data to a previous revision. The revert itself is recorded as a new revision.",
    inputSchema: {
      id: z.string(),
      toRevision: z.number().int().positive(),
      note: noteSchema,
    },
  },
  tool(async ({ note, ...args }) =>
    content.revertEntry({ ...args, author: principalAuthor(note), tenantId: TENANT_ID }),
  ),
);

server.registerTool(
  "schedule_publish",
  {
    title: "Schedule publish",
    description:
      "Schedule an entry to publish automatically at a future time (ISO 8601). The worker publishes it when due. Agents cannot schedule approval-gated types.",
    inputSchema: {
      id: z.string(),
      publishAt: z.string().describe("ISO 8601 date-time, e.g. 2026-07-01T09:00:00Z"),
      note: noteSchema,
    },
  },
  tool(async ({ note, ...args }) =>
    content.schedulePublish({ ...args, author: principalAuthor(note), tenantId: TENANT_ID }),
  ),
);

server.registerTool(
  "cancel_schedule",
  {
    title: "Cancel schedule",
    description: "Cancel a scheduled publish, returning the entry to draft.",
    inputSchema: { id: z.string(), note: noteSchema },
  },
  tool(async ({ note, ...args }) =>
    content.cancelSchedule({ ...args, author: principalAuthor(note), tenantId: TENANT_ID }),
  ),
);

server.registerTool(
  "delete_entry",
  {
    title: "Delete entry",
    description:
      "Permanently delete an entry and its revision history. This is irreversible — to merely hide content, use set_entry_status with 'archived' instead.",
    inputSchema: {
      id: z.string(),
      note: noteSchema,
    },
  },
  tool(async ({ note, ...args }) =>
    content.deleteEntry({ ...args, author: principalAuthor(note), tenantId: TENANT_ID }),
  ),
);

// --- Review gate -----------------------------------------------------------

server.registerTool(
  "list_reviews",
  {
    title: "List reviews",
    description:
      "List publish-review requests (the human approval queue), optionally filtered by status.",
    inputSchema: {
      status: z.enum(["pending", "approved", "rejected"]).optional(),
    },
  },
  tool(async (args) => content.listReviews({ ...args, tenantId: TENANT_ID })),
);

server.registerTool(
  "approve_review",
  {
    title: "Approve review",
    description:
      "Approve a queued publish request — this publishes the entry. Requires a human or system principal; an agent-typed server cannot approve.",
    inputSchema: {
      requestId: z.string(),
      note: z.string().optional().describe("decision note"),
    },
  },
  tool(async ({ requestId, note }) =>
    content.approveReview({ requestId, note, author: principalAuthor(note), tenantId: TENANT_ID }),
  ),
);

server.registerTool(
  "reject_review",
  {
    title: "Reject review",
    description:
      "Reject a queued publish request — the entry returns to draft. Requires a human or system principal; an agent-typed server cannot reject.",
    inputSchema: {
      requestId: z.string(),
      note: z.string().optional().describe("decision note / reason"),
    },
  },
  tool(async ({ requestId, note }) =>
    content.rejectReview({ requestId, note, author: principalAuthor(note), tenantId: TENANT_ID }),
  ),
);

// --- Webhooks / automation (n8n et al.) ------------------------------------

server.registerTool(
  "register_webhook",
  {
    title: "Register webhook",
    description:
      "Subscribe an HTTP endpoint (e.g. an n8n webhook node) to content events. Omit 'events' to receive all. " +
      `Valid events: ${events.EVENT_TYPES.join(", ")}.`,
    inputSchema: {
      name: z.string(),
      url: z.string().describe("http(s) URL that will receive POST deliveries"),
      events: z
        .array(z.enum(events.EVENT_TYPES))
        .optional()
        .describe("event types to subscribe to; empty/omitted = all"),
      secret: z
        .string()
        .optional()
        .describe("shared secret; deliveries are signed with HMAC-SHA256 in X-Yup-Signature"),
    },
  },
  tool(async (args) => events.registerWebhook({ ...args, tenantId: TENANT_ID })),
);

server.registerTool(
  "list_webhooks",
  {
    title: "List webhooks",
    description: "List all registered webhook subscriptions.",
    inputSchema: {},
  },
  tool(async () => events.listWebhooks(TENANT_ID)),
);

server.registerTool(
  "delete_webhook",
  {
    title: "Delete webhook",
    description: "Remove a webhook subscription by id.",
    inputSchema: { id: z.string() },
  },
  tool(async ({ id }) => events.deleteWebhook(id, TENANT_ID)),
);

server.registerTool(
  "get_webhook_deliveries",
  {
    title: "Get webhook deliveries",
    description:
      "Inspect the delivery log — which events fired, where, success/failure, HTTP status, and latency. Use this to debug integrations.",
    inputSchema: {
      webhookId: z.string().optional().describe("filter to one webhook"),
      limit: z.number().int().positive().max(200).optional(),
    },
  },
  tool(async (args) => events.getDeliveries({ ...args, tenantId: TENANT_ID })),
);

// --- Assets / media --------------------------------------------------------

server.registerTool(
  "upload_asset",
  {
    title: "Upload asset",
    description:
      "Upload a media asset from inline base64 data or by fetching a source URL. Returns the asset metadata; serve it at GET /assets/:id on the read API.",
    inputSchema: {
      filename: z.string(),
      contentType: z.string().optional().describe("MIME type, e.g. image/png"),
      dataBase64: z.string().optional().describe("base64-encoded file contents"),
      sourceUrl: z.string().optional().describe("http(s) URL to fetch the asset from"),
    },
  },
  tool(async (args) => assets.createAsset({ ...args, tenantId: TENANT_ID })),
);

server.registerTool(
  "list_assets",
  {
    title: "List assets",
    description: "List uploaded asset metadata, newest first.",
    inputSchema: {},
  },
  tool(async () => assets.listAssets(TENANT_ID)),
);

server.registerTool(
  "get_asset",
  {
    title: "Get asset",
    description: "Get one asset's metadata by id.",
    inputSchema: { id: z.string() },
  },
  tool(async ({ id }) => assets.getAsset(id, TENANT_ID)),
);

server.registerTool(
  "delete_asset",
  {
    title: "Delete asset",
    description: "Delete an asset's metadata and its stored bytes.",
    inputSchema: { id: z.string() },
  },
  tool(async ({ id }) => assets.deleteAsset(id, TENANT_ID)),
);

// --- API keys (read-API auth) ----------------------------------------------

server.registerTool(
  "create_api_key",
  {
    title: "Create API key",
    description:
      "Mint an API key for the read API. The raw key is returned ONCE — store it now. " +
      `Scopes: ${auth.SCOPES.join(", ")} (default: read:published).`,
    inputSchema: {
      name: z.string(),
      scopes: z.array(z.enum(auth.SCOPES)).optional(),
    },
  },
  tool(async (args) => auth.createApiKey({ ...args, tenantId: TENANT_ID })),
);

server.registerTool(
  "list_api_keys",
  {
    title: "List API keys",
    description: "List API keys (prefixes and scopes only — never the raw key or its hash).",
    inputSchema: {},
  },
  tool(async () => auth.listApiKeys(TENANT_ID)),
);

server.registerTool(
  "revoke_api_key",
  {
    title: "Revoke API key",
    description: "Deactivate an API key by id. Takes effect immediately.",
    inputSchema: { id: z.string() },
  },
  tool(async ({ id }) => auth.revokeApiKey(id, TENANT_ID)),
);

// --- Tenants (workspaces) --------------------------------------------------

server.registerTool(
  "list_tenants",
  {
    title: "List tenants",
    description: "List all tenants (workspaces).",
    inputSchema: {},
  },
  tool(async () => tenant.listTenants()),
);

server.registerTool(
  "create_tenant",
  {
    title: "Create tenant",
    description:
      "Create a new tenant (isolated workspace). Point a separate MCP connection at it with CMS_TENANT=<slug>.",
    inputSchema: {
      slug: z.string().describe("kebab-case identifier, e.g. acme"),
      name: z.string(),
    },
  },
  tool(async (args) => tenant.createTenant(args)),
);

// --- Boot ------------------------------------------------------------------

async function main() {
  // Resolve this connection's tenant before serving any request.
  TENANT_ID = await tenant.resolveTenantId(TENANT_SLUG);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr so it never corrupts the stdio JSON-RPC stream.
  console.error(
    `Yup CMS MCP server running on stdio (principal: ${PRINCIPAL_TYPE}:${PRINCIPAL_ID}, tenant: ${TENANT_SLUG})`,
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
