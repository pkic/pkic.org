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
    `INSERT INTO users (id, email, normalized_email, first_name, last_name, biography, active, created_at, updated_at)
     VALUES (?, 'proposer@example.test', 'proposer@example.test', 'Pat', 'Proposer',
             'A proposer biography long enough to satisfy the shared speaker profile validation rules.', 1,
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

      // What the proposer sets for a co-speaker belongs to this proposal, not to
      // the person: the authority is safe to hand out because it never writes
      // the speaker's own profile.
      const retitled = await callApp(`${access}/speakers/${added.user_id}`, "PATCH", {
        jobTitle: "Principal Engineer",
      });
      expect(retitled.status, await retitled.clone().text()).toBe(200);
      const [scoped] = await queryAll<{ overrides: string | null; own_title: string | null }>(
        env.DB,
        `SELECT ps.profile_overrides_json AS overrides, u.job_title AS own_title
         FROM proposal_speakers ps JOIN users u ON u.id = ps.user_id
         WHERE ps.proposal_id = ? AND ps.user_id = ?`,
        [proposalId, added.user_id],
      );
      expect(JSON.parse(scoped.overrides ?? "{}")).toMatchObject({ jobTitle: "Principal Engineer" });
      expect(scoped.own_title).toBeNull();

      // A proposer who invites the wrong person must be able to undo it.
      const removed = await callApp(`${access}/speakers/${added.user_id}`, "DELETE");
      expect(removed.status, await removed.clone().text()).toBe(200);
      expect(await speakerEmails(proposalId)).toEqual([]);
    },
  );

  it("freezes an accepted proposal's content but keeps its speaker roster editable", async () => {
    const { proposalId, access } = await seedProposalInStatus("accepted");

    // A published programme must not shift under the attendees who chose it.
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
});
