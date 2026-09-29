import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import {
  TEST_GROUPS,
  createCanonicalVote,
  createOrganizationCapacity,
  joinVotingGroup,
  resolveAuthMember,
  seedVotingAdmin,
} from "./helpers/voting";
import { submitConsultationResponse } from "../functions/_lib/services/votes/consultation-responses";
import { submitBallot, closeDueVotes } from "../functions/_lib/services/votes";
import type { AuthAdmin } from "../functions/_lib/types";

/**
 * The consultation round trip against real D1: the answers are ordinary form
 * submissions, the vote owns who may answer and when, and the close tallies
 * per question.
 */
async function seedConsultationForm(): Promise<string> {
  const formId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO forms (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
       VALUES (?, ?, 'global', NULL, 'survey', 'active', 'Direction consultation', NULL, datetime('now'), datetime('now'))`,
    ).bind(formId, `consultation-${formId.slice(0, 8)}`),
    env.DB.prepare(
      `INSERT INTO form_fields (id, form_id, key, label, field_type, required, options_json, sort_order, created_at)
       VALUES (?, ?, 'support', 'Would you support this?', 'select', 1, ?, 0, datetime('now'))`,
    ).bind(
      crypto.randomUUID(),
      formId,
      JSON.stringify([
        { value: "yes", label: "Yes", active: true },
        { value: "no", label: "No", active: true },
      ]),
    ),
    env.DB.prepare(
      `INSERT INTO form_fields (id, form_id, key, label, field_type, required, options_json, sort_order, created_at)
       VALUES (?, ?, 'how', 'How should it be done?', 'select', 0, ?, 1, datetime('now'))`,
    ).bind(
      crypto.randomUUID(),
      formId,
      JSON.stringify([
        { value: "phased", label: "Phased", active: true },
        { value: "immediate", label: "Immediate", active: true },
      ]),
    ),
  ]);
  return formId;
}

describe("consultation responses", () => {
  let admin: AuthAdmin;

  beforeEach(async () => {
    await resetDb();
    ({ admin } = await seedVotingAdmin(env.DB));
  });

  it("records a response as a form submission the vote points at", async () => {
    const formId = await seedConsultationForm();
    const capacity = await createOrganizationCapacity(env.DB, { category: "A" });
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
    const vote = await createCanonicalVote(env.DB, admin, { voteType: "consultation", questionFormId: formId });

    const member = await resolveAuthMember(env.DB, capacity.userId);
    await submitConsultationResponse(env.DB, member, vote.id, capacity.memberId, {
      support: "yes",
      how: "phased",
    });

    const answers = await queryAll<{ field_key: string; data_json: string }>(
      env.DB,
      `SELECT answer.field_key, answer.data_json
         FROM vote_consultation_responses response
         JOIN form_submission_answers answer ON answer.submission_id = response.submission_id
        WHERE response.vote_id = ? ORDER BY answer.field_key`,
      [vote.id],
    );
    expect(answers.map((row) => [row.field_key, JSON.parse(row.data_json)])).toEqual([
      ["how", "phased"],
      ["support", "yes"],
    ]);
  });

  it("replaces a response rather than recording a second one", async () => {
    const formId = await seedConsultationForm();
    const capacity = await createOrganizationCapacity(env.DB, { category: "A" });
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
    const vote = await createCanonicalVote(env.DB, admin, { voteType: "consultation", questionFormId: formId });

    const member = await resolveAuthMember(env.DB, capacity.userId);
    await submitConsultationResponse(env.DB, member, vote.id, capacity.memberId, { support: "yes" });
    await submitConsultationResponse(env.DB, member, vote.id, capacity.memberId, { support: "no" });

    const links = await queryAll(env.DB, `SELECT id FROM vote_consultation_responses WHERE vote_id = ?`, [vote.id]);
    expect(links, "one Member holds one response, not a growing list").toHaveLength(1);
  });

  it("refuses a rejected option and an unknown question, exactly as a form does", async () => {
    const formId = await seedConsultationForm();
    const capacity = await createOrganizationCapacity(env.DB, { category: "A" });
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
    const vote = await createCanonicalVote(env.DB, admin, { voteType: "consultation", questionFormId: formId });
    const member = await resolveAuthMember(env.DB, capacity.userId);

    // A consultation response is a form submission, so it fails validation
    // the same way one does rather than inventing a vote-specific error.
    await expect(
      submitConsultationResponse(env.DB, member, vote.id, capacity.memberId, { support: "maybe" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      submitConsultationResponse(env.DB, member, vote.id, capacity.memberId, { support: "yes", nonsense: "x" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("refuses a single-choice ballot at a consultation that asks a form", async () => {
    const formId = await seedConsultationForm();
    const capacity = await createOrganizationCapacity(env.DB, { category: "A" });
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
    const vote = await createCanonicalVote(env.DB, admin, { voteType: "consultation", questionFormId: formId });
    const member = await resolveAuthMember(env.DB, capacity.userId);

    // Silently accepting this would put a ballot into a tally that reads
    // responses, so it would never be counted and nobody would know.
    await expect(submitBallot(env.DB, member, vote.id, capacity.memberId, "in_favor", null)).rejects.toMatchObject({
      status: 422,
    });
  });

  it("tallies per question when the consultation closes", async () => {
    const formId = await seedConsultationForm();
    const first = await createOrganizationCapacity(env.DB, { category: "A" });
    const second = await createOrganizationCapacity(env.DB, { category: "A" });
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, first.userId, [first.memberId]);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, second.userId, [second.memberId]);
    const vote = await createCanonicalVote(env.DB, admin, { voteType: "consultation", questionFormId: formId });

    await submitConsultationResponse(env.DB, await resolveAuthMember(env.DB, first.userId), vote.id, first.memberId, {
      support: "yes",
      how: "phased",
    });
    await submitConsultationResponse(env.DB, await resolveAuthMember(env.DB, second.userId), vote.id, second.memberId, {
      support: "yes",
      how: "immediate",
    });

    await env.DB.prepare("UPDATE votes SET closes_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 1_000).toISOString(), vote.id)
      .run();
    await closeDueVotes(env.DB);

    const [row] = await queryAll<{ result_json: string }>(env.DB, "SELECT result_json FROM votes WHERE id = ?", [
      vote.id,
    ]);
    const result = JSON.parse(row.result_json);
    expect(result.totalResponses).toBe(2);
    const support = result.questions.find((question: { key: string }) => question.key === "support");
    expect(support.counts).toEqual({ yes: 2, no: 0 });
    expect(support.leadingOption).toBe("yes");
    const how = result.questions.find((question: { key: string }) => question.key === "how");
    expect(how.leadingOption, "a tie names no leader").toBeNull();
    expect(result, "a consultation reports no outcome").not.toHaveProperty("outcome");
  });
});
