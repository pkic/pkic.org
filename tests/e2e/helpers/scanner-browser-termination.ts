import { randomUUID } from "node:crypto";
import { expect, chromium, type BrowserContext, type Route, type Page } from "@playwright/test";
import { agendaRevisionSchema, agendaSnapshotSchema } from "../../../assets/shared/schemas/event-agenda";
import { eventFormsResponseSchema } from "../../../assets/shared/schemas/forms";
import {
  registrationCreateSchema,
  registrationConfirmQuerySchema,
  registrationConfirmSchema,
  registrationConfirmInfoResponseSchema,
  registrationConfirmResponseSchema,
  registrationSubmissionResponseSchema,
  registrationManageReadResponseSchema,
} from "../../../assets/shared/schemas/registration";
import {
  badgeAttendeesResponseSchema,
  badgeIssueRequestSchema,
  badgeIssueResponseSchema,
} from "../../../assets/shared/schemas/route-contracts-event-badges";
import { userAuthSessionResponseSchema } from "../../../assets/shared/schemas/user-auth";
import { e2eAdminEmail } from "../../helpers/e2e-admin";
import { signInAsE2eStaff } from "./staff-auth";
import { createPortalWaitlistEvent } from "./waitlist-event";
import { clientIpForIdentity } from "./portal-auth";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./sendgrid";
import {
  enrolledEventScanRequestSchema,
  eventScanResponseSchema,
} from "../../../assets/shared/schemas/event-participation-scanning";

type Scan = ReturnType<typeof enrolledEventScanRequestSchema.parse>;
type Receipt = ReturnType<typeof eventScanResponseSchema.parse>;

/** A unique configured event and real mailbox-confirmed attendee, independent from shared agenda edits. */
export async function prepareScannerTermination(page: Page) {
  const operatorEmail = e2eAdminEmail("scanner-recovery-owner");
  await signInAsE2eStaff(page, operatorEmail);
  const owner = userAuthSessionResponseSchema.parse(await (await page.request.get("/api/v1/auth/session")).json());
  const slug = `scanner-termination-${randomUUID()}`;
  await createPortalWaitlistEvent(page, slug);
  const api = `/api/v1/events/${slug}`;
  const draft = agendaSnapshotSchema.parse(await (await page.request.get(`${api}/agenda`)).json());
  const published = await page.request.post(`${api}/agenda/publications`, {
    data: agendaRevisionSchema.parse({ expectedRevision: draft.revision }),
  });
  expect(published.status()).toBe(200);
  const agenda = agendaSnapshotSchema.parse(await published.json());
  expect(agenda.publishedRevision).toBe(agenda.revision);
  const email = `termination-attendee-${randomUUID()}@example.test`;
  const browser = page.context().browser();
  if (!browser) throw new Error("The fixture needs its actual owned browser");
  const guest = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    extraHTTPHeaders: { "cf-connecting-ip": clientIpForIdentity(email) },
  });
  let manageToken: string;
  try {
    const attendeePage = await guest.newPage();
    const placementResponse = await attendeePage.request.get(`${api}/forms/placements/event_registration`);
    expect(placementResponse.status()).toBe(200);
    const placement = eventFormsResponseSchema.parse(await placementResponse.json());
    const customAnswers: ReturnType<typeof registrationCreateSchema.parse>["customAnswers"] = {};
    const knownAnswers: Record<string, string> = {
      organization_name: "Synthetic attribution",
      job_title: "Attendee",
      country: "US",
    };
    for (const field of placement.form?.fields ?? []) {
      if (field.key in knownAnswers) customAnswers[field.key] = knownAnswers[field.key]!;
      else if (field.required) throw new Error(`Unsupported required fixture field: ${field.key}`);
    }
    const since = await capturedEmailCount();
    const registered = await attendeePage.request.post(`${api}/registrations`, {
      data: registrationCreateSchema.parse({
        email,
        firstName: "Synthetic",
        lastName: "Termination attendee",
        organizationName: "Synthetic attribution",
        jobTitle: "Attendee",
        attendanceType: "in_person",
        dayAttendance: placement.eventDays.map((day, index) => ({
          dayDate: day.dayDate,
          attendanceType: index === 0 ? "in_person" : "on_demand",
        })),
        customAnswers,
        consents: placement.requiredTerms.map(({ termKey, version }) => ({ termKey, version })),
      }),
    });
    expect(registered.status()).toBe(200);
    const registration = registrationSubmissionResponseSchema.parse(await registered.json());
    if (!registration.manageToken) throw new Error("The fresh attendee needs its own management capability");
    const mail = await waitForCapturedEmail(email, "Confirm your registration", { since });
    const confirmationUrl = new URL(extractEmailUrl(mail, "/register/confirm"));
    expect(confirmationUrl.searchParams.get("event")).toBe(slug);
    const confirmation = registrationConfirmQuerySchema.parse({
      id: confirmationUrl.searchParams.get("id"),
      token: confirmationUrl.searchParams.get("token"),
    });
    expect(confirmation.id).toBe(registration.registrationId);
    // This event was created after the static release. Redeem its actual mailbox
    // capability at the same mounted endpoints the confirmation page uses.
    const info = await attendeePage.request.get(`${api}/registrations/confirm-info`, { params: confirmation });
    expect(info.status()).toBe(200);
    expect(registrationConfirmInfoResponseSchema.parse(await info.json())).toMatchObject({
      email,
      firstName: "Synthetic",
      lastName: "Termination attendee",
      expired: false,
      recoverable: false,
    });
    const confirmed = await attendeePage.request.post(`${api}/registrations/confirm-email`, {
      data: registrationConfirmSchema.parse(confirmation),
    });
    expect(confirmed.status()).toBe(200);
    const confirmedRegistration = registrationConfirmResponseSchema.parse(await confirmed.json());
    expect(confirmedRegistration).toMatchObject({ stage: "confirmed", status: "registered" });
    manageToken = confirmedRegistration.manageToken;
    await waitForCapturedEmail(email, "registration is confirmed", { since });
  } finally {
    await guest.close();
  }
  const attendees = badgeAttendeesResponseSchema.parse(
    await (
      await page.request.get(`${api}/badges/attendees?q=${encodeURIComponent(email)}&sort=email&limit=10&offset=0`)
    ).json(),
  );
  const attendee = attendees.users.find((row) => row.email === email);
  if (!attendee) throw new Error("Confirmed attendee missing from canonical badge population");
  const issued = await page.request.post(`${api}/badges`, {
    data: badgeIssueRequestSchema.parse({ operationId: randomUUID(), userId: attendee.id }),
  });
  expect(issued.status()).toBe(200);
  const badge = badgeIssueResponseSchema.parse(await issued.json());
  if (badge.result !== "issued") throw new Error("The fresh operation must issue its credential");
  const managePath = `/api/v1/registrations/access/${encodeURIComponent(manageToken)}`;
  const managed = await page.request.get(managePath);
  expect(managed.status()).toBe(200);
  const registrationBefore = registrationManageReadResponseSchema.parse(await managed.json());
  return {
    api,
    scanner: `/portal/#/events/${slug}/scanner`,
    operatorEmail,
    operatorId: owner.identity.id,
    attendeeId: attendee.id,
    eligible: badge.credential,
    eligibleBadgeId: badge.id,
    publishedRevision: agenda.revision,
    managePath,
    registrationBefore,
    forbidden: [email, "Synthetic attribution", "Termination attendee"],
  };
}

