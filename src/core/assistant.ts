import Anthropic from "@anthropic-ai/sdk";
import * as content from "./content.js";
import * as read from "./read.js";

/**
 * The admin copilot. An LLM (Claude) wired to a curated subset of the CMS tools,
 * so an admin can drive the CMS in natural language.
 *
 * Trust: the copilot acts as an **agent** principal. So publishing an
 * approval-gated type goes to the review queue (a human approves in the UI), and
 * the copilot is NOT given approve/reject/delete — it proposes, humans dispose.
 * Everything is scoped to the caller's tenant.
 */

export class AssistantNotConfiguredError extends Error {
  constructor() {
    super("assistant is not configured: set ANTHROPIC_API_KEY");
    this.name = "AssistantNotConfiguredError";
  }
}

const MODEL = process.env.CMS_ASSISTANT_MODEL ?? "claude-opus-4-8";
const MAX_ITERATIONS = 8;

const SYSTEM = `You are the admin copilot for Yup CMS, an agent-native headless CMS.
Help the operator manage content through the provided tools. Be concise and act
rather than asking when the request is clear.

Trust model: you operate as an "agent". When you publish a content type that
requires approval, it is queued for a human to approve — that is expected; tell
the user it is awaiting review. You cannot approve/reject reviews or delete
entries; a human does that in the dashboard. Everything you do is recorded in the
audit trail attributed to "agent:assistant".`;

interface ToolDef {
  name: string;
  description: string;
  input_schema: Anthropic.Tool.InputSchema;
}

const TOOLS: ToolDef[] = [
  { name: "list_content_types", description: "List content types (schemas).", input_schema: { type: "object", properties: {} } },
  {
    name: "search_entries",
    description: "Full-text search entries. Defaults to published.",
    input_schema: {
      type: "object",
      properties: { q: { type: "string" }, type: { type: "string" }, limit: { type: "number" } },
      required: ["q"],
    },
  },
  {
    name: "list_entries",
    description: "List entries of a content type, optionally by status.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string" },
        status: { type: "string", enum: ["draft", "scheduled", "pending_review", "published", "archived"] },
        limit: { type: "number" },
      },
      required: ["type"],
    },
  },
  { name: "get_entry", description: "Get one entry by id.", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "get_entry_history", description: "Get an entry's revision history.", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  {
    name: "create_entry",
    description: "Create a content entry. Data is validated against the type's schema.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string" },
        data: { type: "object" },
        slug: { type: "string" },
        status: { type: "string", enum: ["draft", "published"] },
      },
      required: ["type", "data"],
    },
  },
  {
    name: "update_entry",
    description: "Update an entry's fields (partial).",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" }, data: { type: "object" } },
      required: ["id", "data"],
    },
  },
  {
    name: "set_entry_status",
    description: "Publish/unpublish/archive an entry. Publishing an approval-gated type queues a review.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" }, status: { type: "string", enum: ["draft", "published", "archived"] } },
      required: ["id", "status"],
    },
  },
  {
    name: "list_reviews",
    description: "List the human review queue (read-only).",
    input_schema: { type: "object", properties: { status: { type: "string", enum: ["pending", "approved", "rejected"] } } },
  },
];

/** Execute a copilot tool against the core, scoped to the tenant, as an agent. */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: { tenantId: string },
): Promise<unknown> {
  const author = { type: "agent" as const, id: "assistant" };
  const tenantId = ctx.tenantId;
  // Dynamic dispatch boundary — args come from the model and are validated by
  // the core functions, so we cast at the call.
  const a = input as Record<string, unknown>;
  switch (name) {
    case "list_content_types":
      return content.listContentTypes(tenantId);
    case "search_entries":
      return read.search({ ...a, tenantId } as never);
    case "list_entries":
      return content.listEntries({ ...a, tenantId } as never);
    case "get_entry":
      return content.getEntry(input.id as string, tenantId);
    case "get_entry_history":
      return content.getEntryHistory(input.id as string, tenantId);
    case "create_entry":
      return content.createEntry({ ...a, author, tenantId } as never);
    case "update_entry":
      return content.updateEntry({ ...a, author, tenantId } as never);
    case "set_entry_status":
      return content.setEntryStatus({ ...a, author, tenantId } as never);
    case "list_reviews":
      return content.listReviews({ ...a, tenantId } as never);
    default:
      throw new Error(`unknown tool "${name}"`);
  }
}

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantResult {
  reply: string;
  actions: Array<{ tool: string; ok: boolean; error?: string }>;
}

/**
 * Run one copilot turn: the model reasons, calls tools (executed against the
 * tenant as an agent), and returns a final reply plus the actions it took.
 */
export async function runAssistant(input: {
  messages: AssistantMessage[];
  tenantId: string;
}): Promise<AssistantResult> {
  if (!process.env.ANTHROPIC_API_KEY) throw new AssistantNotConfiguredError();
  const client = new Anthropic();

  const messages: Anthropic.MessageParam[] = input.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const actions: AssistantResult["actions"] = [];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      // Adaptive thinking (the on-mode for Opus 4.8); cast for SDK type compat.
      thinking: { type: "adaptive" } as never,
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });
    messages.push({ role: "assistant", content: res.content });

    if (res.stop_reason !== "tool_use") {
      const reply = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { reply, actions };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      try {
        const out = await executeTool(
          block.name,
          block.input as Record<string, unknown>,
          { tenantId: input.tenantId },
        );
        actions.push({ tool: block.name, ok: true });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(out),
        });
      } catch (e) {
        const msg = (e as Error).message;
        actions.push({ tool: block.name, ok: false, error: msg });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: msg,
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  return { reply: "(stopped: reached the maximum number of steps)", actions };
}
