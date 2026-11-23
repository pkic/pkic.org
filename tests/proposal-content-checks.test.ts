import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../functions/_lib/types";
import { readContentCheckResult } from "../functions/_lib/services/content-checks/results";
import { callApi } from "./helpers/app";
import { withIndependentCapacity } from "./helpers/independent-capacity";
import { proposalIdentityFixture } from "./helpers/proposal-identity";
import { saveCheckSettings, sampleFlag, sampleScore } from "./helpers/content-check-settings";
import { resetDb } from "./helpers/reset-db";

type Questions = Record<string, { type: "noul" | "score"; criteria?: string[]; instructions?: unknown }>;

/** A stand-in check model: a sales pitch is blocked, a vague abstract draws advice, and every score is the top level. */
const model = {
  run: vi.fn(async (_model: string, input: { state: { abstract: string }; questions: Questions }) => {
    const abstract = input.state.abstract;
    const flag = (id: string) =>
      id === "promotional" && abstract.includes("Buy our gateway")
        ? 0.97
        : id === "thin_abstract" && abstract.includes("Some thoughts")
          ? 0.8
          : 0.03;
    return {
      answers: Object.fromEntries(
        Object.entries(input.questions).map(([id, question]) => [
          id,
          question.type === "noul"
            ? { noul: flag(id) }
            : { probabilities: question.criteria!.map((_, index, all) => (index === all.length - 1 ? 1 : 0)) },
        ]),
      ),
    };
  }),
};
const checkedEnv = { ...env, AI: model } as unknown as Env;

function submit(body: Record<string, unknown>, token: string) {
  return callApi(checkedEnv, "/api/v1/events/pqc-2026/proposals", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(withIndependentCapacity(body)),
  });
}

async function proposalCount(eventId: string) {
  return (await env.DB.prepare("SELECT COUNT(*) AS n FROM session_proposals WHERE event_id = ?").bind(eventId).first<{
    n: number;
  }>())!.n;
}

