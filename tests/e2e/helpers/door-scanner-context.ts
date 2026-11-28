import { expect, type Page } from "@playwright/test";
import type { AgendaOccurrence } from "../../../assets/shared/schemas/event-agenda";
import { enrolledOfflineEligibilityResponseSchema } from "../../../assets/shared/schemas/event-offline-eligibility";
import { WITHHELD_CONTACT_VALUE } from "../../../assets/shared/schemas/scanner-attempt-capture";
import {
  scannerStorage,
  openScannerDiagnostics,
  closeScannerDiagnostics,
  openScannerManualEntry,
  scannerBadgeCode,
} from "./scanner-recovery-storage";
import { sponsorEventSlug } from "./sponsor-live-fixture";

// A door operator's scanner, prepared for one approved session through its real controls.
const eventApi = `/api/v1/events/${sponsorEventSlug}`;

async function expectDoorScannerReady(page: Page) {
  const diagnostics = await openScannerDiagnostics(page);
  // Ready before the first refresh lands, up to date after it: either way badges are checked on this device.
  await expect(diagnostics.getByText(/^Badge data (ready|up to date)\b/)).toBeVisible();
  await closeScannerDiagnostics(page);
  // The destination tiles stay disabled until the badge data is ready to check.
  await expect(page.getByRole("button", { name: "Record attendance", exact: true })).toBeEnabled();
}

/** Start the next scanner session, then choose the session again: a new scanner session starts event-wide. */
export async function startNextDoorScannerContext(
  page: Page,
  occurrence: Pick<AgendaOccurrence, "id" | "title" | "roomId">,
  previous: ReturnType<typeof enrolledOfflineEligibilityResponseSchema.parse>,
) {
  const preparing = page
    .waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.ok() &&
        url.pathname === `${eventApi}/offline-eligibility` &&
        Boolean(url.searchParams.get("epochId")) &&
        url.searchParams.get("epochId") !== previous.epochId
      );
    })
    .then(async (response) => enrolledOfflineEligibilityResponseSchema.parse(await response.json()));
  const diagnostics = await openScannerDiagnostics(page);
  await diagnostics.getByRole("button", { name: "Start next scanner session", exact: true }).click();
  const restarted = await preparing;
  expect(restarted).toMatchObject({
    eventId: previous.eventId,
    deviceId: previous.deviceId,
    operatorUserId: previous.operatorUserId,
    publishedRevision: previous.publishedRevision,
  });
  expect(restarted.epochId).not.toBe(previous.epochId);
  // The confirmation is shown on the Scan tab, while the restart was requested from Diagnostics.
  await closeScannerDiagnostics(page);
  await expect(page.getByText("New scanner session prepared. Ready to scan.", { exact: true })).toBeVisible();
  await expectDoorScannerReady(page);
  return chooseDoorSession(page, occurrence, restarted);
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
    await openScannerManualEntry(page);
    await scannerBadgeCode(page).fill(JSON.stringify({ email, biography: freeText }));
    await page.getByRole("button", { name: "Record attendance", exact: true }).click();
    await expect(scannerBadgeCode(page)).toHaveAttribute("aria-invalid", "true");
    expect(submissions).toEqual([]);
    // The refusal is audited as a failure that never carries the contact content, and keeps no scan.
    // The failure is queued first and reaches history only after the background upload archives it.
    const known = new Set(before.history.map((row) => row.scan.operationId));
    const archivedFailures = async () => {
      const current = await scannerStorage(page);
      return { current, added: current.history.filter((row) => !known.has(row.scan.operationId)) };
    };
    await expect.poll(async () => (await archivedFailures()).added.length).toBe(1);
    const { current: after, added } = await archivedFailures();
    expect(after.pending).toEqual(before.pending);
    expect(after.history.filter((row) => known.has(row.scan.operationId))).toEqual(before.history);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      kind: "failure",
      scan: { reason: "malformed_credential", scannedValue: WITHHELD_CONTACT_VALUE, scannedValueTruncated: false },
    });
    expect(JSON.stringify(added)).not.toContain(email);
    expect(JSON.stringify(added)).not.toContain(freeText);
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
  await expectDoorScannerReady(page);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? "")).not.toBe("");
  return chooseDoorSession(page, occurrence, manifest);
}

/** Choose the approved session through the real controls; the preparation request proves the exact room. */
async function chooseDoorSession(
  page: Page,
  occurrence: Pick<AgendaOccurrence, "id" | "title" | "roomId">,
  manifest: ReturnType<typeof enrolledOfflineEligibilityResponseSchema.parse>,
) {
  const path = `${eventApi}/offline-eligibility`;
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
  // Sessions are chosen in their own dialog; a future session is outside the Current and Next windows.
  await page.getByRole("button", { name: "Sessions Choose a room", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Choose a room", exact: true })
    .getByRole("button", { name: "All sessions", exact: true })
    .click();
  const chooser = page.getByRole("dialog", { name: "All sessions", exact: true });
  await expect(chooser.getByRole("tab", { name: "Other", exact: true })).toHaveAttribute("aria-selected", "true");
  await chooser.getByRole("combobox", { name: "Session", exact: true }).fill(occurrence.title);
  await chooser.getByRole("option").filter({ hasText: occurrence.title }).click();
  // A single-room session selects its room, closes the chooser and starts scanning; the request proves the room.
  await expect(chooser).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Continuous badge scanner", exact: true })).toBeVisible();
  const prepared = enrolledOfflineEligibilityResponseSchema.parse(await (await selected).json());
  expect(prepared).toMatchObject({
    epochId: manifest.epochId,
    deviceId: manifest.deviceId,
    operatorUserId: manifest.operatorUserId,
    occurrenceId: occurrence.id,
    roomId: occurrence.roomId,
    publishedRevision: manifest.publishedRevision,
  });
  // Enter codes in the open scanner: the Record attendance tile would start an event-wide scan instead.
  await openScannerManualEntry(page);
  return prepared;
}
