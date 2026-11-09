export interface EmailDeliveryAdmission {
  selectionLimit: number;
  maySelect: () => boolean;
  startMessage: () => boolean;
  finishMessage: (durationMs: number) => void;
}

/** Invocation-owned scheduling; persistence and delivery stay with the outbox. */
export async function runEmailDeliveryPool<Row extends { id: string }>(
  options: EmailDeliveryAdmission & {
    select: (inFlightIds: readonly string[]) => Promise<Row[]>;
    deliver: (row: Row) => Promise<boolean>;
  },
) {
  const inFlight = new Set<string>();
  let buffer: Row[] = [];
  let refill: Promise<void> | undefined;
  let exhausted = false;
  let selections = 0;
  let processed = 0;
  let failed = 0;
  let yielded = false;
  const takeNext = async (): Promise<Row | undefined> => {
    while (!buffer.length) {
      if (exhausted || selections >= 100) return;
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
    return buffer.shift();
  };
  const channel = async () => {
    for (;;) {
      const row = await takeNext();
      if (!row) return;
      if (!options.startMessage()) {
        yielded = true;
        return;
      }
      inFlight.add(row.id);
      const startedAt = Date.now();
      try {
        if (await options.deliver(row)) processed++;
      } catch {
        failed++;
        processed++;
      } finally {
        inFlight.delete(row.id);
        options.finishMessage(Date.now() - startedAt);
      }
    }
  };
  // Await every channel even if a selection fails: accepted sends must still settle.
  const results = await Promise.allSettled(Array.from({ length: 10 }, channel));
  const rejected = results.find((result) => result.status === "rejected");
  if (rejected?.status === "rejected") throw rejected.reason;
  return { processed, failed, selections, exhausted: exhausted && !buffer.length && !yielded };
}
