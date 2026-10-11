import type { DatabaseLike } from "../../functions/_lib/types";

interface BatchGate {
  db: DatabaseLike;
  reached: Promise<void>;
  release: () => void;
}

/** Keep the same race gate when the Worker opens a request-scoped session. */
function interceptDatabase(database: DatabaseLike, handler: ProxyHandler<DatabaseLike>): DatabaseLike {
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property === "withSession" && target.withSession) {
        return (bookmark?: string) => interceptDatabase(target.withSession!(bookmark), handler);
      }
      return handler.get?.(target, property, receiver) ?? Reflect.get(target, property, receiver);
    },
  });
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
  const db = interceptDatabase(database, {
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

/** Pauses the next standalone D1 statement run after its preceding reads. */
export function gateNextRun(database: DatabaseLike): BatchGate {
  return gateNextStatement(database, "run");
}

/** Pause a matching first() statement, including UPDATE ... RETURNING claims. */
export function gateNextFirst(database: DatabaseLike, matchingSql: string): BatchGate {
  return gateNextStatement(database, "first", matchingSql);
}

function gateNextStatement(database: DatabaseLike, method: "run" | "first", matchingSql = ""): BatchGate {
  let signalReached!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => {
    signalReached = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let gated = false;

  const wrapStatement = (statement: ReturnType<DatabaseLike["prepare"]>): ReturnType<DatabaseLike["prepare"]> =>
    new Proxy(statement, {
      get(target, property, receiver) {
        if (property === "bind") {
          return (...values: unknown[]) => wrapStatement(target.bind(...values));
        }
        if (property !== method) return Reflect.get(target, property, receiver);
        return async (...args: Parameters<typeof target.first>) => {
          if (!gated) {
            gated = true;
            signalReached();
            await released;
          }
          return method === "first" ? target.first(...args) : target.run();
        };
      },
    });

  const db = interceptDatabase(database, {
    get(target, property, receiver) {
      if (property !== "prepare") return Reflect.get(target, property, receiver);
      return (query: string) =>
        query.includes(matchingSql) ? wrapStatement(target.prepare(query)) : target.prepare(query);
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
  return interceptDatabase(database, {
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
