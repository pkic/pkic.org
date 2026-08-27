import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { seedWorkflowEmailTemplates } from "./helpers/event-workflow";
import { createGroup } from "../functions/_lib/services/groups";
import { createGroupManagedEvent } from "../functions/_lib/services/events/group-management";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { listGroupEventSpeakerInvites } from "../functions/_lib/services/events/group-invite-management";
import { mutateBeforeNextBatch } from "./helpers/database-races";

async function createActor(): Promise<UserBackedAuthAdmin> {
  const id = await insertUser(env.DB, `bulk-manager-${crypto.randomUUID()}@example.test`);
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(id).run();
  return { identityType: "user", id, email: `bulk-manager-${id}@example.test`, role: "admin" };
}

async function request(token: string, path: string, body?: unknown): Promise<Response> {
  return callApi(env, path, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("group event bulk invitations", () => {
  beforeEach(resetDb);

  it("uses only nested group routes for preview, attendee creation, and speaker lifecycle", async () => {
    const actor = await createActor();
    await seedWorkflowEmailTemplates(env.DB, actor.id);
    const group = await createGroup(env.DB, actor, {
      typeKey: "working_group",
      name: `Bulk invitation group ${crypto.randomUUID()}`,
      visibility: "authenticated",
      eligibilityMode: "open",
    });
    const created = await createGroupManagedEvent(env.DB, actor, group.id, {
      name: "Bulk invitations",
      slug: `bulk-invitations-${crypto.randomUUID()}`,
      timezone: "UTC",
      startsAt: "2027-04-01T09:00:00.000Z",
      endsAt: "2027-04-01T17:00:00.000Z",
      profileKey: "workshop",
      registrationPolicy: "no_registration",
      inviteLimitAttendee: 5,
      location: "Online",
      links: [],
    });
    const token = await createAdminSession(env.DB, actor.id, `bulk-invite-${crypto.randomUUID()}`);
    const base = `/api/v1/groups/${group.id}/events/${created.eventId}/invites`;

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
        .bind(otherGroup.id, created.eventId)
        .run();
    });
    await expect(
      listGroupEventSpeakerInvites(racingDb, actor, group.id, created.eventId, {
        limit: 50,
        offset: 0,
        sort: "-created_at",
      }),
    ).rejects.toMatchObject({ status: 409, code: "GROUP_EVENT_PROPOSAL_CONTEXT_CHANGED" });
  });
});
