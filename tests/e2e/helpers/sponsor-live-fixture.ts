import { randomUUID } from "node:crypto";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { e2eAdminEmail } from "../../helpers/e2e-admin";
import { signInAsE2eStaff } from "./staff-auth";
import { createMember } from "./member-provisioning";
import { registerInBrowser } from "./registration";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./sendgrid";
import { eventDetailResponseSchema } from "../../../assets/shared/schemas/event-management";
import { eventTermsResponseSchema } from "../../../assets/shared/schemas/forms";
import {
  registrationCreateSchema,
  registrationSubmissionResponseSchema,
  registrationManageSchema,
  registrationManageUpdateResponseSchema,
} from "../../../assets/shared/schemas/registration";
import {
  sponsorshipCreateSchema,
  sponsorshipResponseSchema,
  sponsorshipStageUpdateSchema,
  eventSponsorTiersReplaceSchema,
  eventSponsorTiersResponseSchema,
} from "../../../assets/shared/schemas/sponsorship-management";
import {
  accessGrantCreateSchema,
  accessGrantCreateResponseSchema,
} from "../../../assets/shared/schemas/access-control";
import {
  badgeAttendeesResponseSchema,
  badgeIssueRequestSchema,
  badgeIssueResponseSchema,
} from "../../../assets/shared/schemas/route-contracts-event-badges";
import {
  enrolledEventScanRequestSchema,
  eventScanResponseSchema,
} from "../../../assets/shared/schemas/event-participation-scanning";
import { scannerStorage, scrollScannerToTop } from "./scanner-recovery-storage";

export const sponsorEventSlug = "pqc-conference-amsterdam-nl";
const eventApi = `/api/v1/events/${sponsorEventSlug}`;

async function confirmRegistration(page: Page, email: string, since: number) {
  const mail = await waitForCapturedEmail(email, "Confirm your registration", { since });
  await page.goto(extractEmailUrl(mail, "/register/confirm"));
  await page.getByRole("button", { name: /Confirm my registration/i }).click();
  await waitForCapturedEmail(email, "registration is confirmed", { since });
}

async function issueBadge(staff: Page, email: string) {
  const response = await staff.request.get(
    `${eventApi}/badges/attendees?q=${encodeURIComponent(email)}&sort=email&limit=10&offset=0`,
  );
  expect(response.status()).toBe(200);
  const user = badgeAttendeesResponseSchema.parse(await response.json()).users.find((item) => item.email === email);
  if (!user) throw new Error("Confirmed synthetic registration was not available for badge issuance");
  const issued = await staff.request.post(`${eventApi}/badges`, {
    data: badgeIssueRequestSchema.parse({ operationId: randomUUID(), userId: user.id }),
  });
  expect(issued.status()).toBe(200);
  const badge = badgeIssueResponseSchema.parse(await issued.json());
  if (badge.result !== "issued") throw new Error("Fresh badge operation did not return its printable identifier");
  return { userId: user.id, badgeId: badge.credential };
}

/** Each authority and registration is established through the mounted APIs and real mailbox flow. */
export async function prepareSponsorLiveFixture(staff: Page, attendee: Page) {
  const stamp = randomUUID();
  const deniedEmail = `lead-denied-${stamp}@example.test`;
  const deniedSince = await capturedEmailCount();
  const template = await registerInBrowser(attendee, deniedEmail);
  await confirmRegistration(attendee, deniedEmail, deniedSince);
  const termsResponse = await attendee.request.get(`${eventApi}/terms?audience=attendee`);
  expect(termsResponse.status()).toBe(200);
  const terms = eventTermsResponseSchema.parse(await termsResponse.json()).terms;
  expect(terms.some((term) => term.termKey === "sponsor-data-sharing")).toBe(true);
  const email = `lead-contact-${stamp}@example.test`;
  const firstName = `Contact-${stamp.slice(0, 8)}`;
  const lastName = "SponsorFixture";
  const organization = `Lead organization ${stamp}`;
  const since = await capturedEmailCount();
  const registration = await attendee.request.post(`${eventApi}/registrations`, {
    data: registrationCreateSchema.parse({
      ...template.request,
      email,
      firstName,
      lastName,
      organizationName: organization,
      customAnswers: { ...template.request.customAnswers, organization_name: organization },
      consents: terms
        .filter((term) => term.required || term.termKey === "sponsor-data-sharing")
        .map(({ termKey, version }) => ({ termKey, version })),
    }),
  });
  expect(registration.status()).toBe(200);
  const registered = registrationSubmissionResponseSchema.parse(await registration.json());
  if (!registered.manageUrl || !registered.manageToken)
    throw new Error("Fresh attendee must have a registration management capability");
  await confirmRegistration(attendee, email, since);

  await signInAsE2eStaff(staff, e2eAdminEmail("default"));
  const eventResponse = await staff.request.get(eventApi);
  expect(eventResponse.status()).toBe(200);
  const event = eventDetailResponseSchema.parse(await eventResponse.json()).event;
  if (!("ownerGroupId" in event) || !event.ownerGroupId) throw new Error("Seeded event must have a group workspace");
  const tiers = await staff.request.put(`${eventApi}/sponsors/tiers`, {
    data: eventSponsorTiersReplaceSchema.parse({ tiers: [{ tierName: "Leader", hasAttendeeDataAccess: true }] }),
  });
  expect(tiers.status()).toBe(200);
  eventSponsorTiersResponseSchema.parse(await tiers.json());
  const created = await staff.request.post("/api/v1/sponsors", {
    data: sponsorshipCreateSchema.parse({
      sponsorType: "event",
      eventId: event.id,
      tier: "Leader",
      nonMemberName: `Synthetic lead sponsor ${stamp}`,
      contactName: "Sponsor fixture contact",
      contactEmail: `lead-sponsor-${stamp}@example.test`,
      renewalDate: "2027-12-31",
    }),
  });
  expect(created.status()).toBe(201);
  const sponsorId = sponsorshipResponseSchema.parse(await created.json()).sponsorship.id;
  const activated = await staff.request.patch(`/api/v1/sponsors/${sponsorId}/stage`, {
    data: sponsorshipStageUpdateSchema.parse({ toStage: "active" }),
  });
  expect(activated.status()).toBe(200);
  sponsorshipResponseSchema.parse(await activated.json());
  const operator = await createMember(staff, { individual: true });
  const grants: string[] = [];
  for (const permission of ["agenda:leads_capture", "agenda:leads_view", "agenda:leads_export"] as const) {
    const response = await staff.request.post("/api/v1/permissions/grants", {
      data: accessGrantCreateSchema.parse({
        userId: operator.userId,
        permission,
        contextType: "event_sponsor",
        contextId: sponsorId,
      }),
    });
    expect(response.status()).toBe(201);
    grants.push(accessGrantCreateResponseSchema.parse(await response.json()).grant.id);
  }
  const consenting = await issueBadge(staff, email);
  const denied = await issueBadge(staff, deniedEmail);
  if (!template.result.manageToken) throw new Error("Denied fixture needs its own registration capability");
  const canceled = await attendee.request.patch(`/api/v1/registrations/access/${template.result.manageToken}`, {
    data: registrationManageSchema.parse({ action: "cancel" }),
  });
  expect(canceled.status()).toBe(200);
  registrationManageUpdateResponseSchema.parse(await canceled.json());
  return {
    sponsorId,
    operator,
    grants,
    consenting,
    denied,
    email,
    deniedEmail,
    firstName,
    lastName,
    organization,
    manageUrl: registered.manageUrl,
    manageToken: registered.manageToken,
    workspace: `/portal/#/events/${sponsorEventSlug}/leads`,
  };
}

