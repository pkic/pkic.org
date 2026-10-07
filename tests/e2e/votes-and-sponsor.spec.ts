/**
 * Public votes are generated through the actual local publication pipeline.
 * The open vote is created through mounted APIs; closed results are explicitly
 * synthetic canonical publication fixtures, preserving all other public data.
 * Stripe checkout is mocked because local development has no Stripe account.
 * @covers vote.5.11
 */
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { publishE2eSite } from "./helpers/site-publication";
import { sitePublicationSnapshotSchema } from "../../assets/shared/schemas/site-publication";
import { publicVoteGetResponseSchema } from "../../assets/shared/schemas/votes";
import {
  sponsorshipCheckoutSchema,
  sponsorshipCheckoutResponseSchema,
  type SponsorshipCheckoutInput,
} from "../../assets/shared/schemas/sponsorship";
import { signInAsE2eStaff } from "./helpers/staff-auth";

async function signInAsAdmin(page: Page): Promise<void> {
  await signInAsE2eStaff(page, e2eAdminEmail("votes"));
}

test.describe("public votes pages", () => {
  test("publishes a real open public vote and synthetic closed motion/election results", async ({ page }) => {
    test.setTimeout(300_000); // Two actual local static publication builds.
    // Expected 4xx noise: an unauthenticated session probe (401) and the
    // deliberate not-found lookup below (404) — same ignore convention as
    // browser-rendering.spec.ts's monitorErrors.
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const t = msg.text();
        if (
          !/\[vite\]|\[HMR\]|favicon|net::ERR_ABORTED/.test(t) &&
          !/Failed to load resource: the server responded with a status of 4/.test(t)
        ) {
          consoleErrors.push(t);
        }
      }
    });

    await signInAsAdmin(page);

    const title = `E2E Public Motion Vote ${Date.now()}`;
    const closesAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const created = await page.evaluate(
      async ({ title, closesAt }) => {
        const res = await fetch("/api/v1/groups/20000000-0000-4000-8000-000000000001/votes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            title,
            description: "An end-to-end test motion vote.",
            voteType: "motion",
            electorateMode: "per_member",
            thresholdType: "simple_majority",
            closesAt,
          }),
        });
        const body = (await res.json()) as { vote?: { id: string; slug: string } };
        return { status: res.status, vote: body.vote };
      },
      { title, closesAt },
    );
    expect(created.status).toBe(200);
    const slug = created.vote!.slug;

    const visibilityStatus = await page.evaluate(async (voteId) => {
      const res = await fetch(`/api/v1/groups/20000000-0000-4000-8000-000000000001/votes/${voteId}/visibility`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ visibility: "public", publicDetailLevel: "aggregate" }),
      });
      return res.status;
    }, created.vote!.id);
    expect(visibilityStatus).toBe(200);

    // ── Index page shows the real open vote ─────────────────────────────
    const publicResponse = await page.request.get(`/api/v1/votes/${slug}`);
    expect(publicResponse.status()).toBe(200);
    const publicVote = publicVoteGetResponseSchema.parse(await publicResponse.json()).vote;
    expect(publicVote.title).toBe(title);
    expect(publicVote.status).toBe("open");
    const nativePublication = await publishE2eSite(page, `/votes/${slug}/`);
    await page.goto("/votes/");
    await expect(page.locator(".member-card").filter({ hasText: title })).toContainText("Open");
    await expect(page.getByText(title)).toBeVisible();

    // ── Detail page (real backend) — not yet closed, no result shown ─────
    // The card is clickable via the design system's `pk-stretched` utility
    // (an <a> whose ::after pseudo-element covers the card) — Playwright's own
    // actionability check sees the <a> itself as zero-size, so click the
    // card container instead, mirroring how a real click lands on it.
    await page.locator(".member-card").filter({ hasText: title }).click();
    await expect(page).toHaveURL(new RegExp(`/votes/${slug}/$`));
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText(/Results will be published here once voting closes/i)).toBeVisible();

    // An unknown public vote remains refused by the real backend and static route.
    expect((await page.request.get("/api/v1/votes/does-not-exist-e2e")).status()).toBe(404);
    expect((await page.request.get("/votes/does-not-exist-e2e/")).status()).toBe(404);

    // Synthetic closed results are publication source fixtures, never visitor API responses.
    const motion = publicVoteGetResponseSchema.parse({
      vote: {
        id: "00000000-0000-4000-8000-000000000001",
        slug: "synthetic-closed-motion",
        title: "Synthetic Closed Motion",
        description: "A synthetic, already-closed motion vote.",
        voteType: "motion",
        ownerGroupId: "20000000-0000-4000-8000-000000000001",
        ownerGroupName: "All Members",
        electorateMode: "per_member",
        thresholdType: "simple_majority",
        eligibleCategories: null,
        opensAt: new Date(Date.now() - 172_800_000).toISOString(),
        closesAt: new Date(Date.now() - 86_400_000).toISOString(),
        currentRound: 0,
        status: "closed",
        visibility: "public",
        publicDetailLevel: "full_breakdown",
        createdAt: new Date(Date.now() - 259_200_000).toISOString(),
        updatedAt: new Date(Date.now() - 86_400_000).toISOString(),
        candidates: null,
        result: {
          thresholdType: "simple_majority",
          counts: { in_favor: 23, opposed: 4, abstain: 2 },
          totalBallots: 29,
          outcome: "passed",
        },
      },
    }).vote;
    const election = publicVoteGetResponseSchema.parse({
      vote: {
        id: "00000000-0000-4000-8000-000000000002",
        slug: "synthetic-closed-election",
        title: "Synthetic WG Chair Election",
        description: "A synthetic, already-closed election vote.",
        voteType: "election",
        ownerGroupId: "20000000-0000-4000-8000-000000000003",
        ownerGroupName: "Post-Quantum Cryptography Working Group",
        electorateMode: "per_person",
        thresholdType: "successive_elimination",
        eligibleCategories: null,
        opensAt: new Date(Date.now() - 172_800_000).toISOString(),
        closesAt: new Date(Date.now() - 86_400_000).toISOString(),
        currentRound: 1,
        status: "closed",
        visibility: "public",
        publicDetailLevel: "full_breakdown",
        createdAt: new Date(Date.now() - 259_200_000).toISOString(),
        updatedAt: new Date(Date.now() - 86_400_000).toISOString(),
        candidates: [
          {
            id: "00000000-0000-4000-8000-000000000004",
            userId: null,
            candidateName: "Alice Candidate",
            candidateBio: null,
            sortOrder: 0,
            eliminatedRound: null,
          },
          {
            id: "00000000-0000-4000-8000-000000000005",
            userId: null,
            candidateName: "Bob Candidate",
            candidateBio: null,
            sortOrder: 1,
            eliminatedRound: 1,
          },
        ],
        result: {
          rounds: [
            {
              round: 1,
              counts: {
                "00000000-0000-4000-8000-000000000004": 12,
                "00000000-0000-4000-8000-000000000005": 8,
              },
              eliminatedCandidateIds: ["00000000-0000-4000-8000-000000000005"],
              winnerCandidateId: null,
            },
          ],
          winnerCandidateId: "00000000-0000-4000-8000-000000000004",
        },
      },
    }).vote;
    await publishE2eSite(
      page,
      `/votes/${motion.slug}/`,
      sitePublicationSnapshotSchema.parse({
        ...nativePublication.snapshot,
        snapshotId: createHash("sha256")
          .update(JSON.stringify([nativePublication.snapshot.snapshotId, motion, election]))
          .digest("hex"),
        votes: [...nativePublication.snapshot.votes, motion, election],
      }),
    );
    await page.goto(`/votes/${motion.slug}/`);
    await expect(page.getByText("Passed", { exact: true })).toBeVisible();
    await expect(page.getByText(/23 in favor.*4 opposed.*2 abstained.*29 ballots cast/)).toBeVisible();
    await page.goto(`/votes/${election.slug}/`);
    await expect(page.getByText("Elected", { exact: true })).toBeVisible();
    await expect(page.getByText("Alice Candidate").first()).toBeVisible();
    await expect(page.getByText(/Bob Candidate: 8/)).toBeVisible();
    await expect(page.getByText(/\(eliminated\)/)).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });
});

