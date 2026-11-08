import { expect, test } from "@playwright/test";
import { EMAIL_FIRST_COPY, PROOF_SUPPORT_COPY } from "../../assets/shared/email-first-copy";
import {
  eventProposalProofStartSchema,
  eventProposalProofVerifyResponseSchema,
} from "../../assets/shared/schemas/event-proposal-proof";
import { PROPOSAL_EVENT_SLUG } from "./helpers/proposals";
import { acceptVisibleTerms } from "./helpers/proposal-entry-ui";

test("an organization review lets the proposer enter a new personal email", async ({ page }, info) => {
  const proofPath = `/api/v1/events/${PROPOSAL_EVENT_SLUG}/proposals/proof`;
  const workEmail = "casey@research.example.test";
  await page.route(`**${proofPath}/verify`, (route) =>
    route.fulfill({
      json: eventProposalProofVerifyResponseSchema.parse({
        status: "support_required",
        email: workEmail,
        applicantKind: "organization",
        reason: "organization_domain_review",
      }),
    }),
  );
  await page.goto(`/events/2026/${PROPOSAL_EVENT_SLUG}/propose/`);
  await acceptVisibleTerms(page, "[data-consents]");
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
  await page.evaluate(() => {
    location.hash = `verify=${"v".repeat(40)}`;
  });
  const identity = page.locator("[data-proposer-identity]");
  await expect(identity.getByRole("textbox")).toHaveValue(workEmail);
  await identity.getByRole("button", { name: PROOF_SUPPORT_COPY.personalAction, exact: true }).click();
  await expect(
    identity.getByRole("radio", { name: EMAIL_FIRST_COPY.proposal.personal.title, exact: true }),
  ).toBeChecked();
  const email = identity.getByLabel(EMAIL_FIRST_COPY.proposal.personal.label, { exact: true });
  await expect(email).toHaveValue("");
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await email.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`personal-email-${width}.png`), fullPage: true });
  }
  const personalEmail = "casey.personal@gmail.com";
  await email.fill(personalEmail);
  const sent = page.waitForResponse((response) => new URL(response.url()).pathname === proofPath);
  await identity.getByRole("button", { name: EMAIL_FIRST_COPY.proposal.personal.action, exact: true }).click();
  const response = await sent;
  expect(response.status(), await response.text()).toBe(200);
  expect(eventProposalProofStartSchema.parse(response.request().postDataJSON())).toMatchObject({
    email: personalEmail,
    unaffiliatedAttestation: true,
  });
  await expect(identity.getByText(EMAIL_FIRST_COPY.proposal.sent(personalEmail), { exact: true })).toBeVisible();
});
