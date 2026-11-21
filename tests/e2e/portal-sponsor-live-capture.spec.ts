import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signInToPortal } from "./helpers/portal-auth";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";
import {
  closeScannerDiagnostics,
  openScannerDiagnostics,
  openScannerManualEntry,
  reconnectScannerBrowser,
  scannerStorage,
} from "./helpers/scanner-recovery-storage";
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
import { accessGrantCreateSchema, accessGrantCreateResponseSchema } from "../../assets/shared/schemas/access-control";
import { SCAN_STORAGE_VERSION } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/outbox-storage";
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
  let liveSponsor: Awaited<ReturnType<typeof prepareSponsorLiveFixture>> | undefined;
  try {
    const fixture = await prepareSponsorLiveFixture(staff, attendee);
    liveSponsor = fixture;
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
    const configureFeedbackPause = async () => {
      const diagnostics = await openScannerDiagnostics(page);
      await diagnostics.getByLabel("Feedback pause", { exact: true }).selectOption("0");
      await closeScannerDiagnostics(page);
    };
    await openSponsor();
    await page.getByRole("button", { name: "Scan leads", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start scanning", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Scan mode", exact: true })).toHaveCount(0);
    await configureFeedbackPause();
    const setupViewport = page.viewportSize();
    for (const [name, width, height] of [
      ["desktop", 1280, 900],
      ["phone", 375, 812],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page
        .locator(".pk-panel")
        .filter({ has: page.getByRole("button", { name: "Start scanning", exact: true }) })
        .last()
        .screenshot({ path: info.outputPath(`${name}-sponsor-setup-card.png`) });
    }
    if (setupViewport) await page.setViewportSize(setupViewport);
    const first = await captureSponsorBadge(
      page,
      fixture.consenting.badgeId,
      fixture.sponsorId,
      fixture.operator.userId,
      async () => {
        const confirmedLead = page.locator(".pk-scanner-lead-confirmation");
        await expect(confirmedLead).toContainText(`${fixture.firstName} ${fixture.lastName}`);
        await expect(confirmedLead).toContainText("Security engineer");
        await expect(confirmedLead).toContainText(fixture.organization);
        await expect(confirmedLead).not.toContainText(fixture.email);
        const originalViewport = page.viewportSize();
        await page.setViewportSize({ width: 375, height: 812 });
        await page
          .locator(".pk-panel")
          .filter({ has: page.getByRole("button", { name: "Next", exact: true }) })
          .last()
          .screenshot({ path: info.outputPath("phone-sponsor-confirmed-lead.png") });
        if (originalViewport) await page.setViewportSize(originalViewport);
      },
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
        await openScannerManualEntry(page);
        const manual = page.getByRole("dialog", { name: "Review sponsor lead", exact: true });
        await manual.getByLabel("Badge code", { exact: true }).fill(fixture.consenting.badgeId);
        await manual.getByRole("button", { name: "Confirm lead", exact: true }).click();
        await expect(manual).not.toBeVisible();
        await expect(page.getByRole("button", { name: "Next", exact: true })).toBeVisible();
        await expect(page.getByText("Saved for upload", { exact: true })).toBeVisible();
        await expect.poll(async () => (await scannerStorage(page)).pending.length).toBe(expectedCount);
        if (expectedCount === 1) {
          await page.getByRole("button", { name: "Next", exact: true }).click();
          await expect(
            page.getByRole("status", { name: "Scanner status", exact: true }).getByText("Offline · 1 awaiting upload"),
          ).toBeVisible();
          await openScannerManualEntry(page);
          await expect(manual.getByLabel("Badge code", { exact: true })).toHaveValue("");
          await expect(
            page.getByRole("checkbox", {
              name: "I will ask each person for permission to collect their contact information before scanning their badge.",
            }),
          ).toHaveCount(0);
          await manual.getByRole("button", { name: "Cancel", exact: true }).click();
          await expect(manual).not.toBeVisible();
        }
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
      await page.getByRole("button", { name: "Next", exact: true }).click();
    } finally {
      await reconnectScannerBrowser(page.context(), page);
    }
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
    await expect(page.getByRole("status", { name: "Scanner status", exact: true })).toHaveCount(0);
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
    const rawLeads = await listed.json();
    for (const row of rawLeads.leads) {
      expect(row).not.toHaveProperty("userId");
      expect(row).not.toHaveProperty("operatorUserId");
    }
    expect(JSON.stringify(rawLeads)).not.toContain(fixture.denied.userId);
    const leads = sponsorLeadListSchema.parse(rawLeads);
    expect(leads.leads).toHaveLength(1);
    const lead = leads.leads[0];
    expect(lead).toMatchObject({
      email: fixture.email,
      name: `${fixture.firstName} ${fixture.lastName}`,
      organization: fixture.organization,
    });
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
    const rawHistory = await historyResponse.json();
    for (const row of rawHistory.captures) expect(row).not.toHaveProperty("operatorUserId");
    const history = sponsorLeadCapturesSchema.parse(rawHistory);
    expect(history.captures).toHaveLength(4);
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

    for (const id of fixture.grants.slice(1))
      expect((await staff.request.delete(`/api/v1/permissions/grants/${id}`)).status()).toBe(200);
    await openSponsor();
    await expect(page.getByText("My lead scans", { exact: true })).toBeVisible();
    await expect(page.getByText("1 saved lead", { exact: false })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "My lead scans", exact: true }).getByText(fixture.email),
    ).toBeVisible();
    await captureSponsorViews(page, info, "own-scans");
    for (const [index, permission] of [
      [1, "agenda:leads_view"],
      [2, "agenda:leads_export"],
    ] as const) {
      const renewed = await staff.request.post("/api/v1/permissions/grants", {
        data: accessGrantCreateSchema.parse({
          userId: fixture.operator.userId,
          permission,
          contextType: "event_sponsor",
          contextId: fixture.sponsorId,
        }),
      });
      expect(renewed.status()).toBe(201);
      fixture.grants[index] = accessGrantCreateResponseSchema.parse(await renewed.json()).grant.id;
    }
    await openSponsor();

    // Withdraw sharing through the attendee's actual capability UI, keeping the registration active.
    await attendee.goto(fixture.manageUrl);
    const sharing = attendee.getByRole("group", { name: "Sponsor contact sharing", exact: true });
    await expect(sharing.getByText("Sharing enabled", { exact: true })).toBeVisible();
    const managePath = `/api/v1/registrations/access/${fixture.manageToken}`;
    const withdrawing = attendee.waitForResponse(
      (response) => new URL(response.url()).pathname === managePath && response.request().method() === "PATCH",
    );
    await sharing.getByRole("button", { name: "Withdraw sharing…", exact: true }).click();
    await acceptConfirmDialog(attendee, "Withdraw sharing");
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
    await configureFeedbackPause();
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
    await liveSponsor?.end();
    await attendeeContext.close();
    await staffContext.close();
  }
});

