/**
 * Smoke test for the admin copilot + insights (needs a live DATABASE_URL).
 * Verifies the tool-execution layer and insights WITHOUT calling the LLM, plus
 * that the assistant reports "not configured" when no ANTHROPIC_API_KEY is set.
 *
 *   npm run smoke:assistant
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { executeTool, runAssistant, AssistantNotConfiguredError } from "../core/assistant.js";
import { getInsights } from "../core/insights.js";
import { createContentType } from "../core/content.js";
import { DEFAULT_TENANT_ID } from "../db/schema.js";

async function main() {
  try {
    await createContentType({
      name: "assist_post",
      displayName: "Assist Post",
      fields: [{ name: "title", type: "text", required: true }],
    });
  } catch {
    /* may exist on a reused DB */
  }

  const ctx = { tenantId: DEFAULT_TENANT_ID };

  // The copilot's tools execute against the core as an agent.
  const created = (await executeTool(
    "create_entry",
    { type: "assist_post", data: { title: "hi from copilot" } },
    ctx,
  )) as { id: string };
  assert.ok(created.id, "create_entry tool returns an entry");

  const listed = (await executeTool("list_entries", { type: "assist_post" }, ctx)) as unknown[];
  assert.ok(listed.length >= 1, "list_entries tool returns entries");

  // Insights compute without an LLM.
  const insights = await getInsights(DEFAULT_TENANT_ID);
  assert.ok(Array.isArray(insights.items), "insights returns items");

  // Without a key, the copilot reports it is not configured (no API call made).
  delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(
    () => runAssistant({ messages: [{ role: "user", content: "hi" }], tenantId: DEFAULT_TENANT_ID }),
    (e) => e instanceof AssistantNotConfiguredError,
    "runAssistant rejects when ANTHROPIC_API_KEY is unset",
  );

  console.log("✓ assistant verified: tool execution + insights + not-configured guard");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
