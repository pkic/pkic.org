import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { resetDb } from "./helpers/reset-db";
import { seedWorkflowEmailTemplates } from "./helpers/event-workflow";
import { listGroupEventSpeakerInvites } from "../functions/_lib/services/events/group-invite-management";
import { mutateBeforeMatchingQuery, mutateBeforeNextBatch } from "./helpers/database-races";
import { createGroupEventInvitationFixture } from "./helpers/group-event-invitations";
import { createGroup } from "../functions/_lib/services/groups";
import type { DatabaseLike } from "../functions/_lib/types";

async function request(token: string, path: string, body?: unknown, db: DatabaseLike = env.DB): Promise<Response> {
  return callApi({ ...env, DB: db }, path, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("group event bulk invitations", () => {
  beforeEach(resetDb);

  it.each(["permission_revoked", "event_moved"] as const)(
    "refuses speaker bulk invitations atomically when %s after preflight",
    async (race) => {
      const fixture = await createGroupEventInvitationFixture(env.DB, `speaker-${race}`);
      await seedWorkflowEmailTemplates(env.DB, fixture.actor.id);
      const invites = [{ email: "speaker-race@example.test", firstName: "Synthetic" }];
      const preview = await request(fixture.token, `${fixture.basePath}/speakers/preview`, { invites });
      expect(preview.status, await preview.clone().text()).toBe(200);
      const { previewToken, inviteDigest } = (await preview.json()) as {
        previewToken: string;
        inviteDigest: string;
      };
      const otherGroup = await createGroup(env.DB, fixture.actor, {
        typeKey: "working_group",
        name: `Speaker race destination ${crypto.randomUUID()}`,
        visibility: "authenticated",
        eligibilityMode: "open",
      });
      let raced = false;
      const db = mutateBeforeMatchingQuery(
        env.DB,
        (sql) => sql.includes("INSERT INTO invites"),
        async () => {
          raced = true;
          if (race === "permission_revoked") {
            await env.DB.prepare("UPDATE user_roles SET revoked_at = ? WHERE user_id = ?")
              .bind(new Date().toISOString(), fixture.actor.id)
              .run();
          } else {
            await env.DB.prepare("UPDATE events SET owner_group_id = ? WHERE id = ?")
              .bind(otherGroup.id, fixture.eventId)
              .run();
          }
        },
      );
      const response = await request(
        fixture.token,
        `${fixture.basePath}/speakers/bulk`,
        { invites, previewToken, inviteDigest },
        db,
      );
      expect(raced).toBe(true);
      expect(response.status, await response.clone().text()).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "GROUP_EVENT_PROPOSAL_CONTEXT_CHANGED" },
      });
      for (const table of ["invites", "email_outbox"] as const) {
        await expect(
          env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE event_id = ?`).bind(fixture.eventId).first(),
        ).resolves.toEqual({ count: 0 });
      }
    },
  );

  it("uses only nested group routes for preview, attendee creation, and speaker lifecycle", async () => {
    const fixture = await createGroupEventInvitationFixture(env.DB, "bulk-invitations");
    await seedWorkflowEmailTemplates(env.DB, fixture.actor.id);
    const { actor, token, basePath: base } = fixture;

    const attendeePreview = await request(token, `${base}/attendees/preview`, {
      invites: [{ email: "attendee@example.test", firstName: "Attendee" }],
      expiresAt: "2027-03-31T09:00:00.000Z",
    });
    expect(attendeePreview.status, await attendeePreview.clone().text()).toBe(200);
    const attendeeToken = (await attendeePreview.json()) as { previewToken: string; inviteDigest: string };
    const substituted = await request(token, `${base}/attendees/bulk`, {
      invites: [{ email: "substituted@example.test", firstName: "Substituted" }],
      expiresAt: "2027-03-31T09:00:00.000Z",
      ...attendeeToken,
    });
    expect(substituted.status, await substituted.clone().text()).toBe(409);
    await expect(
      env.DB.prepare("SELECT id FROM invites WHERE invitee_email = 'substituted@example.test'").all(),
    ).resolves.toMatchObject({ results: [] });

    const attendeeBulk = await request(token, `${base}/attendees/bulk`, {
      invites: [{ email: "attendee@example.test", firstName: "Attendee" }],
      expiresAt: "2027-03-31T09:00:00.000Z",
      ...attendeeToken,
    });
    expect(attendeeBulk.status, await attendeeBulk.clone().text()).toBe(200);
    expect((await attendeeBulk.json()) as { created: Array<{ email: string }> }).toMatchObject({
      created: [{ email: "attendee@example.test" }],
    });
    const attendeeOutbox = await env.DB.prepare("SELECT payload_json FROM email_outbox WHERE recipient_email = ?")
      .bind("attendee@example.test")
      .first<{ payload_json: string }>();
    expect(JSON.parse(attendeeOutbox!.payload_json)).toMatchObject({
      firstName: { __pkicEmailPlainText: "Attendee" },
      attendeeName: { __pkicEmailPlainText: "Attendee" },
    });

    const speakerPreview = await request(token, `${base}/speakers/preview`, {
      invites: [{ email: "speaker@example.test", firstName: "Speaker" }],
    });
    expect(speakerPreview.status, await speakerPreview.clone().text()).toBe(200);
    const speakerPreviewBody = (await speakerPreview.json()) as {
      previewToken: string;
      inviteDigest: string;
      html: string;
    };
    expect(speakerPreviewBody.html).not.toContain("{{attendeeName}}");
    const { previewToken, inviteDigest } = speakerPreviewBody;
    const speakerBulk = await request(token, `${base}/speakers/bulk`, {
      invites: [{ email: "speaker@example.test", firstName: "Speaker" }],
      previewToken,
      inviteDigest,
    });
    expect(speakerBulk.status, await speakerBulk.clone().text()).toBe(200);

    const speakerList = await callApi(env, `${base}/speakers`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(speakerList.status, await speakerList.clone().text()).toBe(200);
    const speaker = ((await speakerList.json()) as { invites: Array<{ id: string; inviteType: string }> }).invites[0];
    expect(speaker).toMatchObject({ inviteType: "speaker" });

    const revoked = await request(token, `${base}/speakers/${speaker.id}/revoke`, {});
    expect(revoked.status, await revoked.clone().text()).toBe(200);
    await expect(
      env.DB.prepare("SELECT status FROM invites WHERE id = ?").bind(speaker.id).first<{ status: string }>(),
    ).resolves.toEqual({ status: "revoked" });

    const otherGroup = await createGroup(env.DB, actor, {
      typeKey: "working_group",
      name: `Other invitation group ${crypto.randomUUID()}`,
      visibility: "authenticated",
      eligibilityMode: "open",
    });
    const racingDb = mutateBeforeNextBatch(env.DB, async () => {
      await env.DB.prepare("UPDATE events SET owner_group_id = ? WHERE id = ?")
        .bind(otherGroup.id, fixture.eventId)
        .run();
    });
    await expect(
      listGroupEventSpeakerInvites(racingDb, actor, fixture.groupId, fixture.eventId, {
        limit: 50,
        offset: 0,
        sort: "-created_at",
      }),
    ).rejects.toMatchObject({ status: 409, code: "GROUP_EVENT_PROPOSAL_CONTEXT_CHANGED" });
  });
});
