import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import ICAL from "ical.js";
import { eventDetailResponseSchema } from "../../assets/shared/schemas/event-management";
import { eventFormsResponseSchema } from "../../assets/shared/schemas/forms";
import { conferenceProgramSchema } from "../../assets/shared/schemas/conference-program";
import {
  agendaRevisionSchema,
  agendaOccurrencePatchSchema,
  agendaSnapshotSchema,
} from "../../assets/shared/schemas/event-agenda";
import { personalAgendaResponseSchema } from "../../assets/shared/schemas/event-personal-agenda";
import { roomRecommendationsResponseSchema } from "../../assets/shared/schemas/event-room-recommendations";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import {
  registrationManageSchema,
  registrationManageReadResponseSchema,
  registrationManageUpdateResponseSchema,
} from "../../assets/shared/schemas/registration";
import {
  sessionParticipationRequestSchema,
  sessionParticipationResponseSchema,
  enrolledEventScanRequestSchema,
  eventScanResponseSchema,
} from "../../assets/shared/schemas/event-participation-scanning";
import {
  scannerDeviceSessionClosingSchema,
  scannerDeviceSessionStatusSchema,
} from "../../assets/shared/schemas/event-scanner-devices";
import {
  attendanceSummarySchema,
  attendanceAttemptsResponseSchema,
  eventAttendancePeopleResponseSchema,
} from "../../assets/shared/schemas/event-attendance-reporting";
import { sponsorLeadSponsorsSchema, sponsorLeadListSchema } from "../../assets/shared/schemas/event-sponsor-lead-list";
import { speakerSelfProfilePatchSchema } from "../../assets/shared/schemas/proposal-management";
import {
  speakerSelfServiceReadResponseSchema,
  speakerProfileUpdateResponseSchema,
} from "../../assets/shared/schemas/speaker-self-service";
import { publishedSessionRoute } from "../../assets/shared/session-public-route";
import { signInToPortal } from "./helpers/portal-auth";
import { publishE2eSite } from "./helpers/site-publication";
import { runAgendaAction } from "./helpers/agenda-actions";
import { correctPilotAttendance } from "./helpers/attendance-correction";
import {
  scannerStorage,
  reconnectScannerBrowser,
  openScannerDiagnostics,
  closeScannerDiagnostics,
} from "./helpers/scanner-recovery-storage";
import {
  prepareSponsorLiveFixture,
  captureDeviceConsole,
  expectContactBadgeRejected,
  captureOfflineSponsorBadge,
  prepareDoorScannerContext,
  startNextDoorScannerContext,
  expectNoStoredSponsorContacts,
  sponsorEventSlug,
} from "./helpers/sponsor-live-fixture";
import {
  pilotAgendaApi,
  openPilotAgenda,
  readPilotAgenda,
  capturePilot,
  preparePilotMeeting,
  preparePilotSpeaker,
  preparePilotConference,
  editAndSwapPilot,
  staffPilot,
  grantPilotDoor,
  approvePilotAppearance,
  releasePilotArchive,
} from "./helpers/agenda-integrated-pilot";

test.use({ actionTimeout: 30_000 });

