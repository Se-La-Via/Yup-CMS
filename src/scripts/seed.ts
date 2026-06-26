/**
 * Self-contained demo of the vertical slice. Run with `npm run seed`.
 *
 * It exercises the whole loop the way an agent would: define a schema, create
 * an entry, have an "agent" edit it, have a "human" publish it, then print the
 * audit trail and demonstrate a revert.
 */
import {
  createContentType,
  createEntry,
  updateEntry,
  setEntryStatus,
  getEntryHistory,
  revertEntry,
  listContentTypes,
  listReviews,
  approveReview,
} from "../core/content.js";

async function main() {
  console.log("→ Defining content type 'blog_post'...");
  try {
    await createContentType({
      name: "blog_post",
      displayName: "Blog Post",
      description: "A simple article.",
      fields: [
        { name: "title", type: "text", required: true },
        { name: "body", type: "richtext", required: true },
        { name: "views", type: "number" },
      ],
    });
  } catch (e) {
    console.log(`  (skipped: ${(e as Error).message})`);
  }

  console.log("→ Agent creates a draft entry...");
  const entry = await createEntry({
    type: "blog_post",
    slug: "hello-yup",
    data: { title: "Hello, Yup CMS", body: "First post written by an agent.", views: 0 },
    author: { type: "agent", id: "claude", note: "Initial draft" },
  });
  console.log(`  entry id: ${entry.id}`);

  console.log("→ Agent edits the body...");
  await updateEntry({
    id: entry.id,
    data: { body: "First post — now revised by the agent." },
    author: { type: "agent", id: "claude", note: "Tightened the copy" },
  });

  console.log("→ Human publishes it...");
  await setEntryStatus({
    id: entry.id,
    status: "published",
    author: { type: "human", id: "misytka66@gmail.com", note: "Looks good, shipping" },
  });

  console.log("\n=== Audit trail ===");
  const history = await getEntryHistory(entry.id);
  for (const r of history) {
    console.log(
      `  rev ${r.revision} | ${r.action.padEnd(8)} | ${r.authorType}:${r.authorId} | ${r.note ?? ""}`,
    );
  }

  console.log("\n→ Reverting to revision 1...");
  const reverted = await revertEntry({
    id: entry.id,
    toRevision: 1,
    author: { type: "human", id: "misytka66@gmail.com" },
  });
  console.log(`  body is now: "${(reverted.data as any).body}"`);

  // --- Review gate demo ----------------------------------------------------
  console.log("\n=== Review gate ===");
  console.log("→ Defining 'press_release' (requires human approval)...");
  try {
    await createContentType({
      name: "press_release",
      displayName: "Press Release",
      description: "Sensitive content — agents may draft but not publish.",
      fields: [{ name: "title", type: "text", required: true }],
      requireApproval: true,
    });
  } catch (e) {
    console.log(`  (skipped: ${(e as Error).message})`);
  }

  const pr = await createEntry({
    type: "press_release",
    data: { title: "Yup CMS 1.0 announced" },
    author: { type: "agent", id: "claude", note: "Drafted release" },
  });

  console.log("→ Agent tries to publish it...");
  const gated = await setEntryStatus({
    id: pr.id,
    status: "published",
    author: { type: "agent", id: "claude" },
  });
  console.log(`  result: entry status is now "${(gated as any).entry?.status ?? (gated as any).status}" (not published!)`);

  const [pending] = await listReviews({ status: "pending" });
  console.log(`  pending review: ${pending!.id} requested by ${pending!.requestedByType}:${pending!.requestedById}`);

  console.log("→ Human approves...");
  const approved = await approveReview({
    requestId: pending!.id,
    author: { type: "human", id: "misytka66@gmail.com" },
    note: "Cleared by comms",
  });
  console.log(`  entry status is now "${approved.entry.status}" ✓`);

  console.log("\n=== Content types ===");
  for (const t of await listContentTypes()) {
    const gate = t.requireApproval ? " [review-gated]" : "";
    console.log(`  ${t.name} (${(t.fields as any[]).length} fields)${gate}`);
  }

  console.log("\n✓ Vertical slice works end to end.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
