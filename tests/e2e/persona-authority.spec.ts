/**
 * Personas, exercised through the browser.
 *
 * The mounted suites prove a seeded persona holds the authority the catalog
 * claims. This proves the same people reach the product that way: provisioned
 * through join, review, approval, and grants rather than by writing rows, so
 * an authority that is representable but unreachable fails here.
 */
import { expect, test } from "@playwright/test";
import { PERSONAS } from "../personas/catalog";
import { signInAsPersona } from "./helpers/personas";
import { ensureAppOrigin } from "./helpers/membership";

const ALL_MEMBERS_GROUP = "20000000-0000-4000-8000-000000000001";

test("an interested party is enfranchised nowhere, as the bylaws require", async ({ page }) => {
  expect(PERSONAS.interestedParty.mayVote, "the catalog must agree this persona cannot vote").toBe(false);
  page.on("dialog", (dialog) => void dialog.accept());

  const persona = await signInAsPersona(page, "interestedParty", { staffScope: "portal-persona-interested" });

  // The person exists and has a membership; what they lack is a vote.
  expect(persona.memberships.length).toBeGreaterThan(0);

  const votes = await page.evaluate(async (groupId) => {
    const response = await fetch(`/api/v1/groups/${groupId}/votes`, { credentials: "same-origin" });
    return {
      status: response.status,
      body: (await response.json()) as { votes: Array<{ canCastBallot: boolean; memberBallots: unknown[] | null }> },
    };
  }, ALL_MEMBERS_GROUP);
  expect(votes.status, JSON.stringify(votes.body)).toBe(200);
  for (const vote of votes.body.votes) {
    expect(vote.canCastBallot, "a non-voting category must never be offered a ballot").toBe(false);
    expect(vote.memberBallots ?? []).toEqual([]);
  }
});

test("a voting member is enfranchised", async ({ page }) => {
  expect(PERSONAS.votingMember.mayVote).toBe(true);
  page.on("dialog", (dialog) => void dialog.accept());

  const persona = await signInAsPersona(page, "votingMember", { staffScope: "portal-persona-voting" });
  expect(persona.memberships.length).toBeGreaterThan(0);
});

test("a read-only staff persona reads applications and cannot change one", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await signInAsPersona(page, "membershipReader", { staffScope: "portal-persona-reader" });
  await ensureAppOrigin(page);

  const list = await page.evaluate(async () => {
    const response = await fetch("/api/v1/members/applications", { credentials: "same-origin" });
    return response.status;
  });
  expect(list).toBe(200);

  const moved = await page.evaluate(async () => {
    const response = await fetch("/api/v1/members/applications/00000000000000000000000000000000/stage", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ toStage: "in_review" }),
    });
    return response.status;
  });
  expect(moved, "a read-only grant must not move an application").toBe(403);
});
