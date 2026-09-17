/**
 * @covers join.1.2
 * @covers join.1.2.a
 * @covers join.1.5
 */
import { prepareSyntheticMembershipReview } from "./helpers/member-provisioning";
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { tab } from "./helpers/tabs";
import { capturedEmailCount, waitForCapturedEmail } from "./helpers/sendgrid";
import {
  openApplicationDetail,
  stageBadge,
  submitMembershipApplication,
  transitionCard,
  transitionStageInUi,
  uniqueSuffix,
} from "./helpers/membership";

test("staff hold and resume an application, then complete its required review", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `stages-${suffix}@stages-${suffix}.test`;
  const name = `Stages Applicant ${suffix}`;
  const legacyRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/v1/admin/")) legacyRequests.push(`${request.method()} ${pathname}`);
  });

  const application = await submitMembershipApplication(page, {
    email,
    name,
    category: "F",
    organizationName: `Stages Organization ${suffix}`,
  });

  await signInToPortal(page, e2eAdminEmail("portal-application-stages"));
  await openApplicationDetail(page, email, "submitted");
  // The record's body is the shared record grid: the application and its
  // answers take the width, the stage controls stand beside them (#109).
  const panes = page.locator(".pk-record").first();
  await expect(panes).toBeVisible();
  const sizing = await panes.evaluate((element) => {
    const columns = [...element.children].map((child) => child.getBoundingClientRect());
    const parent = element.getBoundingClientRect();
    return {
      parentWidth: parent.width,
      widths: columns.map((column) => column.width),
      right: Math.max(...columns.map((column) => column.right)),
      parentRight: parent.right,
    };
  });
  expect(sizing.right).toBeCloseTo(sizing.parentRight, 0);
  // The application keeps a reading measure; the stage controls keep their
  // own minimum beside it rather than being squeezed into a strip.
  expect(sizing.widths[0]).toBeGreaterThanOrEqual(Math.min(560, sizing.parentWidth));
  expect(sizing.widths[1]).toBeGreaterThanOrEqual(Math.min(288, sizing.parentWidth));
  await page.screenshot({ path: test.info().outputPath("pkic-application-layout.png") });
  await expect(stageBadge(page, name).filter({ hasText: "Submitted" })).toBeVisible();

  // The workflow is not a straight line: an application can be parked while
  // information is missing and then resumed. Walking through `on_hold` and
  // back proves the return transition exists, which a one-way path would not.
  await transitionStageInUi(page, "on_hold", {
    onHoldSubtype: "request_information",
    note: "Awaiting a signed policy.",
  });
  await expect(stageBadge(page, name).filter({ hasText: "On Hold" })).toBeVisible();

  await transitionStageInUi(page, "processing", { note: "Applicant responded." });
  await expect(stageBadge(page, name).filter({ hasText: "Processing" })).toBeVisible();
  await prepareSyntheticMembershipReview(page.request, application.applicationId);
  const sinceApproval = await capturedEmailCount();
  await page.goto(`/portal/#/membership/applications/${application.applicationId}/review`);
  await page.getByLabel("Review decision and reason").fill("Verified the signed policy and the user's authority.");
  await page.getByRole("button", { name: "Complete review", exact: true }).click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();

  // Approval is only real if the applicant hears about it: the welcome mail
  // is queued by the approval service and delivered by the background outbox
  // run the route kicks off, so receiving it exercises that whole chain.
  await waitForCapturedEmail(email, "Welcome to the PKI Consortium", {
    since: sinceApproval,
    timeoutMs: 25_000,
  });

  await page.goto(`/portal/#/membership/applications/${application.applicationId}`);
  // Approved is terminal: the form must offer no way onward.
  await expect(transitionCard(page).getByText("No further transitions from this stage.")).toBeVisible();
  expect(legacyRequests, "the portal must not call retired admin APIs").toEqual([]);
});

test("a declined application is terminal and never reaches onboarding", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `declined-${suffix}@declined-${suffix}.test`;
  const name = `Declined Applicant ${suffix}`;
  await submitMembershipApplication(page, {
    email,
    name,
    category: "F",
    organizationName: `Declined Organization ${suffix}`,
  });

  await signInToPortal(page, e2eAdminEmail("portal-application-stages"));
  await openApplicationDetail(page, email, "submitted");

  await transitionStageInUi(page, "declined", { note: "Does not meet the category criteria." });
  await expect(stageBadge(page, name).filter({ hasText: "Declined" })).toBeVisible();

  await expect(transitionCard(page).getByText("No further transitions from this stage.")).toBeVisible();
  // A terminal decline cannot complete another review.
  await expect(page.getByRole("button", { name: "Approve & run onboarding" })).toHaveCount(0);
});

