import type { DatabaseLike, StatementLike } from "../../functions/_lib/types";

interface QuerySample {
  sql: string;
  durationMs: number;
  operation: string;
  startedAtMs: number;
  /** JSON UTF-8 estimates, not the platform's RPC wire encoding. */
  requestBytes?: number;
  resultBytes?: number;
  /** D1's own count; `first` reports no metadata, so it is absent there. */
  rowsRead?: number;
}

function rowsReadBy(result: unknown): number | undefined {
  const readings = (Array.isArray(result) ? result : [result]).map(
    (item) => (item as { meta?: { rows_read?: number } } | null)?.meta?.rows_read,
  );
  return readings.some((reading) => reading === undefined)
    ? undefined
    : readings.reduce<number>((total, reading) => total + reading!, 0);
}

/** Test-only instrumentation: never exports SQL parameter values or user data. */
export function profileD1Flow(
  database: DatabaseLike,
  options: { latencyMs?: number; measurePayloadBytes?: boolean; measureRowsRead?: boolean } = {},
) {
  const startedAt = performance.now();
  const latencyMs = options.latencyMs ?? 0;
  if (!Number.isFinite(latencyMs) || latencyMs < 0) throw new Error("D1 latency must be finite and nonnegative");
  const queries: QuerySample[] = [];
  const constraints: string[] = [];
  const statements = new WeakMap<StatementLike, { raw: StatementLike; sql: string; bindings: unknown[] }>();
  const plans = new Map<string, unknown[]>();

  function statement(raw: StatementLike, sql: string, bindings: unknown[] = []): StatementLike {
    const wrapped: StatementLike = {
      bind: (...values) => statement(raw.bind(...values), sql, values),
      run: () => timed("run", sql, () => raw.run(), { sql, bindings }),
      all: () => timed("all", sql, () => raw.all(), { sql, bindings }),
      first: (column) => timed("first", sql, () => raw.first(column), { sql, bindings, column }),
    };
    statements.set(wrapped, { raw, sql, bindings });
    return wrapped;
  }

  function serializedBytes(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value) ?? "null").byteLength;
  }

  async function timed<T>(operation: string, sql: string, run: () => Promise<T>, request: unknown): Promise<T> {
    const start = performance.now();
    const requestBytes = options.measurePayloadBytes ? serializedBytes(request) : undefined;
    let resultBytes: number | undefined;
    let rowsRead: number | undefined;
    try {
      if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
      const result = await run();
      if (options.measurePayloadBytes) resultBytes = serializedBytes(result);
      if (options.measureRowsRead) rowsRead = rowsReadBy(result);
      return result;
    } finally {
      queries.push({
        operation,
        sql: sql.replace(/\s+/g, " ").trim(),
        startedAtMs: start - startedAt,
        durationMs: performance.now() - start,
        ...(options.measurePayloadBytes ? { requestBytes, resultBytes } : {}),
        ...(options.measureRowsRead ? { rowsRead } : {}),
      });
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
        return timed(
          "batch",
          details.map((item) => item.sql).join("; "),
          () => db.batch(details.map((item) => item.raw)),
          details.map(({ sql, bindings }) => ({ sql, bindings })),
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

  function summary() {
    return { roundTrips: queries.length, statements: executed.length, queries: [...queries] };
  }

  return {
    db: wrap(database),
    summary,
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
        latencyMs,
        traceEvents: queries.map((query, index) => ({
          name: `D1 ${query.operation}`,
          cat: "database",
          ph: "X",
          pid: 1,
          tid: index + 1,
          ts: query.startedAtMs * 1_000,
          dur: query.durationMs * 1_000,
          args: { sql: query.sql },
        })),
        ...summary(),
        executedSql: executed.map(({ sql }) => sql.replace(/\s+/g, " ").trim()),
        plans: [...plans].map(([sql, plan]) => ({ sql: sql.replace(/\s+/g, " ").trim(), plan })),
      };
    },
  };
}