export async function captureSponsorBadge(page: Page, badgeId: string, sponsorId: string, operatorUserId: string) {
  await page.getByLabel("Badge code", { exact: true }).fill(badgeId);
  await page
    .getByRole("checkbox", {
      name: "The attendee agrees to share their contact details with this sponsor.",
      exact: true,
    })
    .check();
  const receiving = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${eventApi}/scans` &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.badgeId === badgeId,
  );
  await page.getByRole("button", { name: "Capture lead", exact: true }).click();
  const response = await receiving;
  expect(response.status()).toBe(200);
  const request = enrolledEventScanRequestSchema.parse(response.request().postDataJSON());
  expect(request).toMatchObject({
    badgeId,
    sponsorId,
    operatorUserId,
    action: "lead",
    consentConfirmed: true,
    occurrenceId: null,
  });
  expect(request.offlineRight).toBeUndefined();
  const receipt = eventScanResponseSchema.parse(await response.json());
  expect(receipt.operationId).toBe(request.operationId);
  expect(receipt.recorded).toBe(true);
  expect(receipt.attendanceRecorded).toBe(false);
  expect(receipt.admissionRecorded ?? false).toBe(false);
  await expect
    .poll(async () => (await scannerStorage(page)).history.some((row) => row.scan.operationId === request.operationId))
    .toBe(true);
  await expect(page.getByLabel("Badge code", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Badge code", { exact: true })).not.toHaveAttribute("aria-invalid", "true");
  return { request, receipt };
}

export async function captureSponsorViews(page: Page, info: TestInfo, checkpoint: string) {
  for (const [name, width, height] of [
    ["desktop", 1280, 900],
    ["phone", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await scrollScannerToTop(page);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const action of await page.locator(".pk-panel__toolbar button:visible, .pk-panel__toolbar a:visible").all()) {
      const bounds = await action.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    if (await page.locator(".pk-event-scanner").count()) {
      await expect(page.getByLabel("Check-in location", { exact: true })).toHaveCount(0);
      await expect(page.locator(".pk-event-scanner")).not.toContainText("Missing required permission");
    }
    await page.screenshot({
      fullPage: true,
      animations: "disabled",
      path: info.outputPath(`sponsor-${checkpoint}-${name}.png`),
    });
  }
}

/** Inspect existing browser storage read-only; canonical badge UUIDs are permitted scan identifiers. */
export async function expectNoStoredSponsorContacts(page: Page, forbidden: readonly string[]) {
  const violations = await page.evaluate(
    async (forbiddenValues) => {
      const values: unknown[] = [Object.entries(localStorage), Object.entries(sessionStorage)];
      for (const { name } of await indexedDB.databases()) {
        if (!name) continue;
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const opening = indexedDB.open(name);
          opening.onsuccess = () => resolve(opening.result);
          opening.onerror = () => reject(new Error(opening.error?.message ?? "Could not open browser storage"));
        });
        try {
          const stores = Array.from(db.objectStoreNames);
          if (!stores.length) continue;
          const tx = db.transaction(stores, "readonly");
          values.push(
            await Promise.all(
              stores.map(
                (store) =>
                  new Promise<unknown[]>((resolve, reject) => {
                    const request = tx.objectStore(store).getAll();
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () =>
                      reject(new Error(request.error?.message ?? "Could not read browser storage"));
                  }),
              ),
            ),
          );
        } finally {
          db.close();
        }
      }
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          const response = await cache.match(request);
          if (response) values.push(await response.text());
        }
      }
      const serialized = JSON.stringify(values);
      return forbiddenValues.filter((value) => serialized.includes(value));
    },
    [...forbidden],
  );
  expect(violations, "Browser storage must not retain attendee contact fields").toEqual([]);
}
