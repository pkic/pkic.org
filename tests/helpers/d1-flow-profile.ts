import type { DatabaseLike, StatementLike } from "../../functions/_lib/types";

interface QuerySample {
  sql: string;
  durationMs: number;
  operation: string;
}

/** Test-only instrumentation: never exports SQL parameter values or user data. */
export function profileD1Flow(database: DatabaseLike) {
  const queries: QuerySample[] = [];
  const constraints: string[] = [];
  const statements = new WeakMap<StatementLike, { raw: StatementLike; sql: string; bindings: unknown[] }>();
  const plans = new Map<string, unknown[]>();

  function statement(raw: StatementLike, sql: string, bindings: unknown[] = []): StatementLike {
    const wrapped: StatementLike = {
      bind: (...values) => statement(raw.bind(...values), sql, values),
      run: () => timed("run", sql, () => raw.run()),
      all: () => timed("all", sql, () => raw.all()),
      first: (column) => timed("first", sql, () => raw.first(column)),
    };
    statements.set(wrapped, { raw, sql, bindings });
    return wrapped;
  }

  async function timed<T>(operation: string, sql: string, run: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await run();
    } finally {
      queries.push({ operation, sql: sql.replace(/\s+/g, " ").trim(), durationMs: performance.now() - start });
    }
  }

  const executed: { sql: string; bindings: unknown[] }[] = [];
  function wrap(db: DatabaseLike): DatabaseLike {
    return {
      prepare: (sql) => {
        const prepared = statement(db.prepare(sql), sql);
        // Track execution, not prepare/bind, including the final bindings.
        function track(candidate: StatementLike): StatementLike {
          const details = statements.get(candidate)!;
          const tracked = new Proxy(candidate, {
            get(target, property) {
              if (property === "bind") return (...values: unknown[]) => track(target.bind(...values));
              if (property === "all" || property === "run" || property === "first") {
                return (...args: [string?]) => {
                  executed.push(details);
                  return target[property](...args);
                };
              }
              return Reflect.get(target, property);
            },
          });
          statements.set(tracked, details);
          return tracked;
        }
        return track(prepared);
      },
      batch: async (batch) => {
        const details = batch.map((item) => statements.get(item)!);
        executed.push(...details);
        return timed("batch", details.map((item) => item.sql).join("; "), () =>
          db.batch(details.map((item) => item.raw)),
        );
      },
      ...(db.getBookmark ? { getBookmark: db.getBookmark.bind(db) } : {}),
      ...(db.withSession
        ? {
            withSession: (constraint?: string) => {
              constraints.push(constraint ?? "first-unconstrained");
              return wrap(db.withSession!(constraint));
            },
          }
        : {}),
    };
  }

  return {
    db: wrap(database),
    async report() {
      for (const { sql, bindings } of executed) {
        if (!plans.has(sql)) {
          const result = await database
            .prepare(`EXPLAIN QUERY PLAN ${sql}`)
            .bind(...bindings)
            .all();
          plans.set(sql, result.results);
        }
      }
      return {
        constraints,
        roundTrips: queries.length,
        statements: executed.length,
        queries,
        plans: [...plans].map(([sql, plan]) => ({ sql: sql.replace(/\s+/g, " ").trim(), plan })),
      };
    },
  };
}
