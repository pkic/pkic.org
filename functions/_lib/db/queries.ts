import type { DatabaseLike } from "../types";

export async function first<T>(db: DatabaseLike, query: string, values: unknown[] = []): Promise<T | null> {
  return db.prepare(query).bind(...values).first<T>();
}

export async function all<T>(db: DatabaseLike, query: string, values: unknown[] = []): Promise<T[]> {
  const result = await db.prepare(query).bind(...values).all<T>();
  return result.results ?? [];
}

export async function run(
  db: DatabaseLike,
  query: string,
  values: unknown[] = [],
): Promise<{ changes: number }> {
  const result = await db.prepare(query).bind(...values).run();
  return { changes: result.meta?.changes ?? 0 };
}

export function toBool(value: unknown): boolean {
  if (typeof value === "number") {
    return value === 1;
  }
  if (typeof value === "string") {
    return value === "1" || value.toLowerCase() === "true";
  }
  return Boolean(value);
}