describe("automatic screening of proposals", () => {
  beforeEach(async () => {
    await resetDb();
    model.run.mockClear();
    await saveCheckSettings("proposal", [
      sampleFlag("promotional", "This reads as a sales pitch.", 92),
      sampleFlag("thin_abstract", "The abstract does not yet say what the audience will learn.", null),
      sampleScore("relevance"),
    ]);
  });

  it("checks nothing and calls no model while no settings are saved", async () => {
    await env.DB.prepare("DELETE FROM content_check_settings").run();
    const { token, body } = await proposalIdentityFixture();
    const response = await submit(
      { ...body, proposal: { ...body.proposal, abstract: `${body.proposal.abstract} Buy our gateway today.` } },
      token,
    );
    expect(response.status).toBe(200);
    const { proposalId } = await response.json<{ proposalId: string }>();
    expect(model.run).not.toHaveBeenCalled();
    expect(await readContentCheckResult(env.DB, "proposal", proposalId)).toBeNull();
  });

  it("gives the model the event's own description beside the PKIC-wide context", async () => {
    await saveCheckSettings("proposal", [sampleFlag("promotional", "Pitch.")], { context: "Wide rules." });
    const { eventId, token, body } = await proposalIdentityFixture();
    await env.DB.prepare("UPDATE events SET name = 'Harbor Summit', city = 'Rotterdam', country = 'NL' WHERE id = ?")
      .bind(eventId)
      .run();
    const response = await submit(body, token);
    expect(response.status).toBe(200);
    const questions = (model.run.mock.calls[0]![1] as unknown as { questions: Questions }).questions;
    const context = JSON.stringify(questions);
    expect(context).toContain("Wide rules.");
    expect(context).toContain("Harbor Summit");
    expect(context).toContain("Rotterdam, Netherlands");
  });

  it("refuses a proposal the check blocks, with the reason on the abstract", async () => {
    const { eventId, token, body } = await proposalIdentityFixture();
    const response = await submit(
      { ...body, proposal: { ...body.proposal, abstract: `${body.proposal.abstract} Buy our gateway today.` } },
      token,
    );
    expect(response.status).toBe(422);
    const refusal = await response.json<{
      error: { code: string; details: { fieldErrors: Record<string, string[]> } };
    }>();
    expect(refusal.error.code).toBe("PROPOSAL_CHECK_BLOCKED");
    expect(refusal.error.details.fieldErrors["proposal.abstract"]?.[0]).toContain("sales pitch");
    expect(await proposalCount(eventId)).toBe(0);
  });

  it("returns advice first, then takes the proposal as written and keeps the verdict for reviewers", async () => {
    const { eventId, token, body } = await proposalIdentityFixture();
    const vague = { ...body, proposal: { ...body.proposal, abstract: `Some thoughts. ${body.proposal.abstract}` } };
    const advised = await submit(vague, token);
    expect(advised.status).toBe(422);
    expect((await advised.json<{ error: { code: string } }>()).error.code).toBe("PROPOSAL_CHECK_ADVICE");
    expect(await proposalCount(eventId)).toBe(0);

    const submitted = await submit({ ...vague, adviceAcknowledged: true }, token);
    expect(submitted.status).toBe(200);
    const { proposalId } = await submitted.json<{ proposalId: string }>();
    const review = await readContentCheckResult(env.DB, "proposal", proposalId);
    expect(review).toMatchObject({ outcome: "advised", model: "clef", scorePercent: 100 });
    expect(review?.flags.map((flag) => flag.id)).toEqual(["thin_abstract"]);
    expect(review?.scores.length).toBeGreaterThan(0);
    expect(model.run).toHaveBeenCalledTimes(2);
  });

  it("screens an owner's edit again, refusing only what the check blocks", async () => {
    const { token, body } = await proposalIdentityFixture();
    const submitted = await submit(body, token);
    const { proposalId, manageToken } = await submitted.json<{ proposalId: string; manageToken: string }>();
    const edit = (abstract: string) =>
      callApi(checkedEnv, `/api/v1/proposals/access/${encodeURIComponent(manageToken)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ abstract }),
      });

    const blocked = await edit(`${body.proposal.abstract} Buy our gateway today.`);
    expect(blocked.status).toBe(422);
    expect((await blocked.json<any>()).error.details.fieldErrors.abstract?.[0]).toContain("sales pitch");
    expect((await readContentCheckResult(env.DB, "proposal", proposalId))?.outcome).toBe("passed");

    const vague = await edit(`Some thoughts. ${body.proposal.abstract}`);
    expect(vague.status, await vague.clone().text()).toBe(200);
    expect((await readContentCheckResult(env.DB, "proposal", proposalId))?.outcome).toBe("advised");
  });

  it("drops the verdict of old words when an edit is not screened, and keeps it for private notes", async () => {
    const { token, body } = await proposalIdentityFixture();
    const submitted = await submit(body, token);
    const { proposalId, manageToken } = await submitted.json<{ proposalId: string; manageToken: string }>();
    expect(await readContentCheckResult(env.DB, "proposal", proposalId)).not.toBeNull();
    const edit = (change: Record<string, string>) =>
      callApi(checkedEnv, `/api/v1/proposals/access/${encodeURIComponent(manageToken)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(change),
      });

    await saveCheckSettings("proposal", [], { enabled: false });
    expect((await edit({ committeeNotes: "Please schedule us early." })).status).toBe(200);
    expect(await readContentCheckResult(env.DB, "proposal", proposalId)).not.toBeNull();

    expect((await edit({ title: "A new title for the talk" })).status).toBe(200);
    expect(await readContentCheckResult(env.DB, "proposal", proposalId)).toBeNull();
  });

  it("submits unchecked when the model fails", async () => {
    model.run.mockRejectedValueOnce(new Error("model unavailable"));
    const { token, body } = await proposalIdentityFixture();
    const response = await submit(body, token);
    expect(response.status).toBe(200);
    const { proposalId } = await response.json<{ proposalId: string }>();
    expect(await readContentCheckResult(env.DB, "proposal", proposalId)).toMatchObject({ outcome: "unchecked" });
  });
});
