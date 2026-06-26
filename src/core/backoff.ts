/**
 * Retry backoff schedule for webhook deliveries. Pure (no I/O) so it can be
 * reasoned about and unit-tested in isolation.
 */

// Delay before each retry, by number of failed attempts so far.
// 10s → 30s → 2m → 10m → 30m, then give up.
const SCHEDULE_MS = [10_000, 30_000, 120_000, 600_000, 1_800_000];

/** Total attempts allowed: the first try plus one per scheduled retry. */
export const MAX_ATTEMPTS = SCHEDULE_MS.length + 1;

/**
 * Milliseconds to wait before the next attempt, given how many attempts have
 * already failed (>= 1). Clamps to the last (longest) delay.
 */
export function nextBackoffMs(attemptsFailed: number): number {
  const i = Math.min(Math.max(attemptsFailed, 1), SCHEDULE_MS.length) - 1;
  return SCHEDULE_MS[i]!;
}

/** Whether the attempt budget is exhausted and the delivery should be marked dead. */
export function isExhausted(attemptsFailed: number): boolean {
  return attemptsFailed >= MAX_ATTEMPTS;
}
