import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signInToPortal } from "./helpers/portal-auth";
import { scannerStorage, reconnectScannerBrowser } from "./helpers/scanner-recovery-storage";
import {
  enrolledEventScanRequestSchema,
  eventScanResponseSchema,
} from "../../assets/shared/schemas/event-participation-scanning";
import { attendanceSummarySchema } from "../../assets/shared/schemas/event-attendance-reporting";
import {
  prepareSponsorLiveFixture,
  captureSponsorBadge,
  captureSponsorViews,
  expectNoStoredSponsorContacts,
  sponsorEventSlug,
} from "./helpers/sponsor-live-fixture";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import {
  sponsorLeadSponsorsSchema,
  sponsorLeadListSchema,
  sponsorLeadCapturesSchema,
} from "../../assets/shared/schemas/event-sponsor-lead-list";
import {
  registrationManageSchema,
  registrationManageReadResponseSchema,
  registrationManageUpdateResponseSchema,
} from "../../assets/shared/schemas/registration";

/** Real mounted Worker/D1 and browser storage; no intercepted transport or injected grants. */
test("sponsor captures live consented contacts, exports them and loses disclosure after withdrawal and grant end", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(300_000);
  const staffContext = await browser.newContext({ baseURL: info.project.use.baseURL });
  const attendeeContext = await browser.newContext({ baseURL: info.project.use.baseURL });
  const staff = await staffContext.newPage();
  const attendee = await attendeeContext.newPage();
  try {
    const fixture = await prepareSponsorLiveFixture(staff, attendee);
    await signInToPortal(page, fixture.operator.email);
    const sessionResponse = await page.request.get("/api/v1/auth/session");
    expect(sessionResponse.status()).toBe(200);
    const session = userAuthSessionResponseSchema.parse(await sessionResponse.json());
    expect(session.identity.id).toBe(fixture.operator.userId);
    for (const permission of ["agenda:leads_capture", "agenda:leads_view", "agenda:leads_export"] as const)
      expect(session.staff?.grants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ permission, contextType: "event_sponsor", contextId: fixture.sponsorId }),
        ]),
      );
    const base = `/api/v1/events/${sponsorEventSlug}/sponsors`;
    const leadsPath = `${base}/${fixture.sponsorId}/leads`;
    const csvPath = `${base}/${fixture.sponsorId}/leads.csv`;
    const discovery = await page.request.get(`${base}/leads`);
    expect(discovery.status()).toBe(200);
    const sponsor = sponsorLeadSponsorsSchema
      .parse(await discovery.json())
      .sponsors.find((row) => row.id === fixture.sponsorId);
    expect(sponsor).toMatchObject({ canView: true, canCapture: true, canExport: true });
    if (!sponsor) throw new Error("Active sponsor was absent from its scoped operator's discovery");
    const openSponsor = async () => {
      await page.goto(fixture.workspace);
      await page.reload();
      await page.getByRole("button", { name: `Open leads for ${sponsor.name}`, exact: true }).click();
    };
    await openSponsor();
    await page.getByRole("button", { name: "Scan leads", exact: true }).click();
    await expect(page.getByLabel("Scan mode", { exact: true })).toHaveValue("lead");
    await page.getByLabel("Feedback pause", { exact: true }).selectOption("0");
    const first = await captureSponsorBadge(
      page,
      fixture.consenting.badgeId,
      fixture.sponsorId,
      fixture.operator.userId,
    );
    const second = await captureSponsorBadge(
      page,
      fixture.consenting.badgeId,
      fixture.sponsorId,
      fixture.operator.userId,
    );
    for (const scan of [first, second]) expect(scan.receipt).toMatchObject({ reason: "eligible", outcome: "eligible" });
    expect(second.request.operationId).not.toBe(first.request.operationId);
    // Sponsor-only capture deliberately has no attendee eligibility manifest or roster access.
    const attendancePath = `/api/v1/events/${sponsorEventSlug}/attendance/summary`;
    const attendanceBeforeResponse = await staff.request.get(attendancePath);
    expect(attendanceBeforeResponse.status()).toBe(200);
    const attendanceBefore = attendanceSummarySchema.parse(await attendanceBeforeResponse.json()).observed;
    await page.context().setOffline(true);
    let offlineRecords: Array<
      Awaited<ReturnType<typeof scannerStorage>>["pending"][number] & {
        scan: import("../../assets/shared/schemas/event-participation-scanning").EnrolledEventScanRequest;
      }
    > = [];
    try {
      for (const expectedCount of [1, 2]) {
        await page.getByLabel("Badge code", { exact: true }).fill(fixture.consenting.badgeId);
        await page
          .getByRole("checkbox", {
            name: "The attendee agrees to share their contact details with this sponsor.",
            exact: true,
          })
          .check();
        await page.getByRole("button", { name: "Capture lead", exact: true }).click();
        await expect(page.getByLabel("Badge code", { exact: true })).toHaveValue("");
        await expect(page.getByText(`${expectedCount} scans awaiting upload`, { exact: true })).toBeVisible();
        await expect.poll(async () => (await scannerStorage(page)).pending.length).toBe(expectedCount);
      }
      offlineRecords = (await scannerStorage(page)).pending
        .map((record) => ({ ...record, scan: enrolledEventScanRequestSchema.parse(record.scan) }))
        .sort((left, right) => left.scan.scannerSession.sequence - right.scan.scannerSession.sequence);
      expect(new Set(offlineRecords.map((record) => record.scan.operationId)).size).toBe(2);
      for (const record of offlineRecords) {
        expect(record.eventId).toBe(sponsorEventSlug);
        const scan = enrolledEventScanRequestSchema.parse(record.scan);
        expect(scan).toMatchObject({
          action: "lead",
          badgeId: fixture.consenting.badgeId,
          sponsorId: fixture.sponsorId,
          operatorUserId: fixture.operator.userId,
          consentConfirmed: true,
          occurrenceId: null,
        });
        expect(scan.offlineRight).toBeUndefined();
        expect(scan.recordAttendance).toBeUndefined();
        expect(scan.scannerSession.epochId).toBe(first.request.scannerSession.epochId);
        expect([first.request.operationId, second.request.operationId]).not.toContain(scan.operationId);
        expect((await scannerStorage(page)).history.some((row) => row.scan.operationId === scan.operationId)).toBe(
          false,
        );
      }
      expect(offlineRecords[1].scan.scannerSession.sequence).toBe(offlineRecords[0].scan.scannerSession.sequence + 1);
      // The local device cannot assert successful contact release before the server receipt.
      await expect(page.locator(".pk-event-scanner")).toHaveClass(/pk-event-scanner--unverified/);
      await expect(page.locator(".pk-event-scanner")).not.toContainText(/Lead captured|Registered|Unknown badge/);
      await expect(page.getByText(fixture.email, { exact: true })).toHaveCount(0);
      await expectNoStoredSponsorContacts(page, [
        fixture.email,
        fixture.deniedEmail,
        fixture.firstName,
        fixture.organization,
      ]);
      await captureSponsorViews(page, info, "offline-pending");
    } finally {
      await reconnectScannerBrowser(page.context(), page);
    }
    await page.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect.poll(async () => (await scannerStorage(page)).pending.length, { timeout: 30_000 }).toBe(0);
    const acknowledged = await scannerStorage(page);
    for (const record of offlineRecords) {
      const archived = acknowledged.history.find((row) => row.scan.operationId === record.scan.operationId);
      expect(archived).toBeDefined();
      expect(archived!.scan).toEqual(record.scan);
      expect(archived!.receipt).toMatchObject({
        operationId: record.scan.operationId,
        outcome: "eligible",
        reason: "eligible",
        recorded: true,
        attendanceRecorded: false,
        admissionRecorded: false,
        scannerReceipt: {
          operationId: record.scan.operationId,
          epochId: record.scan.scannerSession.epochId,
          sequence: record.scan.scannerSession.sequence,
        },
      });
      // A real mounted replay must return the immutable original acknowledgment, without another capture.
      const replay = await page.request.post(`/api/v1/events/${sponsorEventSlug}/scans`, {
        data: enrolledEventScanRequestSchema.parse(record.scan),
      });
      expect(replay.status()).toBe(200);
      expect(eventScanResponseSchema.parse(await replay.json())).toEqual(archived!.receipt);
    }
    await expect(page.getByText("0 scans awaiting upload", { exact: true })).toBeVisible();
    const attendanceAfterResponse = await staff.request.get(attendancePath);
    expect(attendanceAfterResponse.status()).toBe(200);
    expect(attendanceSummarySchema.parse(await attendanceAfterResponse.json()).observed).toEqual(attendanceBefore);
    await expectNoStoredSponsorContacts(page, [
      fixture.email,
      fixture.deniedEmail,
      fixture.firstName,
      fixture.organization,
    ]);
    await captureSponsorViews(page, info, "offline-reconciled");
    const denied = await captureSponsorBadge(page, fixture.denied.badgeId, fixture.sponsorId, fixture.operator.userId);
    expect(denied.receipt).toMatchObject({ reason: "missing_registration", outcome: "denied" });
    const stored = await scannerStorage(page);
    expect(stored.pending).toHaveLength(0);
    const operations = [
      ...[first, second, denied].map((scan) => scan.request.operationId),
      ...offlineRecords.map((record) => record.scan.operationId),
    ];
    expect(stored.history.filter((row) => operations.includes(row.scan.operationId))).toHaveLength(5);
    for (const scan of [first, second, denied]) {
      const archived = stored.history.find((row) => row.scan.operationId === scan.request.operationId)!;
      expect(archived.scan).toEqual(scan.request);
      expect(archived.receipt).toEqual(scan.receipt);
    }
    // Canonical badge UUIDs are allowed. Contact details and resolved person objects are not.
    await expectNoStoredSponsorContacts(page, [
      fixture.email,
      fixture.deniedEmail,
      fixture.firstName,
      fixture.organization,
    ]);
    await captureSponsorViews(page, info, "capture");
    await page.getByRole("button", { name: "Close scanner", exact: true }).click();
    await openSponsor();
    const listed = await page.request.get(leadsPath);
    expect(listed.status()).toBe(200);
    expect(listed.headers()["cache-control"]).toContain("no-store");
    const leads = sponsorLeadListSchema.parse(await listed.json());
    expect(leads.leads).toHaveLength(1);
    const lead = leads.leads[0];
    expect(lead).toMatchObject({
      userId: fixture.consenting.userId,
      email: fixture.email,
      name: `${fixture.firstName} ${fixture.lastName}`,
      organization: fixture.organization,
      operatorUserId: fixture.operator.userId,
    });
    expect(leads.leads.some((row) => row.userId === fixture.denied.userId)).toBe(false);
    const contacts = page.getByRole("region", { name: "Consenting leads", exact: true });
    await expect(contacts.getByText(fixture.email, { exact: true })).toBeVisible();
    const searched = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === leadsPath && url.searchParams.get("q") === fixture.email;
    });
    const search = page.getByRole("searchbox", { name: "Search consenting leads", exact: true });
    await search.fill(fixture.email);
    await search.press("Enter");
    const searchResponse = await searched;
    expect(searchResponse.status()).toBe(200);
    expect(sponsorLeadListSchema.parse(await searchResponse.json()).leads.map((row) => row.id)).toEqual([lead.id]);
    const capturesPath = `${leadsPath}/${lead.id}/captures`;
    const historyResponse = await page.request.get(capturesPath);
    expect(historyResponse.status()).toBe(200);
    const history = sponsorLeadCapturesSchema.parse(await historyResponse.json());
    expect(history.captures).toHaveLength(4);
    for (const row of history.captures) expect(row.operatorUserId).toBe(fixture.operator.userId);
    expect(history.captures.map((row) => row.observedAt).sort()).toEqual(
      [
        first.request.observedAt,
        second.request.observedAt,
        ...offlineRecords.map((record) => record.scan.observedAt),
      ].sort(),
    );
    await page.getByRole("button", { name: `View capture history for ${lead.name}`, exact: true }).click();
    await expect(page.getByRole("region", { name: "Lead capture history", exact: true })).toBeVisible();
    await captureSponsorViews(page, info, "live-history");
    const csvResponse = page.waitForResponse((response) => new URL(response.url()).pathname === csvPath);
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Sponsor actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Export consenting leads", exact: true }).click();
    const [csv, download] = await Promise.all([csvResponse, downloading]);
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    expect(csv.headers()["cache-control"]).toContain("no-store");
    expect(await download.failure()).toBeNull();
    const csvFile = await download.path();
    if (!csvFile) throw new Error("Actual consenting-lead export did not produce a download");
    const exported = await readFile(csvFile, "utf8");
    expect(exported).toContain(fixture.email);
    expect(exported).not.toContain(fixture.deniedEmail);

    // Withdraw sharing through the attendee's actual capability UI, keeping the registration active.
    await attendee.goto(fixture.manageUrl);
    const sharing = attendee.getByRole("group", { name: "Sponsor contact sharing", exact: true });
    await expect(sharing.getByText("Sharing enabled", { exact: true })).toBeVisible();
    const managePath = `/api/v1/registrations/access/${fixture.manageToken}`;
    const withdrawing = attendee.waitForResponse(
      (response) => new URL(response.url()).pathname === managePath && response.request().method() === "PATCH",
    );
    await sharing.getByRole("button", { name: "Withdraw sharing", exact: true }).click();
    const withdrawnResponse = await withdrawing;
    expect(withdrawnResponse.status()).toBe(200);
    expect(registrationManageSchema.parse(withdrawnResponse.request().postDataJSON())).toEqual({
      action: "withdraw_sponsor_sharing",
    });
    const withdrawal = registrationManageUpdateResponseSchema.parse(await withdrawnResponse.json()).sponsorSharing;
    expect(withdrawal.allowed).toBe(false);
    expect(withdrawal.withdrawnAt).not.toBeNull();
    await expect(sharing.getByText("Sharing withdrawn", { exact: true })).toBeVisible();
    await expect(sharing.getByRole("button", { name: "Withdraw sharing", exact: true })).toHaveCount(0);
    await captureSponsorViews(attendee, info, "withdrawal");
    const managedResponse = await attendee.request.get(managePath);
    expect(managedResponse.status()).toBe(200);
    const managed = registrationManageReadResponseSchema.parse(await managedResponse.json());
    expect(managed.registration.status).toBe("registered");
    expect(managed.sponsorSharing).toEqual(withdrawal);
    await attendee.reload();
    await expect(sharing.getByText("Sharing withdrawn", { exact: true })).toBeVisible();

    await openSponsor();
    await expect(page.getByText(fixture.email, { exact: true })).toHaveCount(0);
    const concealed = await page.request.get(leadsPath);
    expect(concealed.status()).toBe(200);
    expect(sponsorLeadListSchema.parse(await concealed.json()).leads).toHaveLength(0);
    const emptyCsv = await page.request.get(csvPath);
    expect(emptyCsv.status()).toBe(200);
    expect(await emptyCsv.text()).not.toContain(fixture.email);
    expect((await page.request.get(capturesPath)).status()).toBe(404);
    await captureSponsorViews(page, info, "withdrawn-live");
    await page.getByRole("button", { name: "Scan leads", exact: true }).click();
    await page.getByLabel("Feedback pause", { exact: true }).selectOption("0");
    const noConsent = await captureSponsorBadge(
      page,
      fixture.consenting.badgeId,
      fixture.sponsorId,
      fixture.operator.userId,
    );
    expect(noConsent.receipt).toMatchObject({ reason: "consent_required", outcome: "warning" });
    const retained = await scannerStorage(page);
    for (const scan of [first, second, denied]) {
      expect(retained.history.find((row) => row.scan.operationId === scan.request.operationId)?.receipt).toEqual(
        scan.receipt,
      );
    }
    for (const record of offlineRecords) {
      expect(retained.history.find((row) => row.scan.operationId === record.scan.operationId)?.receipt).toEqual(
        acknowledged.history.find((row) => row.scan.operationId === record.scan.operationId)!.receipt,
      );
    }
    await expectNoStoredSponsorContacts(page, [
      fixture.email,
      fixture.deniedEmail,
      fixture.firstName,
      fixture.organization,
    ]);
    // Ending the independent assignment makes both live reads and CSV fail under the unchanged operator cookie.
    for (const id of fixture.grants)
      expect((await staff.request.delete(`/api/v1/permissions/grants/${id}`)).status()).toBe(200);
    expect((await page.request.get(leadsPath)).status()).toBe(403);
    expect((await page.request.get(csvPath)).status()).toBe(403);
    await page.reload();
    await expect(page.getByText(fixture.email, { exact: true })).toHaveCount(0);
    await captureSponsorViews(page, info, "assignment-ended");
  } finally {
    await attendeeContext.close();
    await staffContext.close();
  }
});
