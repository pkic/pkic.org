import { dependencyFailure, type DependencyOperation } from "./dependency-failure";
import type { DatabaseLike, Env, StatementLike } from "./types";

async function execute<T>(
  provider: "D1" | "R2",
  operationName: DependencyOperation,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw dependencyFailure(error, provider, operationName) ?? error;
  }
}

/** Request-owned adapters preserve binding method receivers and never replay a write. */
export function resilientDatabase(db: DatabaseLike): DatabaseLike {
  const statements = new WeakMap<StatementLike, StatementLike>();
  function wrap(statement: StatementLike): StatementLike {
    const wrapped: StatementLike = {
      bind: (...values) => wrap(statement.bind(...values)),
      first: <T>(column?: string) => execute("D1", "first", () => statement.first<T>(column)),
      all: <T>() => execute("D1", "all", () => statement.all<T>()),
      run: <T>() => execute("D1", "run", () => statement.run<T>()),
    };
    statements.set(wrapped, statement);
    return wrapped;
  }
  return {
    prepare: (query) => {
      try {
        return wrap(db.prepare(query));
      } catch (error) {
        throw dependencyFailure(error, "D1", "prepare") ?? error;
      }
    },
    batch: (batch) =>
      execute("D1", "batch", () => db.batch(batch.map((statement) => statements.get(statement) ?? statement))),
    ...(db.exec ? { exec: (query: string) => execute("D1", "exec", () => db.exec!(query)) } : {}),
    ...(db.getBookmark ? { getBookmark: () => db.getBookmark?.() ?? null } : {}),
    ...(db.withSession
      ? {
          withSession: (bookmark?: string) => {
            const session = db.withSession!(bookmark);
            return { ...resilientDatabase(session), getBookmark: () => session.getBookmark?.() ?? null };
          },
        }
      : {}),
  };
}

function resilientBucket(bucket: R2Bucket): R2Bucket {
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
      return (...args: unknown[]) => execute("R2", property, async () => Reflect.apply(value, target, args) as unknown);
    },
  });
}

export function withDependencyHandling(env: Env): Env {
  return {
    ...env,
    DB: resilientDatabase(env.DB),
    ...(env.ASSETS_BUCKET ? { ASSETS_BUCKET: resilientBucket(env.ASSETS_BUCKET) } : {}),
    ...(env.SPEAKER_UPLOADS_BUCKET ? { SPEAKER_UPLOADS_BUCKET: resilientBucket(env.SPEAKER_UPLOADS_BUCKET) } : {}),
  };
}