async function closePilotScanner(page: Page, scan: ReturnType<typeof enrolledEventScanRequestSchema.parse>) {
  await expect.poll(async () => (await scannerStorage(page)).pending.length).toBe(0);
  // Manual entry is a modal dialog; leave it before reaching the scanner's diagnostics.
  const manual = page.getByRole("dialog", { name: /^(Enter badge code|Review sponsor lead)$/ });
  if (await manual.isVisible()) await manual.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(manual).not.toBeVisible();
  const diagnostics = await openScannerDiagnostics(page);
  const closing = page
    .waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/events/${sponsorEventSlug}/scanner/devices/sessions/${scan.scannerSession.epochId}/closing` &&
        response.request().method() === "POST",
      { timeout: 30_000 },
    )
    .then(async (response) => {
      expect(response.status()).toBe(200);
      const input = scannerDeviceSessionClosingSchema.parse(response.request().postDataJSON());
      const status = scannerDeviceSessionStatusSchema.parse(await response.json());
      expect(input.highWaterSequence).toBe(scan.scannerSession.sequence);
      expect(input.sponsorId).toBe(scan.sponsorId ?? undefined);
      expect(status).toMatchObject({
        epochId: scan.scannerSession.epochId,
        deviceId: scan.deviceId,
        closingOperationId: input.operationId,
        highWaterSequence: input.highWaterSequence,
        receivedCount: input.highWaterSequence,
        missingCount: 0,
      });
      expect(status.closedAt).not.toBeNull();
      return status;
    });
  await diagnostics.getByRole("button", { name: "Close scanner session", exact: true }).click();
  const status = await closing;
  await expect(
    diagnostics.getByText("Scanner session: closed. Offline preparation uses the last saved authorization.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(diagnostics.getByRole("button", { name: "Start next scanner session", exact: true })).toBeEnabled();
  return status;
}

/** Run alone in fresh prepared state. This is a real pre-event rehearsal, never an elapsed-event/device acceptance claim. */
test("one recurring meeting and conference retain the same actors through organizer, speaker, attendee and reporting workflows", async ({
  page: staff,
  browser,
}, info) => {
  test.setTimeout(900_000);
  const contexts: BrowserContext[] = [];
  for (let index = 0; index < 5; index++)
    contexts.push(await browser.newContext({ baseURL: info.project.use.baseURL }));
  const [meetingContext, attendeeContext, speakerContext, doorContext, sponsorContext] = contexts;
  if (!meetingContext || !attendeeContext || !speakerContext || !doorContext || !sponsorContext)
    throw new Error("The pilot requires isolated actor browsers");
  const meetingParticipant = await meetingContext.newPage(),
    attendee = await attendeeContext.newPage(),
    speakerPage = await speakerContext.newPage(),
    door = await doorContext.newPage(),
    sponsor = await sponsorContext.newPage();
  const doorConsole = captureDeviceConsole(door),
    sponsorConsole = captureDeviceConsole(sponsor);
  try {
    // Existing fixture establishes its own registrations, live sponsor and authority through actual mailbox/API flows.
    const fixture = await prepareSponsorLiveFixture(staff, attendee);
    const freeTextMarker = `Device-free-text-${randomUUID()}`;
    const forbidden = [fixture.email, fixture.deniedEmail, fixture.firstName, fixture.organization, freeTextMarker];
    const devicePrivacy: Array<Awaited<ReturnType<typeof expectNoStoredSponsorContacts>> & { stage: string }> = [];
    const inspectDevice = async (page: Page, logs: typeof doorConsole, stage: string, stop = false) => {
      devicePrivacy.push({ stage, ...(await expectNoStoredSponsorContacts(page, forbidden, await logs(stop))) });
    };
    const eventResponse = await staff.request.get(`/api/v1/events/${sponsorEventSlug}`);
    expect(eventResponse.status()).toBe(200);
    const event = eventDetailResponseSchema.parse(await eventResponse.json()).event;
    if (!("ownerGroupId" in event) || !event.ownerGroupId)
      throw new Error("The synthetic conference needs its real owning group");
    expect(event.startsAt).not.toBeNull();
    expect(event.endsAt).not.toBeNull();
    const placementResponse = await staff.request.get(
      `/api/v1/events/${sponsorEventSlug}/forms/placements/event_registration`,
    );
    expect(placementResponse.status()).toBe(200);
    const placement = eventFormsResponseSchema.parse(await placementResponse.json());
    expect(placement.event.id).toBe(event.id);
    expect(placement.form).not.toBeNull();
    expect(placement.eventDays.map((day) => day.dayDate)).toEqual(["2026-12-01", "2026-12-02", "2026-12-03"]);
    for (const day of placement.eventDays)
      expect(day.attendanceOptions.map((option) => option.value)).toEqual(
        expect.arrayContaining(["in_person", "on_demand"]),
      );
    const meeting = await preparePilotMeeting(staff, meetingParticipant, event.ownerGroupId, info);
    expect(meeting.eventId).not.toBe(event.id);
    const speaker = await preparePilotSpeaker(staff, speakerPage, info);
    const ids = await preparePilotConference(staff, speaker);
    let draft = await readPilotAgenda(staff);
    for (const occurrence of draft.occurrences) {
      expect(occurrence.startAt! >= event.startsAt! && occurrence.endAt! <= event.endsAt!).toBe(true);
    }
    const original = draft.occurrences.find((row) => row.id === ids.sourceId)!;
    const parallel = draft.occurrences.find((row) => row.id === ids.parallelId)!;
    await editAndSwapPilot(staff, original, parallel, info);
    const staffing = await staffPilot(staff, meeting.member.userId, info);
    draft = await readPilotAgenda(staff);
    const selected = draft.occurrences.find((row) => row.id === ids.sourceId)!;
    await approvePilotAppearance(staff, selected, speaker.userId);
    await openPilotAgenda(staff);
    await runAgendaAction(staff, "Review for publication");
    const publishing = staff.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${pilotAgendaApi}/publications` && response.request().method() === "POST",
    );
    await staff.getByRole("button", { name: "Approve for publication", exact: true }).click();
    const published = await publishing;
    expect(published.status(), await published.text()).toBe(200);
    agendaRevisionSchema.parse(published.request().postDataJSON());
    const approved = agendaSnapshotSchema.parse(await published.json());
    expect(approved.publishedRevision).not.toBeNull();
    expect(approved.assignments).toContainEqual(staffing.pinned);
    const route = approved.publicAgendaPath;
    if (!route) throw new Error("Canonical publication must return its authored public agenda route");
    const release = await publishE2eSite(staff, route);
    const publicPage = await speakerContext.newPage();
    await publicPage.goto(route);
    await expect(publicPage.locator(`article[data-agenda-occurrence="${ids.sourceId}"]`)).toContainText(speaker.title);
    const dataResponse = await publicPage.request.get(`${route}data.json`);
    expect(dataResponse.status()).toBe(200);
    const program = conferenceProgramSchema.parse(await dataResponse.json());
    const publicIds = Object.values(program.agenda).flatMap((slots) =>
      slots.flatMap((slot) => slot.sessions.map((session) => session.id)),
    );
    expect(publicIds.sort()).toEqual(approved.occurrences.map((row) => row.id).sort());
    const calendarResponse = await publicPage.request.get(`${route}calendar.ics`);
    expect(calendarResponse.status()).toBe(200);
    const calendarEvents = new ICAL.Component(ICAL.parse(await calendarResponse.text())).getAllSubcomponents("vevent");
    expect(calendarEvents).toHaveLength(3);
    for (const occurrence of approved.occurrences)
      expect(calendarEvents.some((entry) => String(entry.getFirstPropertyValue("uid")).includes(occurrence.id))).toBe(
        true,
      );
    await capturePilot(publicPage, info, "pilot-approved-public-agenda");

    const managePath = `/api/v1/registrations/access/${encodeURIComponent(fixture.manageToken)}`;
    const beforeRegistration = registrationManageReadResponseSchema.parse(
      await (await attendee.request.get(managePath)).json(),
    );
    expect(beforeRegistration.registration).toMatchObject({
      event_id: event.id,
      status: "registered",
      isEmailVerified: true,
    });
    expect(beforeRegistration.user.email).toBe(fixture.email);
    // The helper's day-selection fixture initially chooses on-demand. Upgrade only the attendee's actual registration.
    const physical = await attendee.request.patch(managePath, {
      data: registrationManageSchema.parse({
        action: "update",
        attendanceType: "in_person",
        dayAttendance: beforeRegistration.dayAttendance.map((day) => ({
          dayDate: day.dayDate,
          attendanceType: "in_person",
        })),
      }),
    });
    expect(physical.status(), await physical.text()).toBe(200);
    expect(registrationManageUpdateResponseSchema.parse(await physical.json()).sponsorSharing.allowed).toBe(true);
    await signInToPortal(attendee, fixture.email);
    const attendeeSession = userAuthSessionResponseSchema.parse(
      await (await attendee.request.get("/api/v1/auth/session")).json(),
    );
    expect(attendeeSession.identity.id).toBe(fixture.consenting.userId);
    const source = approved.occurrences.find((row) => row.id === ids.sourceId)!;
    const frozenAppearance = source.history?.appearances.find((appearance) => appearance.userId === speaker.userId);
    expect(frozenAppearance).toBeDefined();
    const preference = approved.occurrences.find((row) => row.id !== source.id && row.startAt !== source.startAt)!;
    const selections = [
      [source, "reserve", "reserved"],
      [preference, "save", "saved"],
    ] as const;
    for (const [occurrence, action, status] of selections) {
      await attendee.goto(`/portal/#/events/${sponsorEventSlug}/agenda?session=${occurrence.id}`);
      // The deep link opens the session's details over the event app's agenda.
      const details = attendee.getByRole("dialog", { name: occurrence.title, exact: true });
      await expect(details.getByRole("heading", { name: occurrence.title, exact: true })).toBeVisible();
      const participation = details.getByRole("region", { name: "My participation", exact: true });
      await participation.getByLabel("Attendance", { exact: true }).selectOption("physical");
      const changing = attendee.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `${pilotAgendaApi}/${occurrence.id}/participation` &&
          response.request().method() === "PUT",
      );
      // Saving interest is the details' star; registration is the participation command.
      if (action === "save")
        await details.getByRole("button", { name: `Star ${occurrence.title}`, exact: true }).click();
      else {
        await participation.getByLabel("Participation", { exact: true }).selectOption(action);
        await participation.getByRole("button", { name: "Update", exact: true }).click();
      }
      const changed = await changing;
      expect(changed.status(), await changed.text()).toBe(200);
      const body = sessionParticipationRequestSchema.parse(changed.request().postDataJSON());
      expect(body.action).toBe(action);
      if (action === "reserve") expect(body.expectedPublishedRevision).toBe(approved.publishedRevision);
      expect(sessionParticipationResponseSchema.parse(await changed.json()).status).toBe(status);
    }
    const personalBefore = personalAgendaResponseSchema.parse(
      await (await attendee.request.get(`${pilotAgendaApi}/participation?limit=10&offset=0`)).json(),
    );
    expect(personalBefore.sessions.find((row) => row.id === source.id)?.status).toBe("reserved");
    expect(personalBefore.sessions.find((row) => row.id === preference.id)?.saved).toBe(true);
    const demandResponse = await staff.request.get(`${pilotAgendaApi}/occurrences/${source.id}/room-recommendations`);
    expect(demandResponse.status()).toBe(200);
    expect(roomRecommendationsResponseSchema.parse(await demandResponse.json()).demand.physical.confirmed).toBe(1);
    const beforeEditorial = await readPilotAgenda(staff);
    const editorial = await staff.request.patch(`${pilotAgendaApi}/occurrences/${preference.id}`, {
      data: agendaOccurrencePatchSchema.parse({
        expectedRevision: beforeEditorial.revision,
        description: "Private draft changes must not rewrite this attendee's published commitments.",
      }),
    });
    expect(editorial.status()).toBe(200);
    const personalAfter = personalAgendaResponseSchema.parse(
      await (await attendee.request.get(`${pilotAgendaApi}/participation?limit=10&offset=0`)).json(),
    );
    expect(personalAfter.sessions).toEqual(personalBefore.sessions);
    await capturePilot(attendee, info, "pilot-own-session-participation");

    const doorGrantIds = await grantPilotDoor(staff, meeting.member.userId, event.id);
    await signInToPortal(door, meeting.member.email);
    const scansPath = `/api/v1/events/${sponsorEventSlug}/scans`;
    const manifest = await prepareDoorScannerContext(door, source, approved.publishedRevision!);
    expect(manifest.entries.find((entry) => entry.userId === fixture.consenting.userId)).toMatchObject({
      eventRegistered: true,
      physicalDayEligible: true,
    });
    await door.getByLabel("Scan mode", { exact: true }).selectOption("admission");
    const receivingAdmission = door.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === scansPath &&
        response.request().method() === "POST" &&
        response.request().postDataJSON()?.badgeId === fixture.consenting.badgeId,
    );
    await door.getByLabel("Badge code", { exact: true }).fill(fixture.consenting.badgeId);
    await door.getByRole("button", { name: "Admission decision", exact: true }).click();
    const admitted = await receivingAdmission;
    expect(admitted.status()).toBe(200);
    const admission = enrolledEventScanRequestSchema.parse(admitted.request().postDataJSON());
    expect(admission).toMatchObject({
      action: "admission",
      operatorUserId: meeting.member.userId,
      occurrenceId: source.id,
      roomId: source.roomId,
      capturePublicationRevision: approved.publishedRevision,
    });
    const admissionReceipt = eventScanResponseSchema.parse(await admitted.json());
    expect(admissionReceipt).toMatchObject({
      operationId: admission.operationId,
      outcome: "eligible",
      admissionRecorded: true,
      admissionDecision: "allowed",
      attendanceRecorded: false,
    });
    await expect
      .poll(async () =>
        (await scannerStorage(door)).history.some((row) => row.scan.operationId === admission.operationId),
      )
      .toBe(true);
    const replay = await door.request.post(scansPath, { data: admission });
    expect(eventScanResponseSchema.parse(await replay.json())).toEqual(admissionReceipt);
    await expectContactBadgeRejected(door, fixture.email, freeTextMarker);
    await inspectDevice(door, doorConsole, "admission-acknowledged-and-contact-payload-refused");
    const manualClosed = await closePilotScanner(door, admission);
    await startNextDoorScannerContext(door, source, manifest);
    await doorContext.setOffline(true);
    let stored: Awaited<ReturnType<typeof scannerStorage>> | undefined;
    try {
      await door.getByLabel("Badge code", { exact: true }).fill(fixture.consenting.badgeId);
      await door.getByRole("button", { name: "Record attendance", exact: true }).click();
      await expect(door.getByText("1 scans awaiting upload", { exact: true })).toBeVisible();
      stored = await scannerStorage(door);
      expect(stored.pending).toHaveLength(1);
      const scan = enrolledEventScanRequestSchema.parse(stored.pending[0]!.scan);
      expect(scan).toMatchObject({
        badgeId: fixture.consenting.badgeId,
        operatorUserId: meeting.member.userId,
        action: "attendance",
        capturePublicationRevision: approved.publishedRevision,
        occurrenceId: source.id,
        roomId: source.roomId,
      });
      expect(Object.keys(scan)).not.toEqual(expect.arrayContaining(["email", "name", "contacts"]));
      await inspectDevice(door, doorConsole, "attendance-offline-pending");
      await capturePilot(door, info, "pilot-offline-original-capture");
    } finally {
      await reconnectScannerBrowser(doorContext, door);
    }
    if (!stored) throw new Error("The original offline capture must survive to reconciliation");
    const originalScan = enrolledEventScanRequestSchema.parse(stored.pending[0]!.scan);
    await expect(door.getByText("0 scans awaiting upload", { exact: true })).toBeVisible();
    const reconciled = await scannerStorage(door);
    expect(reconciled.pending).toHaveLength(0);
    const acknowledgment = reconciled.history.find((row) => row.scan.operationId === originalScan.operationId);
    expect(acknowledgment?.scan).toEqual(originalScan);
    expect(acknowledgment?.receipt).toMatchObject({ outcome: "eligible", attendanceRecorded: true });
    const originalReplay = await door.request.post(scansPath, { data: originalScan });
    expect(eventScanResponseSchema.parse(await originalReplay.json())).toEqual(acknowledgment?.receipt);
    await inspectDevice(door, doorConsole, "attendance-acknowledged");
    const doorClosed = await closePilotScanner(door, originalScan);
    await capturePilot(door, info, "pilot-reconciled-attendance");

    const summaryPath = `/api/v1/events/${sponsorEventSlug}/attendance/summary`;
    const reportBeforeLead = attendanceSummarySchema.parse(await (await staff.request.get(summaryPath)).json());
    expect(reportBeforeLead).toMatchObject({
      eventId: event.id,
      observed: { uniquePeople: 1 },
      attempts: { admissionAllowed: 1, uniqueAllowedAdmissionPeople: 1 },
      evidence: { presenceDuration: "not_established" },
      sync: { completeness: "not_established" },
    });
    expect((await door.request.get(summaryPath)).status()).toBe(403);
    await signInToPortal(sponsor, fixture.operator.email);
    const sponsorsPath = `/api/v1/events/${sponsorEventSlug}/sponsors`;
    const sponsors = sponsorLeadSponsorsSchema.parse(await (await sponsor.request.get(`${sponsorsPath}/leads`)).json());
    const scope = sponsors.sponsors.find((row) => row.id === fixture.sponsorId);
    expect(scope).toMatchObject({ canView: true, canCapture: true, canExport: true });
    if (!scope) throw new Error("The pilot sponsor needs its own active scope");
    await sponsor.goto(fixture.workspace);
    await sponsor.getByRole("button", { name: `Open leads for ${scope.name}`, exact: true }).click();
    await sponsor.getByRole("button", { name: "Scan leads", exact: true }).click();
    const captured = await captureOfflineSponsorBadge(
      sponsor,
      fixture.consenting.badgeId,
      fixture.sponsorId,
      fixture.operator.userId,
      forbidden,
      sponsorConsole,
    );
    devicePrivacy.push({ stage: "sponsor-lead-offline-pending", ...captured.pendingPrivacy });
    await inspectDevice(sponsor, sponsorConsole, "sponsor-lead-acknowledged");
    const leadReplay = await sponsor.request.post(scansPath, { data: captured.request });
    expect(leadReplay.status()).toBe(200);
    expect(eventScanResponseSchema.parse(await leadReplay.json())).toEqual(captured.receipt);
    const sponsorClosed = await closePilotScanner(sponsor, captured.request);
    const leadsPath = `${sponsorsPath}/${fixture.sponsorId}/leads`;
    const liveLeads = await sponsor.request.get(leadsPath);
    expect(liveLeads.headers()["cache-control"]).toContain("no-store");
    const listed = sponsorLeadListSchema.parse(await liveLeads.json());
    expect(listed.leads).toHaveLength(1);
    expect(listed.leads[0]?.email).toBe(fixture.email);
    const exported = await sponsor.request.get(`${leadsPath}.csv`);
    expect(exported.status()).toBe(200);
    expect(exported.headers()["cache-control"]).toContain("no-store");
    expect(await exported.text()).toContain(fixture.email);
    expect((await sponsor.request.get(summaryPath)).status()).toBe(403);
    expect(attendanceSummarySchema.parse(await (await staff.request.get(summaryPath)).json()).observed).toEqual(
      reportBeforeLead.observed,
    );
    await inspectDevice(sponsor, sponsorConsole, "sponsor-authorized-live-view-and-export");
    await capturePilot(sponsor, info, "pilot-same-attendee-sponsor-capture");
    const withdrawn = await attendee.request.patch(managePath, {
      data: registrationManageSchema.parse({ action: "withdraw_sponsor_sharing" }),
    });
    expect(withdrawn.status()).toBe(200);
    expect(registrationManageUpdateResponseSchema.parse(await withdrawn.json()).sponsorSharing.allowed).toBe(false);
    expect(sponsorLeadListSchema.parse(await (await sponsor.request.get(leadsPath)).json()).leads).toHaveLength(0);
    expect(await (await sponsor.request.get(`${leadsPath}.csv`)).text()).not.toContain(fixture.email);
    // The closed session's diagnostics dialog sits over the lead workspace until dismissed.
    await closeScannerDiagnostics(sponsor);
    await sponsor.getByRole("button", { name: "Close scanner", exact: true }).click();
    await sponsor.reload();
    await sponsor.getByRole("button", { name: `Open leads for ${scope.name}`, exact: true }).click();
    await expect(sponsor.getByText("No currently consenting leads match this search.", { exact: true })).toBeVisible();
    await capturePilot(sponsor, info, "pilot-sharing-withdrawn");

    const finalSummaryResponse = await staff.request.get(summaryPath);
    expect(finalSummaryResponse.status()).toBe(200);
    const finalSummary = attendanceSummarySchema.parse(await finalSummaryResponse.json());
    expect(finalSummary.observed).toEqual(reportBeforeLead.observed);
    expect(finalSummary.sync).toMatchObject({
      completeness: "not_established",
      deviceBacklog: "complete",
      scannerReconciliation: {
        scope: "event",
        coverage: "from_event_creation",
        sourceState: "live",
        knownEpochs: 3,
        closedEpochs: 3,
        openEpochs: 0,
        closingEpochs: 0,
        unknownHighWaterEpochs: 0,
        missingDeclaredReceipts: 0,
        unprovenClosedEpochs: 0,
        untrackedAttempts: 0,
        unclosedGrants: 0,
        deviceBacklog: "complete",
      },
    });
    expect(finalSummary.evidence.presenceDuration).toBe("not_established");
    const attempts = attendanceAttemptsResponseSchema.parse(
      await (
        await staff.request.get(`/api/v1/events/${sponsorEventSlug}/attendance/attempts?limit=20&offset=0`)
      ).json(),
    );
    const ownAttempts = attempts.attempts.filter((row) => row.userId === fixture.consenting.userId);
    expect(ownAttempts.filter((row) => row.action === "admission")).toHaveLength(1);
    expect(ownAttempts.filter((row) => row.action === "attendance")).toHaveLength(1);
    const people = eventAttendancePeopleResponseSchema.parse(
      await (await staff.request.get(`/api/v1/events/${sponsorEventSlug}/attendance/people?limit=10&offset=0`)).json(),
    );
    expect(people.attendees.find((row) => row.userId === fixture.consenting.userId)).toMatchObject({
      observationCount: 1,
      reservedSessions: 1,
      savedSessions: 1,
    });
    const reportCsv = await staff.request.get(`/api/v1/events/${sponsorEventSlug}/attendance/people/exports`);
    expect(reportCsv.status()).toBe(200);
    expect(await reportCsv.text()).toContain(fixture.consenting.userId);
    await staff.goto(`/portal/#/groups/${event.ownerGroupId}/events/${event.id}/attendance`);
    await expect(staff.getByRole("heading", { name: "Attendance summary", exact: true })).toBeVisible();
    const correctedAttendance = await correctPilotAttendance(
      staff,
      door,
      sponsorEventSlug,
      source.title,
      originalScan,
      info,
    );
    expect(correctedAttendance.original.userId).toBe(fixture.consenting.userId);
    await staff.goto(`/portal/#/groups/${event.ownerGroupId}/events/${event.id}/attendance/diagnostics`);
    const synchronization = staff.getByRole("region", { name: "Attendance diagnostics", exact: true });
    await expect(synchronization.getByText("Uploads accounted for", { exact: true })).toBeVisible();
    await expect(synchronization).toContainText("Reconciliation covers the entire event.");
    await expect(synchronization).toContainText(
      "These records do not establish complete reporting or presence duration.",
    );
    await capturePilot(staff, info, "pilot-attributable-attendance-report");
    const profileSaving = speakerPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${speaker.path}/profile` && response.request().method() === "PATCH",
    );
    await speakerPage
      .getByRole("textbox", { name: "Biography", exact: true })
      .fill(
        "The same synthetic speaker updated their live biography after the rehearsal; their recorded appearance remains independently approved.",
      );
    await speakerPage.getByRole("button", { name: "Save profile", exact: true }).click();
    const profileSaved = await profileSaving;
    expect(profileSaved.status()).toBe(200);
    speakerSelfProfilePatchSchema.parse(profileSaved.request().postDataJSON());
    expect(speakerProfileUpdateResponseSchema.parse(await profileSaved.json()).profile.biography).toContain(
      "same synthetic speaker",
    );
    expect(
      speakerSelfServiceReadResponseSchema.parse(await (await speakerPage.request.get(speaker.path)).json()).speaker
        .userId,
    ).toBe(speaker.userId);
    expect(
      (await readPilotAgenda(staff)).occurrences
        .find((row) => row.id === source.id)
        ?.history?.appearances.find((appearance) => appearance.userId === speaker.userId),
    ).toEqual(frozenAppearance);
    const archived = await releasePilotArchive(
      staff,
      (await readPilotAgenda(staff)).occurrences.find((row) => row.id === source.id)!,
      info,
    );
    await openPilotAgenda(staff);
    await runAgendaAction(staff, "Review for publication");
    await staff.getByRole("button", { name: "Approve for publication", exact: true }).click();
    await expect(staff.getByRole("button", { name: "Approve for publication", exact: true })).toBeDisabled();
    const finalRelease = await publishE2eSite(staff, route);
    expect(finalRelease.snapshotId).not.toBe(release.snapshotId);
    const archiveRoute = publishedSessionRoute(sponsorEventSlug, archived.occurrence);
    if (!archiveRoute) throw new Error("The same approved session needs a stable public archive route");
    await publicPage.goto(archiveRoute);
    await expect(publicPage.getByRole("heading", { name: source.title, exact: true })).toBeVisible();
    await expect(publicPage.getByRole("link", { name: archived.title, exact: true })).toHaveAttribute(
      "href",
      archived.url,
    );
    await expect(publicPage.getByText(frozenAppearance!.displayName, { exact: true }).first()).toBeVisible();
    await expect(publicPage.getByText(/same synthetic speaker updated their live biography/)).toHaveCount(0);
    await capturePilot(publicPage, info, "pilot-public-archive-workflow");
    expect((await readPilotAgenda(staff)).occurrences.map((row) => row.id).sort()).toEqual(
      approved.occurrences.map((row) => row.id).sort(),
    );
    await inspectDevice(door, doorConsole, "door-final", true);
    await inspectDevice(sponsor, sponsorConsole, "sponsor-final-after-withdrawal", true);
    await writeFile(
      info.outputPath("integrated-pilot-receipt.json"),
      JSON.stringify(
        {
          kind: "pre_event_integrated_rehearsal",
          elapsedPostEventAcceptance: "open",
          eventId: event.id,
          meeting: { seriesId: meeting.seriesId, eventId: meeting.eventId, occurrenceIds: meeting.occurrenceIds },
          occurrenceIds: approved.occurrences.map((row) => row.id),
          attendeeUserId: fixture.consenting.userId,
          speakerUserId: speaker.userId,
          speakerProposalId: speaker.proposalId,
          sponsorId: fixture.sponsorId,
          operatorUserIds: [meeting.member.userId, fixture.operator.userId],
          doorGrantIds,
          approvedRevision: approved.publishedRevision,
          publicationSnapshotIds: [release.snapshotId, finalRelease.snapshotId],
          operations: [admission.operationId, originalScan.operationId, captured.request.operationId],
          observed: reportBeforeLead.observed,
          scannerClosures: [manualClosed, doorClosed, sponsorClosed],
          scannerReconciliation: finalSummary.sync.scannerReconciliation,
          attendanceCompleteness: finalSummary.sync.completeness,
          correctedAttendance,
          devicePrivacy,
          archiveRoute,
        },
        null,
        2,
      ),
    );
  } finally {
    for (const context of contexts) await context.close();
  }
});
