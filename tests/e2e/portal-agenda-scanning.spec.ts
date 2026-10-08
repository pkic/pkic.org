import { generateBadgeCredential } from "../../assets/shared/schemas/badge-credential";
import { SCAN_STORAGE_VERSION } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/outbox-storage";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { archivedScanSchema } from "../../assets/shared/schemas/event-scan-recovery";
import { expect, test, type Page, type Response, type TestInfo } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { registerInBrowser } from "./helpers/registration";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";
import {
  eventScanRequestSchema,
  eventScanResponseSchema,
  offlineScanRecordSchema,
} from "../../assets/shared/schemas/event-participation-scanning";
import {
  badgeCredentialMetadataSchema,
  badgeCredentialsQuerySchema,
  badgeCredentialsResponseSchema,
  badgeIssueRequestSchema,
  badgeIssueResponseSchema,
} from "../../assets/shared/schemas/route-contracts-event-badges";
import { registrationCreateSchema } from "../../assets/shared/schemas/registration";
import { agendaRevisionSchema, agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { enrolledOfflineEligibilityResponseSchema } from "../../assets/shared/schemas/event-offline-eligibility";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";
import {
  openScannerDiagnostics,
  closeScannerDiagnostics,
  openScannerManualEntry,
  openScannerRecovery,
} from "./helpers/scanner-recovery-storage";

const slug = "pqc-conference-amsterdam-nl";
const scannerPath = `/portal/#/events/${slug}/scanner`;
const badgesPath = `/portal/#/events/${slug}/badges`;
const badgesApi = `/api/v1/events/${slug}/badges`;
test.use({ actionTimeout: 20_000 });

function badgeResponse(page: Page, path = badgesApi, method = "GET") {
  return page.waitForResponse(
    (response) => new URL(response.url()).pathname === path && response.request().method() === method,
  );
}

async function badgeMenu(page: Page, menu: string, action: string) {
  await page.getByRole("button", { name: menu, exact: true }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

async function issueRenderedBadge(page: Page, decoderUrl: string, email?: string) {
  if (email) {
    await page.getByRole("textbox", { name: /^Attendee/ }).fill(email);
    await page.getByRole("button").filter({ hasText: email }).click();
  }
  const issuedResponse = badgeResponse(page, badgesApi, "POST");
  await page.getByRole("button", { name: email ? "Create badge QR" : "Replace badge QR", exact: true }).click();
  const response = await issuedResponse;
  expect(response.status(), await response.text()).toBe(200);
  const request = badgeIssueRequestSchema.parse(response.request().postDataJSON());
  const badge = badgeIssueResponseSchema.parse(await response.json());
  if (badge.result !== "issued") throw new Error("A new operation must return a fresh printable credential");
  const qr = page.getByRole("img", { name: "Attendee badge QR code", exact: true });
  await expect(qr).toBeVisible();
  await expect.poll(() => qr.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  // Decode the displayed image's actual pixels with the shipped camera fallback, without supplying the expected code.
  const decoded = await qr.evaluate(async (element, moduleUrl) => {
    Reflect.deleteProperty(globalThis, "BarcodeDetector");
    const image = element as HTMLImageElement;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not read rendered badge pixels");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { default: scanner } = await import(moduleUrl);
    const result = await scanner.scanImage(canvas, { returnDetailedScanResult: true });
    return result.data as string;
  }, decoderUrl);
  expect(decoded).toBe(badge.credential);
  expect(badge.credential).not.toBe(badge.id);
  const preview = page.frameLocator('iframe[title="Attendee badge print preview"]');
  await expect(preview.getByRole("img", { name: "Attendee badge QR code", exact: true })).toHaveAttribute(
    "src",
    (await qr.getAttribute("src"))!,
  );
  await expect(preview.getByText(badge.id, { exact: true })).toBeVisible();
  await expect(preview.locator("body")).not.toContainText(decoded);
  if (email) await expect(preview.locator("body")).not.toContainText(email);
  const persistentIssuerStorage = await page.evaluate(() =>
    JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
  );
  expect(persistentIssuerStorage).not.toContain(badge.credential);
  return { badge, request };
}

async function assertMetadataOnly(
  response: Pick<Response, "status" | "text" | "json">,
  credentials: readonly string[],
) {
  expect(response.status(), await response.text()).toBe(200);
  const raw: unknown = await response.json();
  const serialized = JSON.stringify(raw);
  for (const credential of credentials) expect(serialized).not.toContain(credential);
  return raw;
}

async function captureBadgeScreens(page: Page, testInfo: TestInfo, state: string) {
  const originalViewport = page.viewportSize();
  try {
    for (const viewport of [
      { name: "desktop", width: 1280, height: 900 },
      { name: "phone", width: 390, height: 844 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.evaluate(async () => {
        window.scrollTo(0, 0);
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(viewport.width);
      await page.screenshot({
        animations: "disabled",
        fullPage: true,
        path: testInfo.outputPath(`badge-${state}-${viewport.name}.png`),
      });
    }
  } finally {
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
}

async function selectReloadedBadge(
  page: Page,
  id: string,
  credentials: readonly string[],
  captureList?: () => Promise<void>,
) {
  await page.goto(badgesPath);
  const listed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === badgesApi &&
      response.request().method() === "GET" &&
      new URL(response.url()).searchParams.get("q") === id,
  );
  await page.getByRole("searchbox", { name: "Search badge credentials", exact: true }).fill(id);
  await page.getByRole("searchbox", { name: "Search badge credentials", exact: true }).press("Enter");
  const response = await listed;
  const query = badgeCredentialsQuerySchema.parse(Object.fromEntries(new URL(response.url()).searchParams));
  expect(query).toMatchObject({ q: id, offset: 0, sort: "-createdAt" });
  const list = badgeCredentialsResponseSchema.parse(await assertMetadataOnly(response, credentials));
  expect(list.badges.map((badge) => badge.id)).toEqual([id]);
  expect(list.page.total).toBe(1);
  const reloaded = badgeResponse(page);
  await page.reload();
  const restored = await reloaded;
  expect(new URL(restored.url()).searchParams.get("q")).toBe(id);
  expect(badgeCredentialsResponseSchema.parse(await assertMetadataOnly(restored, credentials)).badges).toEqual(
    list.badges,
  );
  const row = page.getByRole("region", { name: "Badge credentials", exact: true }).locator(`a[href*="/badges/${id}"]`);
  await expect(row).toBeVisible();
  if (captureList) await captureList();
  const detail = badgeResponse(page, `${badgesApi}/${id}`);
  await row.click();
  const metadata = badgeCredentialMetadataSchema.parse(await assertMetadataOnly(await detail, credentials));
  expect(metadata.id).toBe(id);
  await expect(page.getByRole("heading", { name: "Badge credential", exact: true })).toBeVisible();
  const reloadedDetail = badgeResponse(page, `${badgesApi}/${id}`);
  await page.reload();
  expect(badgeCredentialMetadataSchema.parse(await assertMetadataOnly(await reloadedDetail, credentials))).toEqual(
    metadata,
  );
  await expect(page.getByText(id, { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Attendee badge QR code", exact: true })).toHaveCount(0);
  await expect(page.getByTitle("Attendee badge print preview", { exact: true })).toHaveCount(0);
  for (const credential of credentials) await expect(page.getByText(credential, { exact: true })).toHaveCount(0);
  return metadata;
}

async function scanAttendance(page: Page, credential: string, publishedRevision: number) {
  await openScannerDiagnostics(page);
  await expect(
    page.getByText("Eligibility data ready. Checks run locally; attendance uploads in the background.", {
      exact: true,
    }),
  ).toBeVisible();
  await closeScannerDiagnostics(page);
  await openScannerManualEntry(page);
  await page.getByLabel("Badge code", { exact: true }).fill(credential);
  const uploaded = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1/events/${slug}/scans` &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.badgeId === credential,
  );
  await page.getByRole("button", { name: "Record attendance", exact: true }).click();
  const response = await uploaded;
  expect(response.status(), await response.text()).toBe(200);
  const request = eventScanRequestSchema.parse(response.request().postDataJSON());
  expect(request).toMatchObject({
    badgeId: credential,
    action: "attendance",
    occurrenceId: null,
    capturePublicationRevision: publishedRevision,
  });
  const receipt = eventScanResponseSchema.parse(await response.json());
  expect(receipt.operationId).toBe(request.operationId);
  await expect(page.getByText("0 scans awaiting upload", { exact: true })).toBeVisible();
  await expect(page.locator(".pk-event-scanner")).not.toContainText(/upload pending/i);
  return receipt;
}

async function queuedRecords(page: Page) {
  return page.evaluate(async (storageVersion) => {
    const opening = indexedDB.open("pkic-scanner-outbox", storageVersion);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error ?? new Error("Could not open scanner queue"));
    });
    try {
      const read = db.transaction("scans").objectStore("scans").getAll();
      return await new Promise<unknown[]>((resolve, reject) => {
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error ?? new Error("Could not read scanner queue"));
      });
    } finally {
      db.close();
    }
  }, SCAN_STORAGE_VERSION);
}

test("phone scanner retains an IDs-only offline scan and acknowledges it after reconnect", async ({
  page,
  context,
}, testInfo) => {
  await signInAsE2eStaff(page, e2eAdminEmail("default"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(scannerPath);
  await expect(page.getByRole("heading", { name: "Badge scanner", exact: true })).toBeVisible();
  const recovery = page.getByRole("dialog", { name: "Recovery and diagnostics", exact: true });
  await expect(recovery).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Enter or paste badge code", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent scans", exact: true })).toBeVisible();
  await openScannerDiagnostics(page);
  await expect(
    page.getByText("Eligibility data ready. Checks run locally; attendance uploads in the background.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? "")).not.toBe("");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration("/portal/");
        return registration?.active?.state ?? "";
      }),
    )
    .toBe("activated");
  await closeScannerDiagnostics(page);
  await expect(page.getByLabel("Scan mode", { exact: true })).toHaveValue("attendance");
  await expect(recovery).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: /Prepare offline admission|Allocate for one hour|Review admission exception/ }),
  ).toHaveCount(0);
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("scanner-simple-operator-phone.png") });
  await context.setOffline(true);
  const badgeId = generateBadgeCredential();
  await openScannerManualEntry(page);
  await page.getByLabel("Badge code", { exact: true }).fill(badgeId);
  await page.getByRole("button", { name: "Record attendance", exact: true }).click();
  await expect(page.getByText("1 scans awaiting upload", { exact: true })).toBeVisible();
  await expect(page.getByText("Unknown badge", { exact: true })).toBeVisible();
  const records = await queuedRecords(page);
  expect(records).toHaveLength(1);
  const record = offlineScanRecordSchema
    .extend({
      leaseUntil: z.number(),
      owner: z.string().nullable(),
      attempts: z.number().optional(),
      nextAttemptAt: z.number().optional(),
    })
    .parse(records[0]);
  expect(record.scan.badgeId).toBe(badgeId);
  expect(record.scan.action).toBe("attendance");
  expect(record.scan.offlineRight).toBeUndefined();
  expect(Object.keys(record.scan)).not.toEqual(expect.arrayContaining(["email", "name", "contacts"]));
  const shellPage = await context.newPage();
  const shell = await shellPage.goto("/portal/");
  expect(shell?.status()).toBe(200);
  expect(shell?.headers()["content-type"]).toContain("text/html");
  expect(await shell?.text()).toContain('id="portal-app"');
  await shellPage.close();
  await context.setOffline(false);
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(page.getByText("Unknown badge", { exact: true })).toBeVisible();
  await expect(page.getByText("0 scans awaiting upload", { exact: true })).toBeVisible();
  expect(await queuedRecords(page)).toHaveLength(0);
  const retained = await page.evaluate(async (storageVersion) => {
    const opening = indexedDB.open("pkic-scanner-outbox", storageVersion);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error ?? new Error("History open failed"));
    });
    try {
      const read = db.transaction("history").objectStore("history").getAll();
      return await new Promise<unknown[]>((resolve, reject) => {
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error ?? new Error("History read failed"));
      });
    } finally {
      db.close();
    }
  }, SCAN_STORAGE_VERSION);
  expect(retained).toHaveLength(1);
  const archived = archivedScanSchema.parse(retained[0]);
  expect(archived.scan.operationId).toBe(record.scan.operationId);
  expect(archived.scan.observedAt).toBe(record.scan.observedAt);
  expect(archived.receipt).toMatchObject({ outcome: "unknown", recorded: false, attendanceRecorded: false });
  expect(archived.expiresAt - archived.acknowledgedAt).toBeGreaterThanOrEqual(14 * 24 * 60 * 60 * 1000);
  await openScannerRecovery(page);
  await expect(
    page.getByText("1 uploaded scans available for this event and your account.", { exact: true }),
  ).toBeVisible();
  const replay = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1/events/${slug}/scans` && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Restore uploaded scans", exact: true }).click();
  const replayResponse = await replay;
  expect(replayResponse.request().postDataJSON()).toMatchObject({
    operationId: record.scan.operationId,
    observedAt: record.scan.observedAt,
  });
  expect(await replayResponse.json()).toMatchObject({ operationId: record.scan.operationId, outcome: "unknown" });
  await expect(page.getByText("0 scans awaiting upload", { exact: true })).toBeVisible();

  expect(
    await page.evaluate(async () => {
      const cachesForScanner = await caches.keys();
      const paths: string[] = [];
      for (const name of cachesForScanner.filter((value) => value.startsWith("pkic-scanner-"))) {
        paths.push(...(await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname));
      }
      return paths.filter((path) => path.startsWith("/api/"));
    }),
  ).toEqual([]);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("organizer reloads two independent QR credentials, replaces only one and revokes the selected replacement", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const templateEmail = `badge-template-${randomUUID()}@example.test`;
  const template = await registerInBrowser(page, templateEmail);
  const email = `scanner-${randomUUID()}@example.test`;
  const since = await capturedEmailCount();
  const registration = await page.request.post(`/api/v1/events/${slug}/registrations`, {
    data: registrationCreateSchema.parse({
      ...template.request,
      email,
      attendanceType: "in_person",
      dayAttendance: template.request.dayAttendance?.map((day) => ({ ...day, attendanceType: "in_person" })),
    }),
  });
  expect(registration.status(), await registration.text()).toBe(200);
  const confirmation = await waitForCapturedEmail(email, "Confirm your registration", { since });
  await page.goto(extractEmailUrl(confirmation, "/register/confirm"));
  await page.getByRole("button", { name: /Confirm my registration/i }).click();
  await waitForCapturedEmail(email, "registration is confirmed", { since });
  await signInAsE2eStaff(page, e2eAdminEmail("default"));
  // Reuse earlier scenarios' approved capture context without publishing their current draft.
  const draftResponse = await page.request.get(`/api/v1/events/${slug}/agenda`);
  expect(draftResponse.status(), await draftResponse.text()).toBe(200);
  const draft = agendaSnapshotSchema.parse(await draftResponse.json());
  let basis = draft;
  if (draft.publishedRevision === null) {
    expect(draft.occurrences).toHaveLength(0);
    const approvalResponse = await page.request.post(`/api/v1/events/${slug}/agenda/publications`, {
      data: agendaRevisionSchema.parse({ expectedRevision: draft.revision }),
    });
    expect(approvalResponse.status(), await approvalResponse.text()).toBe(200);
    basis = agendaSnapshotSchema.parse(await approvalResponse.json());
    expect(basis.revision).toBe(draft.revision + 1);
    expect(basis.publishedRevision).toBe(basis.revision);
  }
  const publishedRevision = basis.publishedRevision;
  if (publishedRevision === null) throw new Error("The scanner fixture requires an actual approved capture context");
  const preparedResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1/events/${slug}/offline-eligibility` &&
      response.request().method() === "GET",
  );
  await page.goto(scannerPath);
  const prepared = await preparedResponse;
  expect(prepared.status(), await prepared.text()).toBe(200);
  expect(enrolledOfflineEligibilityResponseSchema.parse(await prepared.json())).toMatchObject({
    publishedRevision,
    occurrenceId: null,
  });
  const diagnostics = await openScannerDiagnostics(page);
  await expect(diagnostics.getByText("Offline camera files prepared.", { exact: true })).toBeVisible();
  const decoderUrl = await page.evaluate(async () => {
    const cache = await caches.open("pkic-scanner-shell-v1");
    return (await cache.keys()).map((request) => request.url).find((url) => /\/qr-scanner\.min\.[^/]+\.js$/u.test(url));
  });
  if (!decoderUrl) throw new Error("The shipped QR decoder was not prepared");
  await page.goto(badgesPath);
  await page.getByRole("button", { name: "Create badge", exact: true }).click();
  const first = await issueRenderedBadge(page, decoderUrl, email);
  expect(first.request.replaceBadgeId).toBeUndefined();
  expect(first.badge.replacedBadgeId).toBeNull();
  await captureBadgeScreens(page, testInfo, "issued-qr");
  await badgeMenu(page, "Badge actions", "Back to badges");
  await page.getByRole("button", { name: "Create badge", exact: true }).click();
  const second = await issueRenderedBadge(page, decoderUrl, email);
  expect(second.request.userId).toBe(first.request.userId);
  expect(second.request.operationId).not.toBe(first.request.operationId);
  expect(second.request.replaceBadgeId).toBeUndefined();
  expect(second.badge.replacedBadgeId).toBeNull();
  expect(second.badge.id).not.toBe(first.badge.id);
  expect(second.badge.credential).not.toBe(first.badge.credential);
  const replayResponse = await page.request.post(badgesApi, { data: badgeIssueRequestSchema.parse(second.request) });
  expect(replayResponse.status(), await replayResponse.text()).toBe(200);
  expect(badgeIssueResponseSchema.parse(await replayResponse.json())).toEqual({
    result: "replayed",
    id: second.badge.id,
    credential: null,
    expiresAt: second.badge.expiresAt,
    replacedBadgeId: null,
  });
  const credentials = [first.badge.credential, second.badge.credential];
  const ownedQuery = badgeCredentialsQuerySchema.parse({ userId: first.request.userId, limit: 2, offset: 0 });
  const ownedResponse = await page.request.get(
    `${badgesApi}?${new URLSearchParams({ userId: ownedQuery.userId!, limit: String(ownedQuery.limit), offset: "0" })}`,
  );
  const owned = badgeCredentialsResponseSchema.parse(await assertMetadataOnly(ownedResponse, credentials));
  expect(owned.page).toMatchObject({ total: 2, limit: 2, offset: 0, hasMore: false });
  expect(owned.badges.map(({ id }) => id).sort()).toEqual([first.badge.id, second.badge.id].sort());
  for (const badge of owned.badges) expect(badge).toMatchObject({ userId: first.request.userId, status: "active" });

  expect(
    await selectReloadedBadge(page, first.badge.id, credentials, () =>
      captureBadgeScreens(page, testInfo, "metadata-list"),
    ),
  ).toMatchObject({ status: "active" });
  await badgeMenu(page, "Record actions", "Replace credential");
  await expect(page.getByRole("heading", { name: "Replace badge credential", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^Attendee/ })).toHaveCount(0);
  const replacement = await issueRenderedBadge(page, decoderUrl);
  expect(replacement.request).toMatchObject({ userId: first.request.userId, replaceBadgeId: first.badge.id });
  expect(replacement.badge.replacedBadgeId).toBe(first.badge.id);
  expect(replacement.badge.id).not.toBe(first.badge.id);
  expect(credentials).not.toContain(replacement.badge.credential);
  credentials.push(replacement.badge.credential);
  await captureBadgeScreens(page, testInfo, "replacement-qr");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(scannerPath);
  expect(await scanAttendance(page, first.badge.credential, publishedRevision)).toMatchObject({
    outcome: "denied",
    reason: "revoked_badge",
    recorded: true,
    attendanceRecorded: false,
  });
  await expect(page.getByText("Badge not valid", { exact: true })).toBeVisible();
  for (const credential of [replacement.badge.credential, second.badge.credential]) {
    expect(await scanAttendance(page, credential, publishedRevision)).toMatchObject({
      outcome: "eligible",
      reason: "eligible",
      recorded: true,
      attendanceRecorded: true,
      admissionRecorded: false,
    });
    await expect(page.getByText("Registered · attendance recorded", { exact: true })).toBeVisible();
  }
  expect(await selectReloadedBadge(page, replacement.badge.id, credentials)).toMatchObject({ status: "active" });
  await captureBadgeScreens(page, testInfo, "selected-credential");
  await badgeMenu(page, "Record actions", "Revoke credential");
  const revoked = badgeResponse(page, `${badgesApi}/${replacement.badge.id}`, "DELETE");
  const refreshedDetail = badgeResponse(page, `${badgesApi}/${replacement.badge.id}`);
  await acceptConfirmDialog(page, "Revoke credential");
  expect((await revoked).status()).toBe(200);
  const revokedMetadata = badgeCredentialMetadataSchema.parse(
    await assertMetadataOnly(await refreshedDetail, credentials),
  );
  expect(revokedMetadata).toMatchObject({
    id: replacement.badge.id,
    status: "revoked",
    revokedAt: expect.any(String),
  });
  await expect(
    page
      .getByRole("heading", { name: "Badge credential", exact: true })
      .locator("..")
      .getByText("Revoked", { exact: true }),
  ).toBeVisible();
  const revokedDetail = badgeResponse(page, `${badgesApi}/${replacement.badge.id}`);
  await page.reload();
  expect(badgeCredentialMetadataSchema.parse(await assertMetadataOnly(await revokedDetail, credentials))).toEqual(
    revokedMetadata,
  );
  await expect(page.getByRole("img", { name: "Attendee badge QR code", exact: true })).toHaveCount(0);
  await page.goto(scannerPath);
  expect(await scanAttendance(page, replacement.badge.credential, publishedRevision)).toMatchObject({
    outcome: "denied",
    reason: "revoked_badge",
    recorded: true,
    attendanceRecorded: false,
  });
  expect(await scanAttendance(page, second.badge.credential, publishedRevision)).toMatchObject({
    outcome: "eligible",
    reason: "eligible",
    recorded: true,
    attendanceRecorded: true,
  });
  const afterResponse = await page.request.get(`/api/v1/events/${slug}/agenda`);
  expect(afterResponse.status(), await afterResponse.text()).toBe(200);
  expect(agendaSnapshotSchema.parse(await afterResponse.json())).toMatchObject({
    revision: basis.revision,
    publishedRevision,
  });
});
