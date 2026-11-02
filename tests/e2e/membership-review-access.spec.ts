/** @covers join.1.2.a @covers join.1.3 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";
import {
  openApplicationDetail,
  submitMembershipApplication,
  transitionStageInUi,
  uniqueSuffix,
} from "./helpers/membership";
import {
  membershipWorkflowObjectionCreateSchema,
  membershipWorkflowObjectionResolveSchema,
  membershipWorkflowVersionResponseSchema,
} from "../../assets/shared/schemas/membership-workflows";
import { createMember, jsonResponse } from "./helpers/member-provisioning";

test("applicant opens status emails and staff record an attributed consensus objection by keyboard", async ({
  page,
  browser,
}, testInfo) => {
  const suffix = uniqueSuffix();
  const email = `review-${suffix}@review-${suffix}.test`;
  const adminEmail = e2eAdminEmail("membership-review-access");
  const since = await capturedEmailCount();
  const application = await submitMembershipApplication(page, {
    email,
    name: `Review Applicant ${suffix}`,
    category: "F",
    organizationName: `Review Organization ${suffix}`,
  });
  const original = await waitForCapturedEmail(email, "application", { since });
  const originalUrl = extractEmailUrl(original, "/application-status/");
  await signInToPortal(page, adminEmail);
  await openApplicationDetail(page, email, "submitted");
  const updateSince = await capturedEmailCount();
  await transitionStageInUi(page, "on_hold", {
    onHoldSubtype: "request_information",
    requestDetails: "Please clarify your application.",
    note: "Please clarify eligibility.",
  });
  const update = await waitForCapturedEmail(email, "application", { since: updateSince });
  const updateUrl = extractEmailUrl(update, "/application-status/");
  expect(new URL(updateUrl).searchParams.get("token")).toBeTruthy();

  const anonymous = await browser.newContext();
  const applicant = await anonymous.newPage();
  try {
    for (const url of [updateUrl, originalUrl]) {
      await applicant.goto(url);
      await expect(applicant.locator("[data-status-result]")).toContainText("On hold");
      await expect(applicant.getByLabel("Application ID", { exact: true })).toHaveCount(0);
      await expect(applicant.getByLabel("Token", { exact: true })).toHaveCount(0);
    }
    await applicant.screenshot({ path: testInfo.outputPath("application-status.png"), fullPage: true });
    await applicant.goto(`/application-status/?id=${application.applicationId}`);
    await expect(applicant.locator("[data-link-help]")).toBeVisible();
    await expect(applicant.locator("[data-application-status] input")).toHaveCount(0);
  } finally {
    await anonymous.close();
  }

  // The reviewer is a real individual member, seated on the Executive Council
  // the way any council member is: a Member capacity, then a seat in the
  // council group. The staff account cannot be seated itself, because it
  // already holds a personal identity and so cannot be granted a capacity.
  const reviewer = await createMember(page, { individual: true });
  const designated = await page.evaluate(async (userId) => {
    const named = await fetch(`/api/v1/users/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstName: "Sam", lastName: "Reviewer" }),
    });
    const seated = await fetch(`/api/v1/groups/executive-council/memberships/${userId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capacitySelection: { mode: "all_eligible", confirmed: true } }),
    });
    return { status: named.status, seated: seated.status, seatedBody: await seated.text(), id: userId };
  }, reviewer.userId);
  expect(designated.status).toBe(200);
  expect(designated.seated, designated.seatedBody).toBe(200);
  const version = membershipWorkflowVersionResponseSchema.parse(
    await jsonResponse(page.request, "POST", "/api/v1/membership/workflows/versions", {
      definition: {
        name: `Council review ${suffix}`,
        policyReference: "Synthetic browser review policy",
        steps: [
          {
            id: crypto.randomUUID(),
            kind: "consensus",
            label: "Council response",
            instructions: "Review the organization form and raise objections.",
            audience: { kind: "executive_council" },
            destination: { kind: "external", email: "council@example.test" },
            durationDays: 1,
            objectionHandling: "hold_for_resolution",
          },
        ],
      },
    }),
  );
  const versionId = version.workflow.id;
  await jsonResponse(page.request, "POST", `/api/v1/membership/workflows/versions/${versionId}/publication`, {
    expectedRevision: version.workflow.revision,
    reason: "Adopt a synthetic policy for this browser journey.",
  });
  const migrationPath = `/api/v1/members/applications/${application.applicationId}/workflow/migration`;
  const preview = await jsonResponse(page.request, "GET", `${migrationPath}?versionId=${versionId}`);
  await jsonResponse(page.request, "POST", migrationPath, {
    versionId,
    previewFingerprint: preview.fingerprint,
    reason: "Move this synthetic application to its council review policy.",
    acknowledgeRestart: true,
  });
  await transitionStageInUi(page, "processing");
  await jsonResponse(page.request, "POST", "/api/v1/scheduler/jobs/membership_workflows/runs", {});
  await page.goto(`/portal/#/membership/applications/${application.applicationId}/review`);
  // Staff who are not council members can only record a response for a reviewer, so the form opens on it.
  await expect(page.getByLabel("Record a response received outside the portal")).toHaveCount(0);
  const card = page;
  const picker = card.getByRole("textbox", { name: /^Reviewer/ });
  await picker.fill("no-such-reviewer");
  await expect(card.getByText("No eligible reviewers match", { exact: false })).toBeVisible();
  await picker.fill(reviewer.email);
  const match = card.getByRole("button", { name: /^Sam Reviewer/ });
  await expect(match).toBeVisible();
  await expect(match).toContainText("Sam Reviewer");
  await picker.press("Tab");
  await expect(match).toBeFocused();
  await match.press("Enter");
  await card.getByRole("textbox", { name: /^Objection/ }).fill("Awaiting eligibility evidence.");
  await card
    .getByRole("textbox", { name: /^Reason for recording/ })
    .fill("Received this response from the reviewer outside the portal.");
  const recorded = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/applications/${application.applicationId}/objections`) &&
      response.request().method() === "POST",
  );
  await card.getByRole("button", { name: "Record objection", exact: true }).click();
  const response = await recorded;
  expect(response.status()).toBe(200);
  expect(membershipWorkflowObjectionCreateSchema.parse(response.request().postDataJSON()).onBehalfOfUserId).toBe(
    designated.id,
  );
  await expect(card.getByRole("cell", { name: /Sam Reviewer/ })).toBeVisible();
  await expect(card.getByRole("cell", { name: designated.id, exact: true })).toHaveCount(0);

  // The objections load after the review itself; wait for the server's list rather than for an assertion's default.
  const listed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1/members/applications/${application.applicationId}/objections` &&
      response.request().method() === "GET",
  );
  await page.reload();
  expect((await listed).status()).toBe(200);
  await expect(card.getByRole("cell", { name: /Sam Reviewer/ })).toBeVisible();

  await page.getByRole("row").filter({ hasText: "Awaiting eligibility evidence." }).click();
  await page.getByLabel("Resolution", { exact: true }).selectOption("resolved");
  await page
    .getByLabel("Evidence and reason")
    .fill("Verified the organization's supporting evidence with the reviewer.");
  const resolution = page.waitForResponse(
    (result) => result.url().endsWith("/resolution") && result.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Record resolution", exact: true }).click();
  const resolved = await resolution;
  expect(resolved.status()).toBe(200);
  expect(membershipWorkflowObjectionResolveSchema.parse(resolved.request().postDataJSON()).resolution).toBe("resolved");
  await expect(page.getByRole("cell", { name: "resolved", exact: true })).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("ec-review-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });

  await expect(card.getByRole("cell", { name: /Sam Reviewer/ })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("ec-review-mobile.png"), fullPage: true });
});
