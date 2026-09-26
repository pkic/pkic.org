import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createGroupManagedEvent } from "../functions/_lib/services/events/group-management";
import {
  prepareGroupEventProposalContextGuard,
  requireGroupEventProposalContext,
} from "../functions/_lib/services/proposal-group-context";
import { createProposal } from "../functions/_lib/services/proposals";
import { createGroup } from "../functions/_lib/services/groups";
import type { AuthAdmin } from "../functions/_lib/types";
import { insertUser } from "./helpers/membership";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);

async function userActor(label: string, role = "user"): Promise<AuthAdmin> {
  const email = `${label}-${crypto.randomUUID()}@example.test`;
  const id = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  return { identityType: "user", id, email, role };
}

async function setupProposalContext(): Promise<{
  ownerGroupId: string;
  otherGroupId: string;
  eventId: string;
  otherEventId: string;
  proposalId: string;
}> {
  const administrator = await userActor("proposal-context-administrator", "admin");
  const owner = await createGroup(env.DB, administrator, {
    typeKey: "working_group",
    name: `Proposal owner ${crypto.randomUUID()}`,
    visibility: "authenticated",
    eligibilityMode: "open",
  });
  const other = await createGroup(env.DB, administrator, {
    typeKey: "working_group",
    name: `Unrelated group ${crypto.randomUUID()}`,
    visibility: "authenticated",
    eligibilityMode: "open",
  });
  const event = await createGroupManagedEvent(env.DB, administrator, owner.id, {
    slug: `proposal-context-event-${crypto.randomUUID()}`,
    name: "Proposal context event",
    timezone: "UTC",
    startsAt: "2027-01-01T09:00:00.000Z",
    endsAt: "2027-01-01T17:00:00.000Z",
    profileKey: "workshop",
    registrationPolicy: "no_registration",
    inviteLimitAttendee: 5,
    links: [],
  });
  const otherEvent = await createGroupManagedEvent(env.DB, administrator, owner.id, {
    slug: `proposal-context-other-event-${crypto.randomUUID()}`,
    name: "Unrelated proposal context event",
    timezone: "UTC",
    startsAt: "2027-02-01T09:00:00.000Z",
    endsAt: "2027-02-01T17:00:00.000Z",
    profileKey: "workshop",
    registrationPolicy: "no_registration",
    inviteLimitAttendee: 5,
    links: [],
  });
  const proposalAuthor = await userActor("proposal-context-author");
  const { proposal } = await createProposal(env.DB, {
    eventId: event.eventId,
    proposerUserId: proposalAuthor.id,
    proposalType: "talk",
    title: "Context-bound proposal",
    abstract: "A sufficiently detailed proposal abstract for context tests.",
  });
  return {
    ownerGroupId: owner.id,
    otherGroupId: other.id,
    eventId: event.eventId,
    otherEventId: otherEvent.eventId,
    proposalId: proposal.id,
  };
}

function scopedActor(eventId: string, permission: string): AuthAdmin {
  const id = crypto.randomUUID();
  return {
    identityType: "user",
    id,
    email: `${id}@example.test`,
    role: "user",
    grants: [{ permission, contextType: "event", contextId: eventId }],
  };
}

describe("group event proposal context", () => {
  it("allows event-scoped program committee access without group management", async () => {
    const context = await setupProposalContext();
    const actor = scopedActor(context.eventId, "proposals:read");

    await expect(
      requireGroupEventProposalContext(
        env.DB,
        actor,
        context.ownerGroupId,
        context.eventId,
        "proposals:read",
        context.proposalId,
      ),
    ).resolves.toEqual({
      groupId: context.ownerGroupId,
      eventId: context.eventId,
      proposalId: context.proposalId,
    });
  });

  it("rejects the same proposal through an unrelated group or event", async () => {
    const context = await setupProposalContext();
    const actor = scopedActor(context.eventId, "proposals:read");

    await expect(
      requireGroupEventProposalContext(
        env.DB,
        actor,
        context.otherGroupId,
        context.eventId,
        "proposals:read",
        context.proposalId,
      ),
    ).rejects.toMatchObject({ status: 404, code: "GROUP_EVENT_PROPOSAL_CONTEXT_NOT_FOUND" });

    await expect(
      requireGroupEventProposalContext(
        env.DB,
        actor,
        context.ownerGroupId,
        context.otherEventId,
        "proposals:read",
        context.proposalId,
      ),
    ).rejects.toMatchObject({ status: 404, code: "GROUP_EVENT_PROPOSAL_CONTEXT_NOT_FOUND" });
  });

  it("does not treat generic event access as proposal access", async () => {
    const context = await setupProposalContext();
    const actor = scopedActor(context.eventId, "events:read");

    await expect(
      requireGroupEventProposalContext(
        env.DB,
        actor,
        context.ownerGroupId,
        context.eventId,
        "proposals:read",
        context.proposalId,
      ),
    ).rejects.toMatchObject({ status: 403, code: "PERMISSION_REQUIRED" });
  });

  it("rejects a stale group/event path before a proposal write commits", async () => {
    const context = await setupProposalContext();
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE events SET owner_group_id = ? WHERE id = ?")
        .bind(context.otherGroupId, context.eventId)
        .run(),
    );

    await expect(
      racingDb.batch([
        prepareGroupEventProposalContextGuard(env.DB, {
          groupId: context.ownerGroupId,
          eventId: context.eventId,
          proposalId: context.proposalId,
        }),
        env.DB.prepare("UPDATE session_proposals SET title = ? WHERE id = ?").bind(
          "Must not commit",
          context.proposalId,
        ),
      ]),
    ).rejects.toThrow("AUTHORIZATION_CONTEXT_CHANGED");

    await expect(
      env.DB.prepare("SELECT title FROM session_proposals WHERE id = ?").bind(context.proposalId).first(),
    ).resolves.toMatchObject({ title: "Context-bound proposal" });
  });
});