test("a prepared sponsor lead scanner reopens after an offline reload without exposing attendee data", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(300_000);
  const staffContext = await browser.newContext({ baseURL: info.project.use.baseURL });
  const attendeeContext = await browser.newContext({ baseURL: info.project.use.baseURL });
  const staff = await staffContext.newPage();
  const attendee = await attendeeContext.newPage();
  let liveSponsor: Awaited<ReturnType<typeof prepareSponsorLiveFixture>> | undefined;
  try {
    const fixture = await prepareSponsorLiveFixture(staff, attendee);
    liveSponsor = fixture;
    await signInToPortal(page, fixture.operator.email);
    await page.goto(`/portal/#/events/${sponsorEventSlug}/sponsors/${fixture.sponsorId}/scanner`);
    await expect(page.getByRole("button", { name: "Start scanning", exact: true })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          async ({ version, sponsorId }) => {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const request = indexedDB.open("pkic-scanner-outbox", version);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error ?? new Error("Could not open scanner storage"));
            });
            try {
              const contexts = await new Promise<unknown[]>((resolve, reject) => {
                const request = db.transaction("scanner-epochs").objectStore("scanner-epochs").getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error ?? new Error("Could not read scanner storage"));
              });
              return contexts.some((record) =>
                (
                  record as { collectorContexts?: Array<{ action: string; sponsorId?: string }> }
                ).collectorContexts?.some((context) => context.action === "lead" && context.sponsorId === sponsorId),
              );
            } finally {
              db.close();
            }
          },
          { version: SCAN_STORAGE_VERSION, sponsorId: fixture.sponsorId },
        ),
      )
      .toBe(true);
    await page.evaluate(async () => navigator.serviceWorker.ready);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.context().setOffline(true);
    await page.goto("/portal/");
    await expect(page.getByRole("heading", { name: "Continue scanning offline", exact: true })).toBeVisible();
    const task = page.getByRole("link", { name: /Lead scanner/ });
    await expect(task).toContainText("Synthetic sponsor");
    await page.screenshot({ animations: "disabled", path: info.outputPath("sponsor-offline-entry-phone.png") });
    await task.click();
    const acknowledgement = page.getByRole("checkbox", {
      name: "I will ask each person for permission to collect their contact information before scanning their badge.",
      exact: true,
    });
    await expect(acknowledgement).toBeVisible();
    await acknowledgement.check();
    await page.getByRole("button", { name: "Start scanning", exact: true }).click();
    await openScannerManualEntry(page);
    const manual = page.getByRole("dialog", { name: "Continuous badge scanner", exact: true });
    await manual.getByLabel("Badge code", { exact: true }).fill(fixture.consenting.badgeId);
    await manual.getByRole("button", { name: "Confirm lead", exact: true }).click();
    await expect(page.locator(".pk-fast-scanner__label")).toHaveText("Saved for upload");
    await expect.poll(async () => (await scannerStorage(page)).pending.length).toBe(1);
    await expect(page.getByText(fixture.email, { exact: true })).toHaveCount(0);
    await expectNoStoredSponsorContacts(page, [fixture.email, fixture.firstName, fixture.organization]);
    await page.screenshot({ animations: "disabled", path: info.outputPath("sponsor-offline-reopened-phone.png") });
  } finally {
    await page.context().setOffline(false);
    await liveSponsor?.end();
    await attendeeContext.close();
    await staffContext.close();
  }
});
