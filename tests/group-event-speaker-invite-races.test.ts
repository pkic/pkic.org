import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { resetDb } from "./helpers/reset-db";
import { seedWorkflowEmailTemplates } from "./helpers/event-workflow";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { createGroupEventInvitationFixture } from "./helpers/group-event-invitations";
import { createInvite } from "../functions/_lib/services/invite-creation";
import { createGroup } from "../functions/_lib/services/groups";

const cases = (["resend", "revoke"] as const).flatMap((action) =>
  (
    [
      "permission_revoked",
      "event_moved",
      "invite_accepted",
      ...(action === "resend" ? ["schedule_changed" as const] : []),
    ] as const
  ).map((race) => ({ action, race })),
);

describe("group speaker invitation write races", () => {
  beforeEach(resetDb);

  it.each(cases)("rolls back $action when $race after preflight", async ({ action, race }) => {
    const fixture = await createGroupEventInvitationFixture(env.DB, `speaker-${action}-${race}`);
    await seedWorkflowEmailTemplates(env.DB, fixture.actor.id);
    const { invite } = await createInvite(env.DB, {
      eventId: fixture.eventId,
      inviteeEmail: "speaker-race@example.test",
      inviteType: "speaker",
    });
    const otherGroup = await createGroup(env.DB, fixture.actor, {
      typeKey: "working_group",
      name: `Speaker race destination ${crypto.randomUUID()}`,
      visibility: "authenticated",
      eligibilityMode: "open",
    });
    const saved = await env.DB.prepare(
      "SELECT status, link_secret, expires_at, last_communication_at FROM invites WHERE id = ?",
    )
      .bind(invite.id)
      .first();
    let raced = false;
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("UPDATE invites"),
      async () => {
        raced = true;
        switch (race) {
          case "permission_revoked":
            await env.DB.prepare("UPDATE user_roles SET revoked_at = ? WHERE user_id = ?")
              .bind(new Date().toISOString(), fixture.actor.id)
              .run();
            break;
          case "event_moved":
            await env.DB.prepare("UPDATE events SET owner_group_id = ? WHERE id = ?")
              .bind(otherGroup.id, fixture.eventId)
              .run();
            break;
          case "schedule_changed":
            await env.DB.prepare("UPDATE events SET ends_at = starts_at WHERE id = ?").bind(fixture.eventId).run();
            break;
          case "invite_accepted":
            await env.DB.prepare("UPDATE invites SET status = 'accepted' WHERE id = ?").bind(invite.id).run();
            break;
        }
      },
    );
    const response = await callApi({ ...env, DB: db }, `${fixture.basePath}/speakers/${invite.id}/${action}`, {
      method: "POST",
      headers: { authorization: `Bearer ${fixture.token}`, "content-type": "application/json" },
      body: "{}",
    });
    expect(raced).toBe(true);
    expect(response.status, await response.clone().text()).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code:
          race === "schedule_changed"
            ? "EVENT_INVITE_WINDOW_CHANGED"
            : race === "invite_accepted"
              ? "INVITE_CHANGED"
              : "GROUP_EVENT_PROPOSAL_CONTEXT_CHANGED",
      },
    });
    await expect(
      env.DB.prepare("SELECT status, link_secret, expires_at, last_communication_at FROM invites WHERE id = ?")
        .bind(invite.id)
        .first(),
    ).resolves.toEqual({ ...saved, ...(race === "invite_accepted" ? { status: "accepted" } : {}) });
    await expect(
      env.DB.prepare("SELECT COUNT(*) AS count FROM email_outbox WHERE event_id = ?").bind(fixture.eventId).first(),
    ).resolves.toEqual({ count: 0 });
    await expect(
      env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity_type = 'invite' AND entity_id = ?")
        .bind(invite.id)
        .first(),
    ).resolves.toEqual({ count: 0 });
  });
});
