import { dependencyFailure, type DependencyOperation } from "./dependency-failure";
import type { DatabaseLike, Env, StatementLike } from "./types";

/**
 * One request's write history. A failure reports `unchanged` only while the request has sent no
 * write, so a client may repeat it without repeating a change. Any statement naming a write
 * keyword counts, including `INSERT ... RETURNING` read through `first`; a false positive only
 * withholds a repeat.
 */
interface WriteHistory {
  attempted: boolean;
}

const WRITE_SQL = /\b(?:INSERT|UPDATE|DELETE|REPLACE|UPSERT|CREATE|DROP|ALTER)\b/i;
const BUCKET_WRITES = new Set<PropertyKey>(["put", "delete", "createMultipartUpload"]);

async function execute<T>(
  history: WriteHistory,
  provider: "D1" | "R2",
  operationName: DependencyOperation,
  writes: boolean,
  operation: () => Promise<T>,
): Promise<T> {
  if (writes) history.attempted = true;
  try {
    return await operation();
  } catch (error) {
    throw dependencyFailure(error, provider, operationName, history.attempted ? "unknown" : "unchanged") ?? error;
  }
}

/** Request-owned adapters preserve binding method receivers and never replay a write. */
export function resilientDatabase(db: DatabaseLike, history: WriteHistory = { attempted: false }): DatabaseLike {
  const statements = new WeakMap<StatementLike, { statement: StatementLike; writes: boolean }>();
  function wrap(statement: StatementLike, writes: boolean): StatementLike {
    const wrapped: StatementLike = {
      bind: (...values) => wrap(statement.bind(...values), writes),
      first: <T>(column?: string) => execute(history, "D1", "first", writes, () => statement.first<T>(column)),
      all: <T>() => execute(history, "D1", "all", writes, () => statement.all<T>()),
      run: <T>() => execute(history, "D1", "run", writes, () => statement.run<T>()),
    };
    statements.set(wrapped, { statement, writes });
    return wrapped;
  }
  return {
    prepare: (query) => {
      try {
        return wrap(db.prepare(query), WRITE_SQL.test(query));
      } catch (error) {
        throw dependencyFailure(error, "D1", "prepare", history.attempted ? "unknown" : "unchanged") ?? error;
      }
    },
    batch: (batch) => {
      const entries = batch.map((statement) => statements.get(statement));
      // An unwrapped statement's SQL is unknown, so it counts as a write.
      const writes = entries.some((entry) => entry === undefined || entry.writes);
      return execute(history, "D1", "batch", writes, () =>
        db.batch(batch.map((statement, index) => entries[index]?.statement ?? statement)),
      );
    },
    ...(db.exec ? { exec: (query: string) => execute(history, "D1", "exec", true, () => db.exec!(query)) } : {}),
    ...(db.getBookmark ? { getBookmark: () => db.getBookmark?.() ?? null } : {}),
    ...(db.withSession
      ? {
          withSession: (bookmark?: string) => {
            const session = db.withSession!(bookmark);
            return { ...resilientDatabase(session, history), getBookmark: () => session.getBookmark?.() ?? null };
          },
        }
      : {}),
  };
}

function resilientBucket(bucket: R2Bucket, history: WriteHistory): R2Bucket {
  return new Proxy(bucket, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (
        property !== "get" &&
        property !== "put" &&
        property !== "head" &&
        property !== "delete" &&
        property !== "list" &&
        property !== "createMultipartUpload"
      )
        return value.bind(target);
      return (...args: unknown[]) =>
        execute(
          history,
          "R2",
          property,
          BUCKET_WRITES.has(property),
          async () => Reflect.apply(value, target, args) as unknown,
        );
    },
  });
}

export function withDependencyHandling(env: Env): Env {
  const history: WriteHistory = { attempted: false };
  return {
    ...env,
    DB: resilientDatabase(env.DB, history),
    ...(env.ASSETS_BUCKET ? { ASSETS_BUCKET: resilientBucket(env.ASSETS_BUCKET, history) } : {}),
    ...(env.SPEAKER_UPLOADS_BUCKET
      ? { SPEAKER_UPLOADS_BUCKET: resilientBucket(env.SPEAKER_UPLOADS_BUCKET, history) }
      : {}),
  };
}
