export interface EmailDeliveryAdmission {
  selectionLimit: number;
  maySelect: () => boolean;
  startMessage: () => boolean;
  finishMessage: (durationMs: number) => void;
}

export type EmailDeliveryOutcome = "accepted" | "skipped" | "failed";

/** Invocation-owned scheduling; persistence and delivery stay with the outbox. */
export async function runEmailDeliveryPool<Row extends { id: string }>(
  options: EmailDeliveryAdmission & {
    select: (inFlightIds: readonly string[]) => Promise<Row[]>;
    /** Rejects only when a message's state could not be read or recorded. */
    deliver: (row: Row) => Promise<EmailDeliveryOutcome>;
  },
) {
  const inFlight = new Set<string>();
  let buffer: Row[] = [];
  let refill: Promise<void> | undefined;
  let exhausted = false;
  let aborted = false;
  let selections = 0;
  let processed = 0;
  let failed = 0;
  let yielded = false;
  const takeNext = async (): Promise<Row | undefined> => {
    while (!buffer.length) {
      if (aborted || exhausted || selections >= 100) return;
      if (!refill) {
        if (!options.maySelect()) return;
        refill = (async () => {
          buffer = await options.select([...inFlight]);
          selections++;
          exhausted = buffer.length < options.selectionLimit;
        })();
      }
      const pending = refill;
      await pending;
      if (refill === pending) refill = undefined;
    }
    // Reserve before yielding: a channel resuming next may start the following selection.
    const row = buffer.shift();
    if (row) inFlight.add(row.id);
    return row;
  };
  const channel = async () => {
    try {
      for (;;) {
        const row = await takeNext();
        if (!row || aborted) return;
        if (!options.startMessage()) {
          yielded = true;
          return;
        }
        const startedAt = Date.now();
        try {
          const outcome = await options.deliver(row);
          if (outcome === "failed") failed++;
          if (outcome !== "skipped") processed++;
        } finally {
          inFlight.delete(row.id);
          options.finishMessage(Date.now() - startedAt);
        }
      }
    } catch (error) {
      // No message state changed, so selecting again would repeat the same fault.
      // End the run and let the job's backoff apply.
      aborted = true;
      throw error;
    }
  };
  // Await every channel even after a fault: accepted sends must still settle.
  const results = await Promise.allSettled(Array.from({ length: 10 }, channel));
  const rejected = results.find((result) => result.status === "rejected");
  if (rejected?.status === "rejected") throw rejected.reason;
  return { processed, failed, selections, exhausted: exhausted && !buffer.length && !yielded };
}