export async function launchPersistentScanner(profile: string, baseURL: string, offline = false) {
  const context = await chromium.launchPersistentContext(profile, {
    baseURL,
    headless: true,
    offline,
    viewport: { width: 1280, height: 900 },
  });
  context.setDefaultTimeout(20_000);
  return context;
}

/** Hold delivery of a real committed receipt, without returning invented HTTP data. */
export async function holdScannerReceipt(context: BrowserContext, scansPath: string, original: Scan) {
  const exchanges: Array<{ scan: Scan; receipt: Receipt; source: "page" | "service_worker" }> = [];
  let release!: () => void;
  const interrupted = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pattern = `**${scansPath}`;
  const handler = async (route: Route) => {
    if (route.request().method() !== "POST" || route.request().postDataJSON()?.operationId !== original.operationId)
      return route.continue();
    const scan = enrolledEventScanRequestSchema.parse(route.request().postDataJSON());
    expect(scan).toEqual(original);
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const receipt = eventScanResponseSchema.parse(await response.json());
    exchanges.push({ scan, receipt, source: route.request().serviceWorker() ? "service_worker" : "page" });
    // The owned browser process dies before this handler can deliver its receipt.
    await interrupted;
    await route.abort("failed").catch(() => {});
  };
  await context.route(pattern, handler);
  return {
    exchanges,
    release,
    async committed() {
      await expect.poll(() => exchanges.length).toBe(1);
      return exchanges[0]!;
    },
  };
}

/** Crash the owned browser process, not merely a page, context, or worker URL revision. */
export async function crashPersistentScanner(context: BrowserContext, releaseHeldReceipt: () => void) {
  const browser = context.browser();
  if (!browser) throw new Error("The persistent context must expose its actual browser process");
  const cdp = await browser.newBrowserCDPSession();
  const processes = await cdp.send("SystemInfo.getProcessInfo");
  const ownedBrowsers = processes.processInfo.filter((entry) => entry.type === "browser");
  expect(ownedBrowsers).toHaveLength(1);
  const processId = ownedBrowsers[0]?.id;
  if (!processId || !Number.isSafeInteger(processId) || processId <= 0 || processId === process.pid)
    throw new Error("Termination requires the exact owned Chromium browser process ID");
  let observedDisconnection = false;
  const onDisconnected = () => {
    observedDisconnection = true;
  };
  browser.once("disconnected", onDisconnected);
  try {
    process.kill(processId, "SIGKILL");
    await expect
      .poll(
        () => {
          try {
            process.kill(processId, 0);
            return false;
          } catch (cause: unknown) {
            if (cause instanceof Error && "code" in cause && cause.code === "ESRCH") return true;
            throw cause;
          }
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    // Release only after OS-confirmed death; parked interception cleanup must
    // not become a dependency of the termination command's acknowledgment.
    releaseHeldReceipt();
    await expect.poll(() => observedDisconnection, { timeout: 10_000 }).toBe(true);
  } finally {
    browser.removeListener("disconnected", onDisconnected);
  }
  expect(browser.isConnected()).toBe(false);
  return { method: "SIGKILL", processId, browserProcessGone: true, browserDisconnected: true };
}

/** Normal replay delivers the real canonical backend response unchanged. */
export async function observeScannerReplay(context: BrowserContext, scansPath: string, original: Scan) {
  const exchanges: Array<{ scan: Scan; receipt: Receipt }> = [];
  const pattern = `**${scansPath}`;
  const handler = async (route: Route) => {
    if (route.request().method() !== "POST" || route.request().postDataJSON()?.operationId !== original.operationId)
      return route.continue();
    const scan = enrolledEventScanRequestSchema.parse(route.request().postDataJSON());
    expect(scan).toEqual(original);
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    exchanges.push({ scan, receipt: eventScanResponseSchema.parse(await response.json()) });
    await route.fulfill({ response });
  };
  await context.route(pattern, handler);
  return { exchanges, stop: () => context.unroute(pattern, handler) };
}
