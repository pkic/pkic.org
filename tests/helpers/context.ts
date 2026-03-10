import { D1DatabaseShim } from "./d1-shim";
import { R2BucketShim } from "./r2-shim";
import type { Env, PagesContext } from "../../functions/_lib/types";

export function createEnv(db: D1DatabaseShim): Env {
  return {
    DB: db,
    ASSETS_BUCKET: new R2BucketShim(),
    CF_PAGES_URL: "https://app.test",
    DEFAULT_MIN_PROPOSAL_REVIEWS: "2",
    DEFAULT_REFERRAL_CODE_LENGTH: "7",
    DEFAULT_INVITE_LIMIT_PER_ATTENDEE: "5",
    WAITLIST_CLAIM_WINDOW_HOURS: "24",
    MAGIC_LINK_TTL_MINUTES: "15",
    MANAGE_TOKEN_TTL_HOURS: "48",
    SENDGRID_API_BASE: "https://api.sendgrid.com/v3/mail/send",
    SENDGRID_API_KEY: "test-key",
    SENDGRID_FROM_EMAIL: "noreply@pkic.org",
    SENDGRID_FROM_NAME: "PKI Consortium",
    EMAIL_LAYOUT_R2_KEY: "layouts/email/default.html",
    INTERNAL_SIGNING_SECRET: "test-signing-secret",
    FEEDBACK_IDENTITY_SECRET_V1: "feedback-secret",
  };
}

export function createContext<P extends Record<string, string>>(
  env: Env,
  request: Request,
  params: P,
): PagesContext<P> {
  return {
    env,
    request,
    params,
    waitUntil(promise: Promise<unknown>) {
      void promise.catch(() => undefined);
    },
  };
}

export async function seedEventAndAdmin(db: D1DatabaseShim): Promise<{ eventId: string }> {
  const eventId = crypto.randomUUID();
  const adminId = crypto.randomUUID();

  await db.exec?.(`
    INSERT INTO events (
      id, slug, name, timezone, starts_at, ends_at, source_path, capacity_in_person,
      registration_mode, invite_limit_attendee, settings_json, created_at, updated_at
    ) VALUES (
      '${eventId}', 'pqc-2026', 'PQC Conference 2026', 'Europe/Amsterdam',
      '2026-12-01T08:00:00.000Z', '2026-12-03T18:00:00.000Z',
      'content/events/2026/pqc-conference-amsterdam-nl/_index.md', 1,
      'invite_or_open', 5, '{}', datetime('now'), datetime('now')
    );

    INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
    VALUES ('${adminId}', 'admin@pkic.org', 'admin@pkic.org', 'admin', 1, datetime('now'), datetime('now'));

    INSERT INTO event_terms (id, event_id, audience_type, term_key, version, required, content_ref, active, created_at)
    VALUES
      ('${crypto.randomUUID()}', '${eventId}', 'attendee', 'privacy-policy', 'v1', 1, '/privacy', 1, datetime('now')),
      ('${crypto.randomUUID()}', '${eventId}', 'attendee', 'code-of-conduct', 'v1', 1, '/code-of-conduct', 1, datetime('now')),
      ('${crypto.randomUUID()}', '${eventId}', 'speaker', 'speaker-terms', 'v1', 1, '/speaker-terms', 1, datetime('now'));
  `);

  return { eventId };
}
