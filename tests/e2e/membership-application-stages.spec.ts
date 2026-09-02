/**
 * The membership review workflow, driven through the portal rather than the
 * API.
 *
 * The existing approval journey provisions an application straight to
 * `ec_review` with three direct PATCH calls and then clicks Approve. That
 * proves onboarding runs, but it never touches the stage-transition control
 * staff actually use, and it never visits `on_hold`, `declined`, or
 * `withdrawn` at all. These journeys walk the workflow through the UI so a
 * broken transition control, a missing on-hold reason, or a stage the backend
 * accepts but the form cannot reach would fail here.
 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";
import { signInToPortal } from "./helpers/portal-auth";
import { capturedEmailCount, waitForCapturedEmail } from "./helpers/sendgrid";
import {
  openApplicationDetail,
  stageBadge,
  submitMembershipApplication,
  transitionCard,
  transitionStageInUi,
  uniqueSuffix,
} from "./helpers/membership";

test("staff walk an application through every review stage in the portal and approve it", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `stages-${suffix}@stages-${suffix}.test`;
  const name = `Stages Applicant ${suffix}`;
  const legacyRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/v1/admin/")) legacyRequests.push(`${request.method()} ${pathname}`);
  });

  await submitMembershipApplication(page, {
    email,
    name,
    category: "F",
    organizationName: `Stages Organization ${suffix}`,
  });

  await signInToPortal(page, e2eAdminEmail("portal-application-stages"));
  await openApplicationDetail(page, email, "pending");
  await expect(stageBadge(page, name).filter({ hasText: "Pending" })).toBeVisible();

  // The workflow is not a straight line: an application can be parked while
  // information is missing and then resumed. Walking through `on_hold` and
  // back proves the return transition exists, which a one-way path would not.
  await transitionStageInUi(page, "in_review", { note: "Initial completeness check." });
  await expect(stageBadge(page, name).filter({ hasText: "In Review" })).toBeVisible();

  await transitionStageInUi(page, "on_hold", {
    onHoldSubtype: "request_information",
    note: "Awaiting a signed policy.",
  });
  await expect(stageBadge(page, name).filter({ hasText: "On Hold" })).toBeVisible();

  await transitionStageInUi(page, "in_review", { note: "Applicant responded." });
  await expect(stageBadge(page, name).filter({ hasText: "In Review" })).toBeVisible();

  await transitionStageInUi(page, "in_consultation", { note: "Consulting the working groups." });
  await expect(stageBadge(page, name).filter({ hasText: "In Consultation" })).toBeVisible();

  await transitionStageInUi(page, "ec_review");
  await expect(stageBadge(page, name).filter({ hasText: "Ec Review" })).toBeVisible();

  const sinceApproval = await capturedEmailCount();
  await page.getByRole("button", { name: "Approve & run onboarding" }).click();
  await acceptConfirmDialog(page, "Approve & run onboarding");
  await expect(page.locator(".my-toast", { hasText: "Application approved" })).toBeVisible({ timeout: 20_000 });
  await expect(stageBadge(page, name).filter({ hasText: "Approved" })).toBeVisible();

  // Approval is only real if the applicant hears about it: the welcome mail
  // is queued by the approval service and delivered by the background outbox
  // run the route kicks off, so receiving it exercises that whole chain.
  await waitForCapturedEmail(email, "Welcome to the PKI Consortium", {
    since: sinceApproval,
    timeoutMs: 25_000,
  });

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
  await openApplicationDetail(page, email, "pending");

  await transitionStageInUi(page, "in_review");
  await transitionStageInUi(page, "declined", { note: "Does not meet the category criteria." });
  await expect(stageBadge(page, name).filter({ hasText: "Declined" })).toBeVisible();

  await expect(transitionCard(page).getByText("No further transitions from this stage.")).toBeVisible();
  // Approval must be unreachable from a terminal decline, not merely
  // discouraged: the control belongs to `ec_review` alone.
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
  await openApplicationDetail(page, email, "pending");

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

  // The communication is a real email, not just a timeline row.
  //
  // Known product bug (reported, not fixed — outside this task's edit scope:
  // it lives in functions/_lib/services/membership/applications/communications.ts,
  // not a frontend surface this task may touch): sendApplicationCommunication
  // defaults `templateKey` to "application-hold-information" whenever the
  // caller omits one, and the frontend form never sends one. The queued
  // email is rendered from that on-hold-request template, whose own canned
  // subject ("We need more information about your PKI Consortium
  // application") silently replaces the free-text `subject` typed here — the
  // outgoing email's subject line does not match what staff typed or what
  // the timeline row shows. This asserts the delivery that does happen
  // (message reaches the applicant) without asserting the subject line,
  // since that part is the confirmed-broken behavior.
  await waitForCapturedEmail(email, "PKI Consortium", { since, timeoutMs: 20_000 });

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
});
