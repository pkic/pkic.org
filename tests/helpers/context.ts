import type { DatabaseLike, Env, PagesContext } from "../../functions/_lib/types";
import type { RateLimitBinding } from "../../functions/_lib/rate-limit";

/**
 * Query helper replacing the old `D1DatabaseShim.raw()` method.
 * Returns the result rows of a prepared SQL statement.
 */
export async function queryAll<T = Record<string, unknown>>(
  db: DatabaseLike,
  sql: string,
  ...values: unknown[]
): Promise<T[]> {
  const boundValues = values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
  const stmt = boundValues.length > 0 ? db.prepare(sql).bind(...boundValues) : db.prepare(sql);
  const { results } = await stmt.all<T>();
  return results;
}

export function createContext<P extends Record<string, string>>(
  env: Env,
  request: Request,
  params: P,
): PagesContext<P> {
  const data: Record<string, unknown> = {};
  const waitUntil = (promise: Promise<unknown>) => {
    void promise.catch(() => undefined);
  };

  return {
    env,
    request,
    params,
    data,
    req: {
      raw: request,
      param(name?: string) {
        return name ? params[name] : params;
      },
    },
    executionCtx: {
      waitUntil,
    },
    set(key: string, value: unknown) {
      data[key] = value;
    },
    get(key: string) {
      return data[key];
    },
    waitUntil,
  };
}

export function createTestRateLimiter(limit: number): RateLimitBinding {
  const countsByKey = new Map<string, number>();
  return {
    async limit({ key }) {
      const count = (countsByKey.get(key) ?? 0) + 1;
      countsByKey.set(key, count);
      return { success: count <= limit };
    },
  };
}

export async function seedEventAndAdmin(db: DatabaseLike): Promise<{ eventId: string }> {
  const eventId = crypto.randomUUID();
  const adminId = crypto.randomUUID();

  await db.batch([
    db.prepare(
      `INSERT INTO events (id, slug, name, timezone, starts_at, ends_at, source_path, capacity_in_person, registration_mode, invite_limit_attendee, settings_json, created_at, updated_at)
       VALUES ('${eventId}', 'pqc-2026', 'PQC Conference 2026', 'Europe/Amsterdam',
       '2026-12-01T08:00:00.000Z', '2026-12-03T18:00:00.000Z',
       'content/events/2026/pqc-conference-amsterdam-nl/_index.md', 1,
       'invite_or_open', 5, '{}', datetime('now'), datetime('now'))`,
    ),
    db.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES ('${adminId}', 'admin@pkic.org', 'admin@pkic.org', 'admin', 1, datetime('now'), datetime('now'))`,
    ),
    db.prepare(
      `INSERT INTO event_terms (id, event_id, audience_type, term_key, version, required, content_ref, active, created_at) VALUES
       ('${crypto.randomUUID()}', '${eventId}', 'attendee', 'privacy-policy', 'v1', 1, '/privacy', 1, datetime('now')),
       ('${crypto.randomUUID()}', '${eventId}', 'attendee', 'code-of-conduct', 'v1', 1, '/code-of-conduct', 1, datetime('now')),
       ('${crypto.randomUUID()}', '${eventId}', 'speaker', 'speaker-terms', 'v1', 1, '/speaker-terms', 1, datetime('now'))`,
    ),
  ]);

  return { eventId };
}
