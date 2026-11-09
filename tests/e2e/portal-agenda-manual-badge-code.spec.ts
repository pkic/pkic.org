import { createGenericBadgeTemplate } from "../../assets/shared/badge-generic-template";
import { compileBadgeTemplate } from "../../assets/shared/badge-template-render";
import { scannerOfflineContextSchema } from "../../assets/shared/schemas/event-scanner-offline-context";
import { SCAN_STORAGE_VERSION } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/outbox-storage";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import jsQR from "jsqr";
import { expect, test, type Page, type Locator } from "@playwright/test";
import { formatBadgeCredential, badgeCredentialSchema } from "../../assets/shared/schemas/badge-credential";
import {
  badgeCredentialMetadataSchema,
  badgeIssueRequestSchema,
  badgeIssueResponseSchema,
  badgeCredentialsResponseSchema,
  badgeLabelRequestSchema,
  badgePrintResponseSchema,
} from "../../assets/shared/schemas/route-contracts-event-badges";
import { enrolledOfflineEligibilityResponseSchema } from "../../assets/shared/schemas/event-offline-eligibility";
import {
  enrolledEventScanRequestSchema,
  eventScanResponseSchema,
} from "../../assets/shared/schemas/event-participation-scanning";
import {
  attendanceSummarySchema,
  attendanceAttemptQuerySchema,
  attendanceAttemptsResponseSchema,
} from "../../assets/shared/schemas/event-attendance-reporting";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { eventManagementDetailResponseSchema } from "../../assets/shared/schemas/event-management";
import { registrationManageReadResponseSchema } from "../../assets/shared/schemas/registration";
import { prepareScannerTermination } from "./helpers/scanner-browser-termination";
import {
  scannerStorage,
  openScannerDiagnostics,
  openScannerManualEntry,
  openScannerSessionDetails,
} from "./helpers/scanner-recovery-storage";
import { expectNoStoredSponsorContacts } from "./helpers/sponsor-live-fixture";
import { captureDeviceConsole } from "./helpers/device-console";
import { checkScannerSyncStatus } from "./helpers/scanner-sync-status";
import { checkWebKitOfflineScanner } from "./helpers/scanner-webkit-offline";

test.use({ actionTimeout: 20_000 });

async function metadata(page: Page, endpoint: string, credential: string) {
  const response = await page.request.get(endpoint);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const raw = await response.json();
  expect(JSON.stringify(raw)).not.toContain(credential);
  return badgeCredentialMetadataSchema.parse(raw);
}

async function decodeRenderedQr(image: Locator) {
  const pixels = await sharp(await image.screenshot())
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(pixels.data), pixels.info.width, pixels.info.height)?.data;
}

/** Decodes only the rendered protected SVG's actual pixels, without supplying an expected credential. */
async function preparePrintedBadge(page: Page, endpoint: string, credential: string, open: () => Promise<unknown>) {
  const labelsEndpoint = endpoint.slice(0, endpoint.lastIndexOf("/")) + "/labels";
  const printing = page
    .waitForResponse(
      (response) => new URL(response.url()).pathname === labelsEndpoint && response.request().method() === "POST",
    )
    .then(async (response) => {
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toContain("no-store");
      return {
        request: badgeLabelRequestSchema.parse(response.request().postDataJSON()),
        artifact: badgePrintResponseSchema.parse(await response.json()),
      };
    });
  await open();
  const printed = await printing;
  expect(printed.request).toMatchObject({ source: "badge", badgeId: endpoint.slice(endpoint.lastIndexOf("/") + 1) });
  await expect(page.getByRole("button", { name: "Prepare print preview", exact: true })).toHaveCount(0);
  const preview = page.frameLocator('iframe[title="Attendee badge print preview"]');
  for (const label of ["Badge front", "Badge back"]) {
    const side = preview.getByLabel(label, { exact: true });
    const image = side.getByRole("img");
    await expect(image).toHaveCount(1);
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(0);
    expect(await decodeRenderedQr(image), `${label} must encode the original credential`).toBe(credential);
    const vector = await image.evaluate((element) => {
      const reference = element.querySelector("use")?.getAttribute("href");
      const resource = reference?.startsWith("#") ? element.ownerDocument.getElementById(reference.slice(1)) : element;
      return {
        namespace: element.namespaceURI,
        viewBox: element.getAttribute("viewBox"),
        text: [...(resource ?? element).querySelectorAll("text")].map((node) => node.textContent).join(" "),
      };
    });
    expect(vector).toMatchObject({ namespace: "http://www.w3.org/2000/svg", viewBox: "0 0 38 89.8" });
    expect(vector.text).toContain(formatBadgeCredential(credential));
    if (printed.artifact.firstName) expect(vector.text).toContain(printed.artifact.firstName);
    if (printed.artifact.lastName) expect(vector.text).toContain(printed.artifact.lastName);
  }
  return printed;
}

