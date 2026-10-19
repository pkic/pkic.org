import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { addProposalSpeaker, createProposal } from "../functions/_lib/services/proposals";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

/**
 * What a proposer may still change through their own management capability,
 * by the state the proposal is in.
 *
 * The speaker roster stays editable after acceptance while the title and
 * abstract do not, and a rejected proposal closes both. The policy lives in
 * `proposal-status`; this drives it through the mounted proposer routes so a
 * route that forgot to consult it fails here, not in front of an attendee who
 * chose a session whose abstract had since drifted.
 */
function callApp(path: string, method: string, body?: unknown): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function seedProposalInStatus(status: string): Promise<{ proposalId: string; access: string }> {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const proposerId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, first_name, last_name, active, created_at, updated_at)
     VALUES (?, 'proposer@example.test', 'proposer@example.test', 'Pat', 'Proposer', 1,
             datetime('now'), datetime('now'))`,
  )
    .bind(proposerId)
    .run();
  const { proposal, manageToken } = await createProposal(env.DB, {
    eventId,
    proposerUserId: proposerId,
    proposalType: "talk",
    title: "Roster changes by state",
    abstract: "An abstract long enough to satisfy the shared proposal validation rules and describe the session.",
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
  });
  await addProposalSpeaker(env.DB, { proposalId: proposal.id, userId: proposerId, role: "proposer" });
  await env.DB.prepare("UPDATE session_proposals SET status = ? WHERE id = ?").bind(status, proposal.id).run();
  return { proposalId: proposal.id, access: `/api/v1/proposals/access/${encodeURIComponent(manageToken)}` };
}

const coSpeaker = { email: "co-speaker@example.test", firstName: "Co", lastName: "Speaker", role: "co_speaker" };

async function speakerEmails(proposalId: string): Promise<string[]> {
  const rows = await queryAll<{ email: string }>(
    env.DB,
    `SELECT u.email FROM proposal_speakers ps JOIN users u ON u.id = ps.user_id
     WHERE ps.proposal_id = ? AND ps.role <> 'proposer' ORDER BY u.email`,
    [proposalId],
  );
  return rows.map((row) => row.email);
}

describe("proposer self-service by proposal state", () => {
  beforeEach(resetDb);

  it.each(["submitted", "under_review"])(
    "lets a %s proposal change its content and add and remove a co-speaker",
    async (status) => {
      const { proposalId, access } = await seedProposalInStatus(status);

      const revised = await callApp(access, "PATCH", { title: "Revised while open" });
      expect(revised.status, await revised.clone().text()).toBe(200);
      const [row] = await queryAll<{ title: string }>(env.DB, "SELECT title FROM session_proposals WHERE id = ?", [
        proposalId,
      ]);
      expect(row.title).toBe("Revised while open");

      const invited = await callApp(`${access}/speakers`, "POST", coSpeaker);
      expect(invited.status, await invited.clone().text()).toBe(200);
      expect(await speakerEmails(proposalId)).toEqual([coSpeaker.email]);

      const [added] = await queryAll<{ user_id: string }>(
        env.DB,
        "SELECT user_id FROM proposal_speakers WHERE proposal_id = ? AND role <> 'proposer'",
        [proposalId],
      );

      // The proposer changes a co-speaker's role only: the authority is safe to hand
      // out because it never writes the speaker's own name or profile.
      const refused = await callApp(`${access}/speakers/${added.user_id}`, "PATCH", {
        biography: "A proposal-scoped biography written by the proposer.",
      });
      expect(refused.status).toBe(400);
      const retitled = await callApp(`${access}/speakers/${added.user_id}`, "PATCH", { role: "moderator" });
      expect(retitled.status, await retitled.clone().text()).toBe(200);

      // A proposer who invites the wrong person must be able to undo it.
      const removed = await callApp(`${access}/speakers/${added.user_id}`, "DELETE");
      expect(removed.status, await removed.clone().text()).toBe(200);
      expect(await speakerEmails(proposalId)).toEqual([]);
    },
  );

  it("freezes an accepted proposal's content but keeps its speaker roster editable", async () => {
    const { proposalId, access } = await seedProposalInStatus("accepted");

    // A published program must not shift under the attendees who chose it.
    const frozen = await callApp(access, "PATCH", { title: "Retitled after acceptance" });
    expect(frozen.status).toBe(409);
    expect(((await frozen.json()) as { error: { code: string } }).error.code).toBe("PROPOSAL_NOT_EDITABLE");
    const [row] = await queryAll<{ title: string }>(env.DB, "SELECT title FROM session_proposals WHERE id = ?", [
      proposalId,
    ]);
    expect(row.title).toBe("Roster changes by state");

    // Speakers change late, and the proposer must still say who is presenting.
    const invited = await callApp(`${access}/speakers`, "POST", coSpeaker);
    expect(invited.status, await invited.clone().text()).toBe(200);
    const [late] = await queryAll<{ user_id: string }>(
      env.DB,
      "SELECT user_id FROM proposal_speakers WHERE proposal_id = ? AND role <> 'proposer'",
      [proposalId],
    );
    const removed = await callApp(`${access}/speakers/${late.user_id}`, "DELETE");
    expect(removed.status, await removed.clone().text()).toBe(200);
    expect(await speakerEmails(proposalId)).toEqual([]);
  });

  it.each(["rejected", "withdrawn", "canceled"])(
    "closes both the content and the roster of a %s proposal",
    async (status) => {
      const { proposalId, access } = await seedProposalInStatus(status);

      const edited = await callApp(access, "PATCH", { title: "Retitled after the decision" });
      expect(edited.status).toBe(409);
      expect(((await edited.json()) as { error: { code: string } }).error.code).toBe("PROPOSAL_NOT_EDITABLE");

      const invited = await callApp(`${access}/speakers`, "POST", coSpeaker);
      expect(invited.status).toBeGreaterThanOrEqual(400);
      expect(await speakerEmails(proposalId)).toEqual([]);
    },
  );

  const notesOf = async (proposalId: string) =>
    (
      await queryAll<{ committee_notes: string | null; status: string; review_round: number }>(
        env.DB,
        "SELECT committee_notes, status, review_round FROM session_proposals WHERE id = ?",
        [proposalId],
      )
    )[0];

  it.each(["submitted", "under_review", "needs-work"])(
    "lets the proposer edit the notes for the program committee of a %s proposal without resubmitting it",
    async (status) => {
      const { proposalId, access } = await seedProposalInStatus(status);
      const before = await notesOf(proposalId);
      const edited = await callApp(access, "PATCH", { committeeNotes: "  Happy to run this as a workshop.  " });
      expect(edited.status, await edited.clone().text()).toBe(200);
      expect(await edited.json()).toMatchObject({ proposal: { committee_notes: "Happy to run this as a workshop." } });
      // Private notes are not what is reviewed: they leave the status and review round alone.
      expect(await notesOf(proposalId)).toEqual({
        committee_notes: "Happy to run this as a workshop.",
        status: before!.status,
        review_round: before!.review_round,
      });
      const cleared = await callApp(access, "PATCH", { committeeNotes: null });
      expect(cleared.status, await cleared.clone().text()).toBe(200);
      expect((await notesOf(proposalId))!.committee_notes).toBeNull();
    },
  );

  it.each(["accepted", "rejected"])(
    "locks the notes for the program committee once a proposal is %s",
    async (status) => {
      const { proposalId, access } = await seedProposalInStatus(status);
      await env.DB.prepare("UPDATE session_proposals SET committee_notes = 'Written before the decision.' WHERE id = ?")
        .bind(proposalId)
        .run();
      const refused = await callApp(access, "PATCH", { committeeNotes: "Changed after the decision." });
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ error: { code: "PROPOSAL_COMMITTEE_NOTES_LOCKED" } });
      expect((await notesOf(proposalId))!.committee_notes).toBe("Written before the decision.");
      // The proposer still reads them on their proposal page.
      const read = await callApp(access, "GET");
      expect(await read.json()).toMatchObject({ proposal: { committee_notes: "Written before the decision." } });
    },
  );
});
