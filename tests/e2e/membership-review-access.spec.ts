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
import { jsonResponse } from "./helpers/member-provisioning";

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

  // The synthetic local staff record is seated on the Executive Council the
  // way any council member is: an individual capacity, then a seat in the
  // council group. There is no EC checkbox on the account any more (#104).
  const designated = await page.evaluate(async (email) => {
    const post = (path: string, body: unknown) =>
      fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const users = (await (await fetch(`/api/v1/users?q=${encodeURIComponent(email)}`)).json()) as {
      users: Array<{ id: string; email: string }>;
    };
    const user = users.users.find((user) => user.email === email)!;
    const named = await fetch(`/api/v1/users/${user.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstName: "Sam", lastName: "Reviewer" }),
    });
    const capacity = await post("/api/v1/members/capacities", {
      userId: user.id,
      membershipCategory: "H5",
      activationReason: "Seated on the Executive Council for the review-access journey.",
    });
    const seated = await post(`/api/v1/groups/executive-council/memberships/${user.id}`, {
      capacitySelection: { mode: "all_eligible", confirmed: true },
    });
    return { status: named.status, capacity: capacity.status, seated: seated.status, id: user.id };
  }, adminEmail);
  expect(designated.status).toBe(200);
  expect([200, 201, 409]).toContain(designated.capacity);
  expect(designated.seated).toBe(200);
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
  await page.getByLabel("Record a response received outside the portal").check();
  const card = page;
  const picker = card.getByRole("textbox", { name: /^Reviewer/ });
  await picker.fill("no-such-reviewer");
  await expect(card.getByText("No eligible reviewers match", { exact: false })).toBeVisible();
  await picker.fill(adminEmail);
  const match = card.getByRole("button", { name: new RegExp(adminEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
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

  await page.reload();
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