test("the registration desk switches between immediate labels and full badges", async ({ page }, info) => {
  const fixture = await prepareScannerTermination(page);
  const { event } = eventManagementDetailResponseSchema.parse(await (await page.request.get(fixture.api)).json());
  if (!event.ownerGroupId) throw new Error("The fixture event requires its owning group");
  const labelsPage = `/portal/#/groups/${event.ownerGroupId}/events/${event.id}/scanner/print`;
  const artwork: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/badges/printing")) artwork.push(request.url());
  });
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto(labelsPage.replace(/\/print$/, ""));
  await page.getByRole("link", { name: /^Print\b/ }).click();
  await expect(page).toHaveURL(new RegExp("/scanner/print$"));
  await expect(page.getByRole("dialog", { name: "Badge printing scanner", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("print-scanner-mobile-default.png") });
  await page.getByRole("button", { name: "Find attendee or badge", exact: true }).click();
  // Mobile browsers can print the parent document even when an iframe initiated the command.
  await page.evaluate(() => {
    let printCalls = 0;
    window.print = () => {
      document.documentElement.setAttribute("data-print-called", String(++printCalls));
      document.documentElement.setAttribute(
        "data-print-pages",
        String(document.querySelectorAll("#pk-badge-print-command .badge-print-sheet").length),
      );
      window.dispatchEvent(new Event("afterprint"));
      document.documentElement.setAttribute(
        "data-print-retained-pages",
        String(document.querySelectorAll("#pk-badge-print-command .badge-print-sheet").length),
      );
    };
  });
  await expect(page.getByRole("heading", { name: "Print badge labels", exact: true })).toBeVisible();
  await expect(
    page.getByText("Two labels per attendee. Printing opens your phone’s print dialog.", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("label-desk-phone.png"), fullPage: true });
  await page.getByRole("textbox", { name: "Find an attendee", exact: true }).fill(fixture.forbidden[0]!);
  const matched = page.getByRole("button").filter({ hasText: "Synthetic Termination attendee" });
  await expect(matched).toHaveCount(1);
  const returned = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${fixture.api}/badges/labels` && response.request().method() === "POST",
  );
  await matched.click();
  const response = await returned;
  expect(response.status()).toBe(200);
  expect(badgeLabelRequestSchema.parse(response.request().postDataJSON())).toMatchObject({
    source: "badge",
    badgeId: fixture.eligibleBadgeId,
  });
  expect(badgePrintResponseSchema.parse(await response.json()).id).toBe(fixture.eligibleBadgeId);
  await expect(page.locator("html")).toHaveAttribute("data-print-called", "1");
  await expect(page.locator("html")).toHaveAttribute("data-print-pages", "2");
  await expect(page.locator("html")).toHaveAttribute("data-print-retained-pages", "2");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#pk-badge-print-command")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Print badge labels", exact: true })).not.toBeVisible();
  await page.screenshot({ path: info.outputPath("label-print-after-early-event.png"), fullPage: true });
  await page.emulateMedia({ media: "screen" });
  await expect(page.frameLocator('iframe[title="Attendee label print document"]').getByRole("img")).toHaveCount(2);
  await page.getByRole("button", { name: "Print settings", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "1 label", exact: true }).click();
  await page.getByRole("button", { name: "Print labels again", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-print-called", "2");
  await expect(page.frameLocator('iframe[title="Attendee label print document"]').getByRole("img")).toHaveCount(1);
  expect(artwork).toEqual([]);
  const inventory = badgeCredentialsResponseSchema.parse(
    await (await page.request.get(`${fixture.api}/badges`)).json(),
  );
  expect(inventory.badges.map((badge) => badge.id)).toEqual([fixture.eligibleBadgeId]);
  await page.getByRole("button", { name: "Print settings", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Full badges", exact: true }).click();
  await page.getByRole("button", { name: "Print badges again", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-print-called", "3");
  const full = page.frameLocator('iframe[title="Attendee badge print document"]');
  await expect(full.locator(".badge-print-sheet")).toHaveCount(2);
  await expect(full.locator(".badge-template-surface")).toHaveCount(2);
  expect(artwork).toHaveLength(1);
  await page.getByRole("button", { name: "Print settings", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Back only", exact: true }).click();
  await page.getByRole("button", { name: "Print badges again", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-print-called", "4");
  await expect(full.locator(".badge-print-sheet")).toHaveCount(1);
  await expect(full.locator('[aria-label="Badge back"]')).toHaveCount(1);
  await expect(full.locator('[aria-label="Badge front"]')).toHaveCount(0);
  expect(artwork).toHaveLength(1);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Print settings", exact: true }).click();
  await page.screenshot({ path: info.outputPath("print-mode-settings-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 900 });
  await page.screenshot({ path: info.outputPath("print-mode-settings-phone.png"), fullPage: true });
  await page.getByRole("menuitemradio", { name: "Labels", exact: true }).click();
  await page.getByRole("button", { name: "Print labels again", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-print-called", "5");
  await expect(page.frameLocator('iframe[title="Attendee label print document"]').getByRole("img")).toHaveCount(1);
  expect(artwork).toHaveLength(1);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: info.outputPath("label-desk-desktop.png"), fullPage: true });
  // Exercise the viewport fallback independently of native fullscreen support.
  await page.evaluate(() =>
    Object.defineProperty(Element.prototype, "requestFullscreen", { value: undefined, configurable: true }),
  );
  await expect(page.getByRole("button", { name: "Scanner help", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Enter full screen", exact: true }).click();
  await page.getByRole("button", { name: "Scanner help", exact: true }).click();
  await expect(page.locator(".pk-guided-tour")).toBeVisible();
  expect((await page.locator(".pk-guided-tour").boundingBox())?.width).toBeLessThan(400);
  await page.screenshot({ path: info.outputPath("scanner-help-desktop.png") });
  await page.keyboard.press("Escape");
  await expect(page.locator(".pk-guided-tour")).toHaveCount(0);
  const printScanner = page.getByRole("dialog", { name: "Badge printing scanner", exact: true });
  await expect(printScanner).toBeVisible();
  expect(await printScanner.evaluate((element) => element.contains(document.elementFromPoint(20, 20)))).toBe(true);
  await expect(printScanner.getByRole("button", { name: "Embedded view", exact: true })).toHaveCount(0);
  await expect(printScanner.getByRole("list", { name: "Recent scan results" })).toBeVisible();
  await printScanner.getByRole("button", { name: "Operator controls", exact: true }).click();
  await expect(page.getByRole("button", { name: "Print settings", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close operator controls", exact: true }).click();
  await page.screenshot({ path: info.outputPath("print-scanner-fullscreen-desktop.png") });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await printScanner.evaluate((element) => element.contains(document.elementFromPoint(20, 20)))).toBe(true);
  await page.screenshot({ path: info.outputPath("print-scanner-fullscreen-phone.png") });
  const resultsBeforeTour = await printScanner.locator(".pk-fast-scanner__trail li").count();
  const printsBeforeTour = await page.locator("html").getAttribute("data-print-called");
  await printScanner.getByRole("button", { name: "Scanner help", exact: true }).click();
  const help = page.locator(".pk-guided-tour");
  await expect(help.getByRole("heading", { name: "Check your scanner" })).toBeVisible();
  await expect(printScanner.locator("[data-tour-active]")).toBeVisible();
  await page.screenshot({ path: info.outputPath("scanner-help-phone.png") });
  for (let step = 0; step < 3; step++) await help.getByRole("button", { name: "Next", exact: true }).click();
  await expect(printScanner.getByText("Example: Print requested", { exact: true })).toBeVisible();
  await help.getByRole("button", { name: "Replay sound", exact: true }).click();
  await help.getByRole("button", { name: "Next", exact: true }).click();
  await expect(printScanner.getByText("Example: Needs attention", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("scanner-help-warning.png") });
  await help.getByRole("button", { name: "Next", exact: true }).click();
  await expect(printScanner.getByText("Example: Could not print", { exact: true })).toBeVisible();
  await help.getByRole("button", { name: "Next", exact: true }).click();
  await expect(printScanner.locator(".pk-fast-scanner__trail li")).toHaveCount(3);
  for (let step = 0; step < 5 && (await help.getByRole("button", { name: "Next", exact: true }).count()); step++)
    await help.getByRole("button", { name: "Next", exact: true }).click();
  await help.getByRole("button", { name: "Done", exact: true }).click();
  await expect(help).toHaveCount(0);
  await expect(printScanner.locator(".pk-fast-scanner__trail li")).toHaveCount(resultsBeforeTour);
  await expect(printScanner.getByText(/Example:/)).toHaveCount(0);
  expect(await page.locator("html").getAttribute("data-print-called")).toBe(printsBeforeTour);
  const printField = await printScanner.evaluate((element) => getComputedStyle(element).backgroundImage);
  const swipe = () =>
    page.getByRole("group", { name: "Swipe left or right, or use arrow keys, to switch scanner", exact: true });
  await page.evaluate(() =>
    document.addEventListener("animationstart", (event) => {
      if (event.animationName === "pk-scanner-field-turn" && event.target instanceof Element)
        document.documentElement.setAttribute(
          "data-scanner-spin",
          `${event.target.getAttribute("data-gradient-from")}:${event.target.getAttribute("data-scanner-role")}`,
        );
    }),
  );
  await swipe().press("ArrowLeft");
  await expect(page).toHaveURL(/\/scanner$/);
  await expect(page.locator("html")).toHaveAttribute("data-scanner-spin", "print:entry");
  const captureScanner = page.getByRole("dialog", { name: "Continuous badge scanner", exact: true });
  await expect(captureScanner).toBeVisible();
  await expect(captureScanner.getByText("Ready for entry", { exact: true })).toBeVisible();
  await expect(captureScanner).not.toHaveAttribute("data-gradient-from");
  const entryField = await captureScanner.evaluate((element) => getComputedStyle(element).backgroundImage);
  const scanUploaded = page.waitForResponse(
    (response) => new URL(response.url()).pathname === `${fixture.api}/scans` && response.request().method() === "POST",
  );
  await page.keyboard.type(fixture.eligible);
  await page.keyboard.press("Enter");
  const scanResponse = await scanUploaded;
  expect(scanResponse.status()).toBe(200);
  expect(eventScanResponseSchema.parse(await scanResponse.json())).toMatchObject({
    recorded: true,
    attendanceRecorded: true,
  });
  await captureScanner.getByRole("button", { name: "Recent scans", exact: true }).click();
  await expect(captureScanner.getByText(/attendance recorded/).first()).toBeVisible();
  const tools = await captureScanner.locator(".pk-fast-scanner__tools").boundingBox();
  expect(tools).not.toBeNull();
  expect(tools!.y + tools!.height).toBeGreaterThan(page.viewportSize()!.height - 40);
  await page.screenshot({ path: info.outputPath("recent-recorded-scan-phone.png") });
  await captureScanner.getByRole("button", { name: "Return to scanning", exact: true }).click();
  await expect(swipe()).not.toHaveAttribute("aria-disabled", "true");

  await swipe().press("ArrowLeft");
  await expect(captureScanner.getByText("Ready for exit", { exact: true })).toBeVisible();
  await expect(captureScanner).not.toHaveAttribute("data-gradient-from");
  const exitField = await captureScanner.evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(new Set([entryField, exitField, printField]).size).toBe(3);
  expect(new Set([entryField, exitField, printField].map((field) => field.split(",")[0])).size).toBe(1);
  await swipe().press("ArrowLeft");
  await expect(page).toHaveURL(/\/scanner\/print$/);
  await expect(printScanner).toBeVisible();
  await expect(page.getByRole("button", { name: "Enter full screen", exact: true })).toHaveCount(0);
});

test("the protected printed short code works through manual offline capture and exact original-operation replay", async ({
  page,
}, info) => {
  const fixture = await prepareScannerTermination(page);
  const credential = badgeCredentialSchema.parse(fixture.eligible);
  expect(credential).toHaveLength(16);
  expect(credential).not.toBe(fixture.eligibleBadgeId);
  const endpoint = fixture.api + "/badges/" + fixture.eligibleBadgeId;
  const eventResponse = await page.request.get(fixture.api);
  expect(eventResponse.status()).toBe(200);
  const { event } = eventManagementDetailResponseSchema.parse(await eventResponse.json());
  if (!event.ownerGroupId) throw new Error("The fixture event must have its actual owning group");
  const printPage = `/portal/#/groups/${event.ownerGroupId}/events/${event.id}/registrations/badges/${fixture.eligibleBadgeId}/print`;
  const before = await metadata(page, endpoint, credential);
  expect(before).toMatchObject({
    id: fixture.eligibleBadgeId,
    userId: fixture.attendeeId,
    status: "active",
    reprintAvailable: true,
  });
  const readConsole = captureDeviceConsole(page);
  const summaryBefore = attendanceSummarySchema.parse(
    await (await page.request.get(fixture.api + "/attendance/summary")).json(),
  );
  const agendaBefore = agendaSnapshotSchema.parse(await (await page.request.get(fixture.api + "/agenda")).json());
  const firstPrint = await preparePrintedBadge(page, endpoint, credential, () => page.goto(printPage));
  await expect(page.getByRole("heading", { name: "Reprint badge", exact: true })).toBeVisible();
  expect(firstPrint.artifact.id).toBe(fixture.eligibleBadgeId);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("manual-code-protected-print-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  const printPrivacy = await expectNoStoredSponsorContacts(
    page,
    [...fixture.forbidden, firstPrint.artifact.svg],
    await readConsole(),
  );
  const repeatedPrint = await preparePrintedBadge(page, endpoint, credential, () => page.reload());
  expect(repeatedPrint.artifact).toEqual(firstPrint.artifact);
  expect(repeatedPrint.request.operationId).not.toBe(firstPrint.request.operationId);
  expect(await metadata(page, endpoint, credential)).toEqual(before);
  const inventory = badgeCredentialsResponseSchema.parse(
    await (await page.request.get(fixture.api + "/badges")).json(),
  );
  expect(inventory.badges.map((row) => row.id)).toEqual([fixture.eligibleBadgeId]);
  expect(inventory.page.total).toBe(1);

  const preparing = page
    .waitForResponse(
      (response) => new URL(response.url()).pathname === fixture.api + "/offline-eligibility" && response.ok(),
    )
    .then(async (response) => enrolledOfflineEligibilityResponseSchema.parse(await response.json()));
  await page.goto(fixture.scanner);
  const manifest = await preparing;
  expect(manifest.publishedRevision).toBe(fixture.publishedRevision);
  expect(manifest.entries.find((row) => row.badgeId === fixture.eligibleBadgeId)).toMatchObject({
    userId: fixture.attendeeId,
    revoked: false,
    eventRegistered: true,
  });
  await openScannerDiagnostics(page);
  await expect(page.getByRole("combobox", { name: "Feedback pause", exact: true })).toHaveValue("1000");
  await expect(page.getByText(/Badge data up to date/)).toBeVisible();
  await openScannerSessionDetails(page);
  await expect(page.getByText("Offline camera files prepared.", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? "")).not.toBe("");
  await expect
    .poll(async () =>
      page
        .evaluate(
          async ({ version, epochId }) => {
            const opening = indexedDB.open("pkic-scanner-outbox", version);
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              opening.onsuccess = () => resolve(opening.result);
              opening.onerror = () => reject(opening.error ?? new Error("Scanner storage unavailable"));
            });
            try {
              return await new Promise<unknown>((resolve, reject) => {
                const request = db.transaction("scanner-epochs").objectStore("scanner-epochs").getAll();
                request.onsuccess = () =>
                  resolve(
                    request.result.find((row: { epochId: string }) => row.epochId === epochId)?.collectorContext ??
                      null,
                  );
                request.onerror = () => reject(request.error ?? new Error("Scanner preparation unavailable"));
              });
            } finally {
              db.close();
            }
          },
          { version: SCAN_STORAGE_VERSION, epochId: manifest.epochId },
        )
        .then((raw) => {
          const parsed = scannerOfflineContextSchema.safeParse(raw);
          return (
            parsed.success &&
            parsed.data.eventId === manifest.eventId &&
            parsed.data.epochId === manifest.epochId &&
            parsed.data.deviceId === manifest.deviceId &&
            parsed.data.action === "attendance"
          );
        }),
    )
    .toBe(true);
  await page.context().setOffline(true);
  try {
    await openScannerManualEntry(page);
    await page
      .getByRole("textbox", { name: "Badge code", exact: true })
      .fill(formatBadgeCredential(credential).toLowerCase());
    await page.getByRole("button", { name: "Record attendance", exact: true }).click();
    await expect.poll(async () => (await scannerStorage(page)).pending.length).toBe(1);
    const queued = enrolledEventScanRequestSchema.parse((await scannerStorage(page)).pending[0]!.scan);
    expect(queued).toMatchObject({
      badgeId: credential,
      operatorUserId: fixture.operatorId,
      occurrenceId: null,
      action: "attendance",
      capturePublicationRevision: fixture.publishedRevision,
      scannerSession: { epochId: manifest.epochId, sequence: 1 },
    });
    const queuedPrivacy = await expectNoStoredSponsorContacts(page, fixture.forbidden, await readConsole());
    await page.reload();
    await expect(page.getByRole("heading", { name: "Start scanning", exact: true })).toBeVisible();
    await expect(page.getByText("Offline scanning", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync now", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export sponsor leads", exact: true })).toHaveCount(0);
    expect((await scannerStorage(page)).pending[0]!.scan).toEqual(queued);
    await openScannerManualEntry(page);
    await page.getByRole("textbox", { name: "Badge code", exact: true }).fill(fixture.eligibleBadgeId);
    await page.getByRole("button", { name: "Record attendance", exact: true }).click();
    await expect(page.getByText("Enter all 16 characters of the badge code.", { exact: true })).toBeVisible();
    // The field says why at once; the refusal is audited after, in the same ledger as a failure, never as a scan.
    await expect.poll(async () => (await scannerStorage(page)).failures.length).toBe(1);
    const afterReference = await scannerStorage(page);
    expect(afterReference.pending).toHaveLength(1);
    expect(afterReference.pending[0]!.scan).toEqual(queued);
    expect(afterReference.failures).toHaveLength(1);
    expect(afterReference.failures[0]!.scan).toMatchObject({
      reason: "malformed_credential",
      scannerSession: { epochId: manifest.epochId, sequence: 2 },
    });
    expect(afterReference.history).toHaveLength(0);
    await page
      .getByRole("textbox", { name: "Badge code", exact: true })
      .fill(formatBadgeCredential(credential).toLowerCase());
    await page.getByRole("button", { name: "Record attendance", exact: true }).click();
    await expect.poll(async () => (await scannerStorage(page)).pending.length).toBe(2);
    const afterReload = (await scannerStorage(page)).pending.find((row) => row.scan.operationId !== queued.operationId);
    expect(afterReload).toBeDefined();
    const second = enrolledEventScanRequestSchema.parse(afterReload!.scan);
    expect(second.operationId).not.toBe(queued.operationId);
    expect(second).toMatchObject({
      badgeId: credential,
      operatorUserId: fixture.operatorId,
      occurrenceId: queued.occurrenceId,
      action: "attendance",
      capturePublicationRevision: queued.capturePublicationRevision,
      scannerSession: { epochId: manifest.epochId, sequence: 3 },
    });
    expect(
      (await scannerStorage(page)).pending.find((row) => row.scan.operationId === queued.operationId)?.scan,
    ).toEqual(queued);
    await expect(page.locator(".pk-event-scanner--eligible")).toBeVisible();
    await expect(
      page.getByText("Registered. Attendance saved on this device; upload pending.", { exact: true }),
    ).toBeVisible();
    expect((await scannerStorage(page)).history).toHaveLength(0);
    const collectorPrivacy = await expectNoStoredSponsorContacts(page, fixture.forbidden, await readConsole());
    await page.screenshot({
      path: info.outputPath("manual-code-offline-canonical-desktop.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: info.outputPath("manual-code-offline-canonical-phone.png"),
      fullPage: true,
      animations: "disabled",
    });
    const originals = [queued, second];
    const uploads = originals.map((original) =>
      page
        .context()
        .waitForEvent("response", {
          predicate: (response) =>
            new URL(response.url()).pathname === fixture.api + "/scans" &&
            response.request().method() === "POST" &&
            response.request().postDataJSON()?.operationId === original.operationId,
        })
        .then(async (response) => {
          expect(response.status()).toBe(200);
          expect(enrolledEventScanRequestSchema.parse(response.request().postDataJSON())).toEqual(original);
          return eventScanResponseSchema.parse(await response.json());
        }),
    );
    const reauthenticated = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/auth/session" && response.request().method() === "GET",
    );
    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    expect((await reauthenticated).status()).toBe(200);
    await expect(page.getByText("Offline scanning", { exact: true })).toHaveCount(0);
    const receipts = await Promise.all(uploads);
    for (const [index, original] of originals.entries())
      expect(receipts[index]).toMatchObject({
        operationId: original.operationId,
        recorded: true,
        attendanceRecorded: true,
        outcome: "eligible",
      });
    await expect.poll(async () => (await scannerStorage(page)).pending.length).toBe(0);
    await expect.poll(async () => (await scannerStorage(page)).failures.length).toBe(0);
    const reconciled = await scannerStorage(page);
    expect(reconciled.history.filter((row) => row.kind === "scan")).toHaveLength(2);
    // The audited refusal is acknowledged and archived beside the two scans.
    expect(reconciled.history.filter((row) => row.kind === "failure")).toHaveLength(1);
    for (const [index, original] of originals.entries()) {
      expect(reconciled.history.filter((row) => row.scan.operationId === original.operationId)).toHaveLength(1);
      expect(reconciled.history.find((row) => row.scan.operationId === original.operationId)).toMatchObject({
        scan: original,
        receipt: receipts[index],
      });
      const replay = await page.request.post(fixture.api + "/scans", { data: original });
      expect(replay.status()).toBe(200);
      expect(eventScanResponseSchema.parse(await replay.json())).toEqual(receipts[index]);
    }
    const query = attendanceAttemptQuerySchema.parse({ userId: fixture.attendeeId, limit: 50, offset: 0 });
    const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
    const attempts = attendanceAttemptsResponseSchema.parse(
      await (await page.request.get(fixture.api + "/attendance/attempts?" + params.toString())).json(),
    );
    expect(attempts.page.total).toBe(2);
    expect(attempts.attempts).toHaveLength(2);
    expect(new Set(attempts.attempts.map((attempt) => attempt.id)).size).toBe(2);
    for (const original of originals)
      expect(attempts.attempts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            deviceId: original.deviceId,
            operatorUserId: fixture.operatorId,
            action: "attendance",
            observedAt: original.observedAt,
          }),
        ]),
      );
    const after = attendanceSummarySchema.parse(
      await (await page.request.get(fixture.api + "/attendance/summary")).json(),
    );
    expect(after.observed.originalObservations - summaryBefore.observed.originalObservations).toBe(2);
    expect(after.observed.uniquePeople - summaryBefore.observed.uniquePeople).toBe(1);
    expect(after.attempts.recognized - summaryBefore.attempts.recognized).toBe(2);
    expect(after.attempts.admissions).toBe(summaryBefore.attempts.admissions);
    expect(agendaSnapshotSchema.parse(await (await page.request.get(fixture.api + "/agenda")).json())).toEqual(
      agendaBefore,
    );
    expect(
      registrationManageReadResponseSchema.parse(await (await page.request.get(fixture.managePath)).json()),
    ).toEqual(fixture.registrationBefore);
    expect(await metadata(page, endpoint, credential)).toEqual(before);
    const refreshing = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith("/offline-eligibility") && url.searchParams.has("knownDigest");
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    const delta = enrolledOfflineEligibilityResponseSchema.parse(await (await refreshing).json());
    expect(delta.entries).toEqual([]);
    expect(delta.unchanged).toBe(true);
    expect(delta.nextBadgeId).toBeNull();
    const finalPrivacy = await expectNoStoredSponsorContacts(
      page,
      [...fixture.forbidden, firstPrint.artifact.svg],
      await readConsole(true),
    );
    await writeFile(
      info.outputPath("manual-badge-code-proof.json"),
      JSON.stringify(
        {
          kind: "synthetic_actual_manual_short_code_offline_replay",
          badgeId: fixture.eligibleBadgeId,
          operatorId: fixture.operatorId,
          originalOperationIds: originals.map((original) => original.operationId),
          metadataReferenceRejectedBeforeCapture: true,
          renderedQrDecoded: true,
          printedCodeLength: credential.length,
          protectedReprintSameArtifact: true,
          canonicalOfflineQueueSurvivedReload: true,
          twoIntentionalOriginalOperationsReplayedExactlyOnce: true,
          oneUniqueObservedPerson: true,
          postReloadCaptureVerifiedAgainstPreparedSnapshot: true,
          reconnectUsedAutomaticCanonicalSignInRetry: true,
          subsequentEligibilityRefreshOmittedUnchangedEntries: true,
          printPrivacy,
          queuedPrivacy,
          collectorPrivacy,
          finalPrivacy,
          physicalCameraAndPrintingAcceptance: "not_tested",
        },
        null,
        2,
      ),
    );
    // Issue a replacement after preparation, and keep the saved inventory unchanged.
    await page.route("**/offline-eligibility?**", (route) => route.abort());
    const replacementResponse = await page.request.post(fixture.api + "/badges", {
      data: badgeIssueRequestSchema.parse({
        operationId: crypto.randomUUID(),
        userId: fixture.attendeeId,
        replaceBadgeId: fixture.eligibleBadgeId,
      }),
    });
    expect(replacementResponse.status()).toBe(200);
    const replacement = badgeIssueResponseSchema.parse(await replacementResponse.json());
    if (replacement.result !== "issued") throw new Error("Expected a new synthetic badge credential");
    let releaseCheck: (() => void) | undefined;
    await page.route("**/scans", async (route) => {
      const scan = enrolledEventScanRequestSchema.parse(route.request().postDataJSON());
      if (scan.badgeId === replacement.credential)
        await new Promise<void>((resolve) => {
          releaseCheck = resolve;
        });
      await route.continue();
    });
    await openScannerManualEntry(page);
    const checked = page.waitForResponse((response) => {
      if (!new URL(response.url()).pathname.endsWith("/scans") || response.request().method() !== "POST") return false;
      return enrolledEventScanRequestSchema.parse(response.request().postDataJSON()).badgeId === replacement.credential;
    });
    await page.getByRole("textbox", { name: /^Badge code(?: or attendee)?$/ }).fill(replacement.credential);
    await page.getByRole("button", { name: "Record attendance", exact: true }).click();
    await expect.poll(() => Boolean(releaseCheck)).toBe(true);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /checking.*online/i })
        .first(),
    ).toBeVisible();
    // Keep the scanner's fixed viewport while allowing desktop/phone capture sizes.
    await page.evaluate(async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: info.outputPath("local-miss-checking-desktop.png") });
    await page.setViewportSize({ width: 375, height: 844 });
    await page.screenshot({ path: info.outputPath("local-miss-checking-phone.png") });
    releaseCheck!();
    const onlineResponse = await checked;
    expect(onlineResponse.status()).toBe(200);
    expect(eventScanResponseSchema.parse(await onlineResponse.json())).toMatchObject({
      outcome: "eligible",
      attendanceRecorded: true,
    });
    await expect(page.locator(".pk-fast-scanner__label")).toContainText("Registered");
    const checkedScan = enrolledEventScanRequestSchema.parse(onlineResponse.request().postDataJSON());
    await expect
      .poll(
        async () =>
          (await scannerStorage(page)).history.filter((row) => row.scan.operationId === checkedScan.operationId).length,
      )
      .toBe(1);
    await checkScannerSyncStatus(
      page,
      `/portal/#/groups/${event.ownerGroupId}/events/${event.id}/scanner?scannerTab=diagnostics`,
      info,
    );
    await checkWebKitOfflineScanner(
      page,
      `/portal/#/groups/${event.ownerGroupId}/events/${event.id}/scanner?scannerTab=diagnostics`,
      replacement.credential,
      info,
    );
  } finally {
    await page.context().setOffline(false);
  }
});

