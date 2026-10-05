import { randomUUID } from "node:crypto";
import { expect, type Page, type TestInfo, type ConsoleMessage } from "@playwright/test";
import type { AgendaOccurrence } from "../../../assets/shared/schemas/event-agenda";
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
import { enrolledOfflineEligibilityResponseSchema } from "../../../assets/shared/schemas/event-offline-eligibility";
import {
  scannerStorage,
  scrollScannerToTop,
  reconnectScannerBrowser,
  openScannerDiagnostics,
} from "./scanner-recovery-storage";

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

/** Retain and inspect one actual offline lead before its immutable server acknowledgment. */
export async function captureOfflineSponsorBadge(
  page: Page,
  badgeId: string,
  sponsorId: string,
  operatorUserId: string,
  forbidden: readonly string[],
  readConsole: ReturnType<typeof captureDeviceConsole>,
) {
  const diagnostics = await openScannerDiagnostics(page);
  await expect(
    diagnostics.getByText("Scanner session: open. Offline preparation uses the last saved authorization.", {
      exact: true,
    }),
  ).toBeVisible();
  await diagnostics.getByText("Recovery and diagnostics", { exact: true }).click();
  await page.context().setOffline(true);
  let pendingLead: ReturnType<typeof enrolledEventScanRequestSchema.parse> | undefined;
  let pendingPrivacy: Awaited<ReturnType<typeof expectNoStoredSponsorContacts>> | undefined;
  try {
    await page.getByLabel("Badge code", { exact: true }).fill(badgeId);
    await page
      .getByRole("checkbox", {
        name: "The attendee agrees to share their contact details with this sponsor.",
        exact: true,
      })
      .check();
    await page.getByRole("button", { name: "Capture lead", exact: true }).click();
    await expect(page.getByText("1 scans awaiting upload", { exact: true })).toBeVisible();
    const pending = await scannerStorage(page);
    expect(pending.pending).toHaveLength(1);
    pendingLead = enrolledEventScanRequestSchema.parse(pending.pending[0]!.scan);
    expect(pendingLead).toMatchObject({
      action: "lead",
      badgeId,
      sponsorId,
      operatorUserId,
      consentConfirmed: true,
      occurrenceId: null,
    });
    expect(pendingLead.offlineRight).toBeUndefined();
    for (const marker of forbidden) await expect(page.getByText(marker, { exact: true })).toHaveCount(0);
    pendingPrivacy = await expectNoStoredSponsorContacts(page, forbidden, await readConsole());
  } finally {
    await reconnectScannerBrowser(page.context(), page);
  }
  if (!pendingLead || !pendingPrivacy) throw new Error("The inspected offline lead must survive to reconciliation");
  const request = pendingLead;
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect.poll(async () => (await scannerStorage(page)).pending.length).toBe(0);
  const archived = (await scannerStorage(page)).history.find((row) => row.scan.operationId === request.operationId);
  expect(archived?.scan).toEqual(request);
  const receipt = eventScanResponseSchema.parse(archived?.receipt);
  expect(receipt).toMatchObject({
    operationId: request.operationId,
    outcome: "eligible",
    recorded: true,
    attendanceRecorded: false,
    admissionRecorded: false,
  });
  return { request, receipt, pendingPrivacy };
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

/** Capture actual device console arguments before scanning, and await every pending serialization. */
export function captureDeviceConsole(page: Page) {
  const messages: unknown[] = [];
  const pending: Promise<void>[] = [];
  const serializationErrors: string[] = [];
  const onConsole = (message: ConsoleMessage) => {
    pending.push(
      Promise.all(message.args().map((argument) => argument.jsonValue())).then(
        (args) => {
          messages.push({
            source: message.worker() ? "worker" : "page",
            type: message.type(),
            text: message.text(),
            args,
          });
        },
        (error: unknown) => {
          serializationErrors.push(String(error));
        },
      ),
    );
  };
  const onPageError = (error: Error) => {
    messages.push({ source: "pageerror", type: "pageerror", message: error.message });
  };
  page.context().on("console", onConsole);
  page.on("pageerror", onPageError);
  return async (stop = false) => {
    if (stop) {
      page.context().off("console", onConsole);
      page.off("pageerror", onPageError);
    }
    let completed = 0;
    while (completed < pending.length) {
      const batch = pending.slice(completed);
      completed += batch.length;
      await Promise.all(batch);
    }
    expect(serializationErrors, "Every observed browser console argument must be inspectable").toEqual([]);
    return [...messages];
  };
}

/** Observe preparation caused by the actual epoch restart, preserving the selected session. */
export async function startNextDoorScannerContext(
  page: Page,
  occurrence: Pick<AgendaOccurrence, "id" | "roomId">,
  previous: ReturnType<typeof enrolledOfflineEligibilityResponseSchema.parse>,
) {
  await page.getByLabel("Scan mode", { exact: true }).selectOption("attendance");
  const preparing = page
    .waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.ok() &&
        url.pathname === `${eventApi}/offline-eligibility` &&
        url.searchParams.get("occurrenceId") === occurrence.id &&
        url.searchParams.get("roomId") === occurrence.roomId &&
        Boolean(url.searchParams.get("epochId")) &&
        url.searchParams.get("epochId") !== previous.epochId
      );
    })
    .then(async (response) => enrolledOfflineEligibilityResponseSchema.parse(await response.json()));
  const diagnostics = await openScannerDiagnostics(page);
  await diagnostics.getByRole("button", { name: "Start next scanner session", exact: true }).click();
  const manifest = await preparing;
  expect(manifest).toMatchObject({
    eventId: previous.eventId,
    deviceId: previous.deviceId,
    operatorUserId: previous.operatorUserId,
    occurrenceId: occurrence.id,
    roomId: occurrence.roomId,
    publishedRevision: previous.publishedRevision,
  });
  expect(manifest.epochId).not.toBe(previous.epochId);
  await expect(page.getByText("New scanner session prepared. Ready to scan.", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Eligibility data ready. Checks run locally; attendance uploads in the background.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Start scanning", exact: true })).toBeEnabled();
  return manifest;
}

/** Reject contact-bearing input through the real form without submitting or changing retained scans. */
export async function expectContactBadgeRejected(page: Page, email: string, freeText: string) {
  const before = await scannerStorage(page);
  const submissions: string[] = [];
  const observe = (request: import("@playwright/test").Request) => {
    if (new URL(request.url()).pathname === `${eventApi}/scans` && request.method() === "POST")
      submissions.push(request.postData() ?? "");
  };
  page.on("request", observe);
  try {
    await page.getByLabel("Badge code", { exact: true }).fill(JSON.stringify({ email, biography: freeText }));
    await page.getByRole("button", { name: "Check registration", exact: true }).click();
    await expect(page.getByLabel("Badge code", { exact: true })).toHaveAttribute("aria-invalid", "true");
    expect(submissions).toEqual([]);
    expect(await scannerStorage(page)).toEqual(before);
  } finally {
    page.off("request", observe);
  }
}

/** Prepare the exact approved scanner context through its real browser controls. */
export async function prepareDoorScannerContext(
  page: Page,
  occurrence: Pick<AgendaOccurrence, "id" | "title" | "roomId">,
  publishedRevision: number,
) {
  const path = `${eventApi}/offline-eligibility`;
  const preparing = page.waitForResponse((response) => new URL(response.url()).pathname === path && response.ok());
  await page.goto(`/portal/#/events/${sponsorEventSlug}/scanner`);
  const manifest = enrolledOfflineEligibilityResponseSchema.parse(await (await preparing).json());
  expect(manifest.publishedRevision).toBe(publishedRevision);
  await expect(
    page.getByText("Eligibility data ready. Checks run locally; attendance uploads in the background.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? "")).not.toBe("");
  const selected = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.ok() &&
      url.pathname === path &&
      url.searchParams.get("occurrenceId") === occurrence.id &&
      url.searchParams.get("roomId") === occurrence.roomId &&
      url.searchParams.get("epochId") === manifest.epochId
    );
  });
  await page.getByRole("combobox", { name: "Check-in location", exact: true }).fill(occurrence.title);
  await page.getByRole("option", { name: occurrence.title, exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Check-in location", exact: true })).toHaveValue(occurrence.title);
  await expect(page.getByRole("combobox", { name: "Physical room", exact: true })).toHaveValue(occurrence.roomId!);
  const prepared = enrolledOfflineEligibilityResponseSchema.parse(await (await selected).json());
  expect(prepared).toMatchObject({
    epochId: manifest.epochId,
    deviceId: manifest.deviceId,
    operatorUserId: manifest.operatorUserId,
    occurrenceId: occurrence.id,
    roomId: occurrence.roomId,
    publishedRevision,
  });
  await expect(page.getByRole("button", { name: "Start scanning", exact: true })).toBeEnabled();
  return prepared;
}

/** Inspect existing browser storage read-only; canonical badge UUIDs are permitted scan identifiers. */
export async function expectNoStoredSponsorContacts(
  page: Page,
  forbidden: readonly string[],
  consoleMessages: readonly unknown[] = [],
) {
  const inspected = await page.evaluate(
    async (forbiddenValues) => {
      const values: unknown[] = [Object.entries(localStorage), Object.entries(sessionStorage)];
      const inventory: Array<{ database: string; store: string; count: number }> = [];
      const cacheKeys: Array<{ cache: string; url: string }> = [];
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
                    const keys = tx.objectStore(store).getAllKeys();
                    const keysRead = new Promise<IDBValidKey[]>((resolveKeys, rejectKeys) => {
                      keys.onsuccess = () => resolveKeys(keys.result);
                      keys.onerror = () => rejectKeys(new Error(keys.error?.message ?? "Could not read storage keys"));
                    });
                    request.onsuccess = () => {
                      inventory.push({ database: name, store, count: request.result.length });
                      keysRead.then((keys) => resolve([keys, request.result]), reject);
                    };
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
          cacheKeys.push({ cache: name, url: request.url });
          const response = await cache.match(request);
          if (response) values.push(await response.text());
        }
      }
      const serialized = JSON.stringify({ values, inventory, cacheKeys });
      return { violations: forbiddenValues.filter((value) => serialized.includes(value)), inventory, cacheKeys };
    },
    forbidden.flatMap((value) => [value, encodeURIComponent(value)]),
  );
  expect(
    inspected.violations,
    "Browser stores, cache URLs and bodies must not retain attendee contact or free-text markers",
  ).toEqual([]);
  expect(
    forbidden
      .flatMap((value) => [value, encodeURIComponent(value)])
      .filter((value) => JSON.stringify(consoleMessages).includes(value)),
    "Device console text and arguments must not retain contact or free-text markers",
  ).toEqual([]);
  for (const key of inspected.cacheKeys) expect(new URL(key.url).pathname).not.toMatch(/^\/api\//);
  return {
    inventory: inspected.inventory,
    cacheKeys: inspected.cacheKeys,
    consoleMessageCount: consoleMessages.length,
    consoleSources: ["page", "worker", "pageerror"].map((source) => ({
      source,
      count: consoleMessages.filter(
        (message) =>
          typeof message === "object" && message !== null && "source" in message && message.source === source,
      ).length,
    })),
  };
}
