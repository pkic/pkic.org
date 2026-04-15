import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { queryAll } from "./helpers/context";
import { runRetentionJob } from "../functions/_lib/services/retention";

describe("retention job", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it("redacts configured PII while preserving legal consent records", async () => {
    const eventId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const registrationId = crypto.randomUUID();

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO events (
          id, slug, name, timezone, starts_at, ends_at, source_path, capacity_in_person,
          registration_mode, invite_limit_attendee, settings_json, created_at, updated_at
        ) VALUES (
          '${eventId}', 'old-event', 'Old Event', 'UTC',
          '2024-01-01T00:00:00.000Z', '2024-01-02T00:00:00.000Z', NULL,
          NULL, 'invite_or_open', 5, '{}', datetime('now'), datetime('now')
        )
      `),
      env.DB.prepare(`
        INSERT INTO retention_policies (event_id, user_retention_days, updated_at)
        VALUES ('${eventId}', 30, datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, job_title, data_json, created_at, updated_at)
        VALUES ('${userId}', 'old@example.test', 'old@example.test', 'Old', 'Person', 'OldCo', 'OldRole', '{"x":1}', datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO registrations (
          id, event_id, user_id, invite_id, status, attendance_type, source_type, source_ref,
          custom_answers_json, referred_by_code, confirmation_token_hash, confirmation_token_expires_at,
          manage_token_hash, confirmed_at, cancelled_at, created_at, updated_at
        ) VALUES (
          '${registrationId}', '${eventId}', '${userId}', NULL, 'registered', 'virtual', 'direct',
          'sensitive-source', '{"diet":"vegan"}', NULL, NULL, NULL, 'hash', datetime('now'), NULL, datetime('now'), datetime('now')
        )
      `),
      env.DB.prepare(`
        INSERT INTO consent_acceptances (
          id, registration_id, proposal_id, event_id, user_id, audience_type,
          term_key, term_version, accepted_at, ip_hash, user_agent_hash
        ) VALUES (
          '${crypto.randomUUID()}', '${registrationId}', NULL, '${eventId}', '${userId}', 'attendee',
          'privacy-policy', 'v1', datetime('now'), 'iphash', 'uahash'
        )
      `),
    ]);

    const result = await runRetentionJob(env.DB);
    expect(result.redactedRegistrations).toBe(1);

    const registration = (
      await queryAll<{ custom_answers_json: string | null; source_ref: string | null }>(
        env.DB,
        "SELECT custom_answers_json, source_ref FROM registrations WHERE id = ?",
        [registrationId],
      )
    )[0];

    expect(registration.custom_answers_json).toBeNull();
    expect(registration.source_ref).toBeNull();

    const user = (
      await queryAll<{
        organization_name: string | null;
        job_title: string | null;
        first_name: string | null;
        last_name: string | null;
      }>(env.DB, "SELECT organization_name, job_title, first_name, last_name FROM users WHERE id = ?", [userId])
    )[0];

    expect(user.organization_name).toBeNull();
    expect(user.job_title).toBeNull();
    expect(user.first_name).toBeNull();
    expect(user.last_name).toBeNull();

    const consent = (
      await queryAll<{ total: number }>(
        env.DB,
        "SELECT COUNT(*) AS total FROM consent_acceptances WHERE registration_id = ?",
        [registrationId],
      )
    )[0];

    expect(Number(consent.total)).toBe(1);
  });
});