test.describe("event sponsorship inquiry", () => {
  test("links the event sponsor page to the public inquiry form", async ({ page }) => {
    await page.goto("/events/2026/pqc-conference-amsterdam-nl/sponsors/");
    await page.getByRole("link", { name: "Discuss sponsorship opportunities" }).click();
    await expect(page).toHaveURL(/\/sponsors\/sponsor\/$/);
    await expect(page.getByRole("heading", { name: /sponsor/i }).first()).toBeVisible();
  });
});

test.describe("event sponsor self-service checkout", () => {
  test("submits the Sponsor Now form and follows the returned checkout redirect", async ({ page }) => {
    let capturedBody: SponsorshipCheckoutInput | null = null;
    await page.route("**/api/v1/sponsors/checkouts", async (route) => {
      capturedBody = sponsorshipCheckoutSchema.parse(route.request().postDataJSON());
      const checkoutUrl = new URL(
        "/events/2026/pqc-conference-amsterdam-nl/sponsors/complete/?session_id=cs_test_mocked",
        route.request().url(),
      ).toString();
      await route.fulfill({ status: 200, json: sponsorshipCheckoutResponseSchema.parse({ url: checkoutUrl }) });
    });

    await page.goto("/events/2026/pqc-conference-amsterdam-nl/sponsors/");
    await expect(page.getByRole("heading", { name: "Sponsor Now" })).toBeVisible();
    const tier = page.getByRole("combobox", { name: "Sponsorship tier (required)", exact: true });
    await expect(tier).toBeEnabled();
    await tier.selectOption({ label: "Innovator" });
    await page.getByRole("textbox", { name: "First Name (required)", exact: true }).fill("Casey");
    await page.getByRole("textbox", { name: "Last Name (required)", exact: true }).fill("Sponsor");
    await page.getByRole("textbox", { name: "Email (required)", exact: true }).fill("casey-sponsor@example.test");
    await page.getByRole("textbox", { name: "Organization Name", exact: true }).fill("Example Sponsor Org");
    await page.getByRole("button", { name: /Sponsor Now/i }).click();

    await expect(page).toHaveURL(/sponsors\/complete\/\?session_id=cs_test_mocked/);
    await expect(page.getByRole("heading", { name: /Thank you for sponsoring/i })).toBeVisible();
    expect(capturedBody).toMatchObject({
      checkoutAttemptId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      contactName: "Casey Sponsor",
      contactEmail: "casey-sponsor@example.test",
      organizationName: "Example Sponsor Org",
      tier: "Innovator",
      eventId: "pqc-conference-amsterdam-nl",
    });
    expect(capturedBody!.successPath).toMatch(/\/sponsors\/complete\/$/);
    expect(capturedBody!.cancelPath).toMatch(/\/sponsors\/$/);
  });
});