test("default badges keep all lead sponsors inside both printed faces", async ({ page }, testInfo) => {
  for (const count of [1, 4, 40]) {
    const group = { key: "lead", source: "event" as const, tierName: "Diamond" };
    const template = createGenericBadgeTemplate({ eventName: "Example conference", sponsorGroups: [group] });
    const sponsors = Array.from({ length: count }, (_, index) => ({
      id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      name: `Lead sponsor ${index + 1}`,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 100"><path d="M0 0H280V100H0Z" fill="#198754"/></svg>',
    }));
    const compiled = compileBadgeTemplate(template, [{ ...group, sponsors }]);
    const attendee = {
      displayName: "Alex Example",
      organization: "Example Trust",
      badgeRole: "speaker" as const,
      svg: sponsors[0].svg,
    };
    await page.setContent(
      `<html><head><style>body{margin:0;display:flex;gap:16px}${compiled.css}</style></head><body>${compiled.resourcesHtml}${compiled.renderSide("front", attendee)}${compiled.renderSide("back", attendee)}</body></html>`,
    );
    await page.evaluate(() => document.fonts.ready);
    for (const media of ["screen", "print"] as const) {
      await page.emulateMedia({ media });
      for (const side of ["front", "back"]) {
        const geometry = await page.locator(`.pqc-${side}`).evaluate((badge) => {
          const bounds = badge.getBoundingClientRect();
          return [...badge.querySelectorAll('[role="img"][aria-label^="Lead sponsor "]')].map((logo) => {
            const rect = logo.getBoundingClientRect();
            return {
              width: rect.width,
              height: rect.height,
              left: rect.left - bounds.left,
              right: bounds.right - rect.right,
              top: rect.top - bounds.top,
              bottom: bounds.bottom - rect.bottom,
            };
          });
        });
        expect(geometry, `${count} lead sponsors on ${side} in ${media}`).toHaveLength(count);
        for (const logo of geometry) {
          expect(logo.width).toBeGreaterThan(0);
          expect(logo.height).toBeGreaterThan(0);
          for (const inset of [logo.left, logo.right, logo.top, logo.bottom])
            expect(inset).toBeGreaterThanOrEqual(-0.1);
        }
      }
    }
    if (count === 4) await page.screenshot({ path: testInfo.outputPath("multiple-lead-sponsors.png") });
  }
});
