import type { DatabaseLike } from "../../functions/_lib/types";

interface BatchGate {
  db: DatabaseLike;
  reached: Promise<void>;
  release: () => void;
}

/** Pauses the next D1 batch after all pre-batch reads have completed. */
export function gateNextBatch(database: DatabaseLike): BatchGate {
  let signalReached!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => {
    signalReached = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let gated = false;
  const db = new Proxy(database, {
    get(target, property, receiver) {
      if (property !== "batch") return Reflect.get(target, property, receiver);
      return async (...args: Parameters<DatabaseLike["batch"]>) => {
        if (!gated) {
          gated = true;
          signalReached();
          await released;
        }
        return target.batch(...args);
      };
    },
  });
  return { db, reached, release };
}

/** Releases competing D1 batches only after every caller reached its CAS. */
export function gateBatchGroup(database: DatabaseLike, participants: number): DatabaseLike {
  let arrived = 0;
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property !== "batch") return Reflect.get(target, property, receiver);
      return async (...args: Parameters<DatabaseLike["batch"]>) => {
        arrived += 1;
        if (arrived === participants) release();
        await released;
        return target.batch(...args);
      };
    },
  });
}
