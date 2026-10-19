import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { queryAll } from "./helpers/context";
import { runRetentionJob, summarizeRetentionJob } from "../functions/_lib/services/retention";
import { seedOrganizationAggregate } from "./helpers/membership";
import { getPublicMemberById } from "../functions/_lib/services/membership/directory";
import { sitePublicationRequestSchema } from "../assets/shared/schemas/site-publication-requests";
import type { DatabaseLike } from "../functions/_lib/types";

describe("retention job", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it.each([
    { publicMember: false, failRequest: false },
    { publicMember: true, failRequest: false },
    { publicMember: true, failRequest: true },
    { publicMember: true, failRequest: false, visibility: "hidden" },
    { publicMember: true, failRequest: false, visibility: "ended" },
    { publicMember: true, failRequest: false, visibility: "inactive" },
  ])(
    "redacts configured PII atomically while preserving legal consent: %j",
    async ({ publicMember, failRequest, visibility = "visible" }) => {
      const eventId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      const registrationId = crypto.randomUUID();
      const organizationId = crypto.randomUUID();
      const identityId = crypto.randomUUID();

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
        INSERT INTO users (id, email, normalized_email, first_name, last_name, data_json, created_at, updated_at)
        VALUES ('${userId}', 'old@example.test', 'old@example.test', 'Old', 'Person', '{"x":1}', datetime('now'), datetime('now'))
      `),
        env.DB.prepare(`
        INSERT INTO organizations (id, name, normalized_name, created_at, updated_at)
        VALUES ('${organizationId}', 'OldCo', 'oldco', datetime('now'), datetime('now'))
      `),
        env.DB.prepare(`
        INSERT INTO identities (
          id, user_id, organization_id, job_title, biography, links_json, source,
          invited_at, started_at, created_at, updated_at
        ) VALUES (
          '${identityId}', '${userId}', '${organizationId}', 'OldRole', 'Old biography', '[]', 'staff',
          '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z'
        )
      `),
        env.DB.prepare(`
        INSERT INTO individual_job_titles (user_id, job_title, created_at, updated_at)
        VALUES ('${userId}', 'Independent Role', datetime('now'), datetime('now'))
      `),
        env.DB.prepare(`
        INSERT INTO affiliation_reviews (id, user_id, organization_name, normalized_name, job_title, group_key, source_type, source_id, created_at)
        VALUES ('review-${userId}', '${userId}', 'Unmatched Co', 'unmatched co', 'Unmatched Role', 'unmatched', 'user_profile', '${userId}', datetime('now'))
      `),
        env.DB.prepare(`
        INSERT INTO registrations (
          id, event_id, user_id, invite_id, status, attendance_type, source_type, source_ref,
          custom_answers_json, referred_by_code, confirmation_link_secret,
          manage_link_secret, confirmed_at, cancelled_at, created_at, updated_at
        ) VALUES (
          '${registrationId}', '${eventId}', '${userId}', NULL, 'registered', 'virtual', 'direct',
          'sensitive-source', '{"diet":"vegan"}', NULL, NULL, 'hash', datetime('now'), NULL, datetime('now'), datetime('now')
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

      if (publicMember) await seedOrganizationAggregate(env.DB, organizationId, "A");
      if (visibility === "hidden")
        await env.DB.prepare("UPDATE identities SET show_on_organization_profile=0 WHERE id=?").bind(identityId).run();
      if (visibility === "ended")
        await env.DB.prepare("UPDATE identities SET ended_at=? WHERE id=?")
          .bind("2024-02-01T00:00:00.000Z", identityId)
          .run();
      if (visibility === "inactive")
        await env.DB.prepare("UPDATE members SET status='inactive' WHERE organization_id=?").bind(organizationId).run();
      const publicChange = publicMember && visibility === "visible";
      const before = await getPublicMemberById(env.DB, organizationId);
      if (failRequest) {
        await env.DB.prepare(`CREATE TRIGGER fail_retention_publication BEFORE INSERT ON site_publication_requests
        BEGIN SELECT RAISE(ABORT,'SYNTHETIC_RETENTION_REQUEST_FAILURE'); END`).run();
        try {
          await expect(runRetentionJob(env.DB)).rejects.toThrow("SYNTHETIC_RETENTION_REQUEST_FAILURE");
          expect(await getPublicMemberById(env.DB, organizationId)).toEqual(before);
          expect(await queryAll(env.DB, "SELECT source_ref FROM registrations WHERE id=?", [registrationId])).toEqual([
            { source_ref: "sensitive-source" },
          ]);
          expect(await queryAll(env.DB, "SELECT pii_redacted_at FROM users WHERE id=?", [userId])).toEqual([
            { pii_redacted_at: null },
          ]);
          expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toEqual([]);
        } finally {
          await env.DB.prepare("DROP TRIGGER fail_retention_publication").run();
        }
      }
      const result = await runRetentionJob(env.DB);
      const after = await getPublicMemberById(env.DB, organizationId);
      if (publicChange) expect(after).not.toEqual(before);
      else expect(after).toEqual(before);
      const requests = await queryAll<{ id: string; resource_id: string; reason_code: string }>(
        env.DB,
        "SELECT id,resource_id,reason_code FROM site_publication_requests",
      );
      expect(requests).toEqual(
        publicChange ? [{ id: expect.any(String), resource_id: userId, reason_code: "user_profile_changed" }] : [],
      );
      for (const request of requests) sitePublicationRequestSchema.pick({ id: true }).parse(request);
      await runRetentionJob(env.DB);
      expect(await queryAll(env.DB, "SELECT id,resource_id,reason_code FROM site_publication_requests")).toEqual(
        requests,
      );
      expect(result.redactedRegistrations).toBe(1);

      const registration = (
        await queryAll<{
          custom_answers_json: string | null;
          source_ref: string | null;
        }>(env.DB, "SELECT custom_answers_json, source_ref FROM registrations WHERE id = ?", [registrationId])
      )[0];

      expect(registration.custom_answers_json).toBeNull();
      expect(registration.source_ref).toBeNull();

      const user = (
        await queryAll<{
          first_name: string | null;
          last_name: string | null;
        }>(env.DB, "SELECT first_name, last_name FROM users WHERE id = ?", [userId])
      )[0];

      expect(user.first_name).toBeNull();
      expect(user.last_name).toBeNull();
      // The identity stays so records naming it keep their organization; its personal text does not.
      expect(
        await queryAll(
          env.DB,
          "SELECT organization_id, job_title, biography, links_json FROM identities WHERE id = ?",
          [identityId],
        ),
      ).toEqual([{ organization_id: organizationId, job_title: null, biography: null, links_json: null }]);
      expect(await queryAll(env.DB, "SELECT user_id FROM individual_job_titles WHERE user_id = ?", [userId])).toEqual(
        [],
      );
      expect(await queryAll(env.DB, "SELECT id FROM affiliation_reviews WHERE user_id = ?", [userId])).toEqual([]);

      const consent = (
        await queryAll<{ total: number }>(
          env.DB,
          "SELECT COUNT(*) AS total FROM consent_acceptances WHERE registration_id = ?",
          [registrationId],
        )
      )[0];

      expect(Number(consent.total)).toBe(1);
    },
  );

  it("summarizes every due policy with one set-based D1 query", async () => {
    const eventId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO events
             (id, slug, name, timezone, starts_at, ends_at, registration_mode, invite_limit_attendee,
              settings_json, created_at, updated_at)
           VALUES (?, 'set-based-retention', 'Set Based', 'UTC', '2020-01-01', '2020-01-02',
                   'invite_or_open', 5, '{}', datetime('now'), datetime('now'))`,
      ).bind(eventId),
      env.DB.prepare(
        "INSERT INTO retention_policies (event_id, user_retention_days, updated_at) VALUES (?, 30, datetime('now'))",
      ).bind(eventId),
    ]);

    let prepareCount = 0;
    const countingDb: DatabaseLike = {
      prepare(query) {
        prepareCount += 1;
        return env.DB.prepare(query);
      },
      batch: (statements) => env.DB.batch(statements as D1PreparedStatement[]),
    };
    const result = await summarizeRetentionJob(countingDb);

    expect(result.totalEvents).toBe(1);
    expect(result.dueEvents[0].eventId).toBe(eventId);
    expect(prepareCount).toBe(1);
  });
});
