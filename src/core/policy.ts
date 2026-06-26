/**
 * Pure trust-policy decisions, with no I/O — easy to reason about and test.
 *
 * These encode the security invariants of the review gate. They take an author
 * TYPE that the caller has already established from a trusted source (the MCP
 * server's configured principal), never from un-trusted request arguments.
 */

export type AuthorType = "human" | "agent" | "system";

/**
 * An agent publishing an approval-gated content type must NOT publish directly —
 * the change is held for human review. Humans and system principals publish
 * straight through (they are the approval).
 */
export function shouldHoldForReview(
  targetStatus: string,
  authorType: AuthorType,
  requireApproval: boolean,
): boolean {
  return (
    targetStatus === "published" && authorType === "agent" && requireApproval
  );
}

/**
 * Only a human or system principal may approve or reject a review. An agent must
 * never be able to clear its own gate — this is what makes the gate unbypassable
 * even if an agent invokes the approval tools.
 */
export function mayDecideReview(authorType: AuthorType): boolean {
  return authorType !== "agent";
}