test("staff email the applicant and record an internal note through the Communications card", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `comms-${suffix}@comms-${suffix}.test`;
  const name = `Communications Applicant ${suffix}`;
  await submitMembershipApplication(page, {
    email,
    name,
    category: "F",
    organizationName: `Communications Organization ${suffix}`,
  });

  await signInToPortal(page, e2eAdminEmail("portal-application-stages"));
  await openApplicationDetail(page, email, "submitted");

  // Correspondence is a facet of the record, reached by its tab (#109).
  await tab(page, "Communications").click();
  const card = page.getByRole("region", { name: "Communications and notes" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Nothing has been emailed or noted on this application yet.")).toBeVisible();

  // Subject and Message are native `required` fields, so an empty send never
  // reaches the network at all — the browser refuses the submission itself,
  // before this component's own `commAttempted` messaging logic runs.
  const communicationsRequests: string[] = [];
  const notesRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() !== "POST") return;
    if (/\/api\/v1\/members\/applications\/[^/]+\/communications$/.test(pathname)) {
      communicationsRequests.push(pathname);
    }
    if (/\/api\/v1\/members\/applications\/[^/]+\/notes$/.test(pathname)) {
      notesRequests.push(pathname);
    }
  });
  await card.getByRole("button", { name: "Send" }).click();
  await expect(card.getByText("Nothing has been emailed or noted on this application yet.")).toBeVisible();
  expect(communicationsRequests).toEqual([]);

  const subject = `Following up, ${suffix}`;
  const message = "We need one more document before we can continue the review.";
  await card.getByLabel("Subject").fill(subject);
  await card.getByLabel("Message").fill(message);

  const since = await capturedEmailCount();
  const sendResponse = page.waitForResponse(
    (response) =>
      /\/api\/v1\/members\/applications\/[^/]+\/communications$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "POST",
  );
  await card.getByRole("button", { name: "Send" }).click();
  expect((await sendResponse).status()).toBe(201);
  await expect(card.getByRole("cell", { name: "Emailed" })).toBeVisible();
  await expect(card.getByText(subject, { exact: true })).toBeVisible();

  // The communication is a real email, not just a timeline row — and it is the
  // email staff wrote. This form chooses no template, and under
  // applicationCommunicationCreateSchema that means the typed subject and body
  // are delivered verbatim, so the subject line the applicant receives is the
  // one the timeline row above shows.
  const delivered = await waitForCapturedEmail(email, subject, { since, timeoutMs: 20_000 });
  expect(delivered.subject).toBe(subject);

  // The note form is a distinct control with its own native `required` guard,
  // and it never emails anyone.
  const noteBody = `Internal-only reminder ${suffix}.`;
  await card.getByRole("button", { name: "Add note" }).click();
  expect(notesRequests).toEqual([]);
  await card.getByLabel("Internal note").fill(noteBody);

  const notesSince = await capturedEmailCount();
  const noteResponse = page.waitForResponse(
    (response) =>
      /\/api\/v1\/members\/applications\/[^/]+\/notes$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "POST",
  );
  await card.getByRole("button", { name: "Add note" }).click();
  expect((await noteResponse).status()).toBe(201);
  await expect(card.getByRole("cell", { name: "Internal note" })).toBeVisible();
  await expect(card.getByText(noteBody, { exact: true })).toBeVisible();
  expect(await capturedEmailCount()).toBe(notesSince);
  await expect
    .poll(() => card.locator(".pk-table__scroll").evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1504, height: 1044 });
  // The correspondence is its own facet and takes the record's full width:
  // one panel, no columns beside it.
  const cardBox = await card.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const parent = element.parentElement!.getBoundingClientRect();
    return { width: rect.width, parentWidth: parent.width };
  });
  expect(cardBox.width).toBeCloseTo(cardBox.parentWidth, 0);
  expect(
    await card.locator(".pk-table__scroll").evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
  await card.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: test.info().outputPath("pkic-application-populated.png") });
});
