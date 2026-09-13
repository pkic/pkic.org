import { dependencyFailure } from "./dependency-failure";
import type { DatabaseLike, Env, StatementLike } from "./types";

async function execute<T>(provider: "D1" | "R2", operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw dependencyFailure(error, provider) ?? error;
  }
}

/** Request-owned adapters preserve binding method receivers and never replay a write. */
export function resilientDatabase(db: DatabaseLike): DatabaseLike {
  const statements = new WeakMap<StatementLike, StatementLike>();
  function wrap(statement: StatementLike): StatementLike {
    const wrapped: StatementLike = {
      bind: (...values) => wrap(statement.bind(...values)),
      first: <T>(column?: string) => execute("D1", () => statement.first<T>(column)),
      all: <T>() => execute("D1", () => statement.all<T>()),
      run: <T>() => execute("D1", () => statement.run<T>()),
    };
    statements.set(wrapped, statement);
    return wrapped;
  }
  return {
    prepare: (query) => wrap(db.prepare(query)),
    batch: (batch) => execute("D1", () => db.batch(batch.map((statement) => statements.get(statement) ?? statement))),
    ...(db.exec ? { exec: (query: string) => execute("D1", () => db.exec!(query)) } : {}),
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
      if (!["get", "put", "head", "delete", "list", "createMultipartUpload"].includes(String(property)))
        return value.bind(target);
      return (...args: unknown[]) => execute("R2", async () => Reflect.apply(value, target, args) as unknown);
    },
  });
}

export function withDependencyHandling(env: Env): Env {
  return {
    ...env,
    DB: resilientDatabase(env.DB),
    ...(env.RSVP_EMAIL_BUCKET ? { RSVP_EMAIL_BUCKET: resilientBucket(env.RSVP_EMAIL_BUCKET) } : {}),
    ...(env.ASSETS_BUCKET ? { ASSETS_BUCKET: resilientBucket(env.ASSETS_BUCKET) } : {}),
    ...(env.SPEAKER_UPLOADS_BUCKET ? { SPEAKER_UPLOADS_BUCKET: resilientBucket(env.SPEAKER_UPLOADS_BUCKET) } : {}),
  };
}
