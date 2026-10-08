import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { uploadThroughControl } from "./file-upload";
import { expect, type Page, type APIResponse, type BrowserContext, type Request, type Route } from "@playwright/test";
import { z } from "zod";
import { userAuthLogoutRequestSchema, userAuthLogoutResponseSchema } from "../../../assets/shared/schemas/user-auth";
import { offlineScanRecordSchema } from "../../../assets/shared/schemas/event-participation-scanning";
import { archivedScanSchema, scanRecoverySchema } from "../../../assets/shared/schemas/event-scan-recovery";
import { SCAN_STORAGE_VERSION } from "../../../assets/ts/member-flows/portal/sections/events/detail/scanner/outbox-storage";

const queuedScanSchema = offlineScanRecordSchema.extend({
  leaseUntil: z.number(),
  owner: z.string().nullable(),
  attempts: z.number().optional(),
  nextAttemptAt: z.number().optional(),
});

/** Read the browser's real database without inserting or changing any records. */
export async function scannerStorage(page: Page) {
  const stored = await page.evaluate(async (version) => {
    const opening = indexedDB.open("pkic-scanner-outbox", version);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error ?? new Error("Scanner storage could not open"));
    });
    try {
      const transaction = db.transaction(["scans", "history"]);
      const read = (store: string) =>
        new Promise<unknown[]>((resolve, reject) => {
          const request = transaction.objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error("Scanner records could not be read"));
        });
      const [pending, history] = await Promise.all([read("scans"), read("history")]);
      return { pending, history };
    } finally {
      db.close();
    }
  }, SCAN_STORAGE_VERSION);
  return {
    pending: stored.pending.map((record) => queuedScanSchema.parse(record)),
    history: stored.history.map((record) => archivedScanSchema.parse(record)),
  };
}

function scannerDiagnostics(page: Page) {
  return page.getByRole("dialog", { name: "Recovery and diagnostics", exact: true });
}

export async function openScannerDiagnostics(page: Page) {
  const diagnostics = scannerDiagnostics(page);
  if (!(await diagnostics.isVisible()))
    await page.getByRole("button", { name: "Recovery and diagnostics", exact: true }).click();
  await expect(diagnostics).toBeVisible();
  await expect(diagnostics).toHaveJSProperty("open", true);
  return diagnostics;
}

export async function closeScannerDiagnostics(page: Page): Promise<void> {
  const diagnostics = scannerDiagnostics(page);
  if (await diagnostics.isVisible()) await diagnostics.getByRole("button", { name: "Done", exact: true }).click();
  await expect(diagnostics).not.toBeVisible();
}

export async function openScannerManualEntry(page: Page): Promise<void> {
  await closeScannerDiagnostics(page);
  await expect(page.getByRole("heading", { name: "Enter or paste badge code", exact: true })).toBeVisible();
  await expect(page.getByLabel("Badge code", { exact: true })).toBeVisible();
}

export async function openScannerRecovery(page: Page): Promise<void> {
  const diagnostics = await openScannerDiagnostics(page);
  await expect(diagnostics.getByRole("heading", { name: "Recovery backup", exact: true })).toBeVisible();
  await expect(diagnostics.getByRole("button", { name: "Download recovery file", exact: true })).toBeVisible();
}

/** Parse the actual download through the same canonical recovery-file contract. */
export async function downloadScannerRecoveryFile(page: Page) {
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download recovery file", exact: true }).click();
  const download = await downloading;
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  if (!path) throw new Error("Scanner recovery download did not have a local file");
  return { path, payload: scanRecoverySchema.parse(JSON.parse(await readFile(path, "utf8"))) };
}

export async function scrollScannerToTop(page: Page): Promise<void> {
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
}

export async function downloadScannerRecovery(page: Page) {
  return (await downloadScannerRecoveryFile(page)).payload;
}

/** Read local logout evidence without calling product helpers or writing IDB. */
export async function scannerSessionState(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const opening = indexedDB.open("pkic-user-session-state", 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error ?? new Error("Session evidence could not open"));
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const request = db.transaction("state").objectStore("state").get("current");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Session evidence could not be read"));
      });
    } finally {
      db.close();
    }
  });
}

export async function signOutThroughPortal(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in with a passkey", exact: true })).toBeVisible();
}

export async function importScannerRecoveryFile(page: Page, path: string): Promise<void> {
  await openScannerRecovery(page);
  await uploadThroughControl(page, page.getByLabel("Recovery file", { exact: true }), {
    name: basename(path),
    mimeType: "application/json",
    buffer: await readFile(path),
  });
  await page.getByRole("button", { name: "Import recovery file", exact: true }).click();
}

/** Network emulation does not guarantee the browser receives a connectivity event. */
export async function reconnectScannerBrowser(context: BrowserContext, page: Page): Promise<void> {
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
}

/** Delay delivery of the real server result; no response body or headers are fabricated. */
export async function holdGuardedLogout(page: Page, sessionId: string) {
  let heldRequest: Request | null = null;
  let heldResponse: APIResponse | null = null;
  let heldError: Error | null = null;
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pattern = "**/api/v1/auth/logout";
  const handler = async (route: Route) => {
    const request = route.request();
    const body = userAuthLogoutRequestSchema.parse(request.postDataJSON());
    if (body.expectedSessionId !== sessionId || heldRequest !== null) return route.continue();
    heldRequest = request;
    try {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      userAuthLogoutResponseSchema.parse(await response.json());
      expect(response.headers()["set-cookie"]).toBeUndefined();
      heldResponse = response;
      await released;
      await route.fulfill({ response });
    } catch (error) {
      heldError = error instanceof Error ? error : new Error("Guarded logout request failed", { cause: error });
      await route.abort("failed");
    }
  };
  await page.route(pattern, handler);
  const requested = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/v1/auth/logout" &&
      request.method() === "POST" &&
      request.postDataJSON()?.expectedSessionId === sessionId,
    { timeout: 15_000 },
  );
  // The caller restores connectivity before awaiting capture; preserve any early rejection for capture.
  void requested.catch(() => undefined);
  return {
    async capture(): Promise<APIResponse> {
      await requested;
      await expect
        .poll(() => heldResponse !== null || heldError !== null, {
          timeout: 15_000,
          message: "The real guarded logout must return a server response before account switching",
        })
        .toBe(true);
      if (heldError) throw heldError;
      if (!heldResponse) throw new Error("Guarded logout returned no server response");
      return heldResponse;
    },
    async release() {
      const delivered = page.waitForResponse((response) => response.request() === heldRequest, {
        timeout: 15_000,
      });
      release();
      const response = await delivered;
      expect(response.status()).toBe(200);
      expect(response.headers()["set-cookie"]).toBeUndefined();
      await page.unroute(pattern, handler);
      return userAuthLogoutResponseSchema.parse(await response.json());
    },
    async dispose() {
      release();
      await page.unroute(pattern, handler);
    },
  };
}

export async function expectScannerSyncTime(page: Page, text: string): Promise<void> {
  const term = page.locator("dt").filter({ hasText: /^Last successful scan sync$/ });
  await expect(term.locator("xpath=following-sibling::dd[1]")).toHaveText(text);
}

export async function scannerEligibilityCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const opening = indexedDB.open("pkic-scanner-eligibility", 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error ?? new Error("Eligibility cache could not open"));
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const request = db.transaction("manifests").objectStore("manifests").count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Eligibility cache could not be read"));
      });
    } finally {
      db.close();
    }
  });
}

/** Exercise an obsolete expected SID under the real newer browser cookie. */
export async function expectStaleLogoutRefusal(page: Page, sessionId: string): Promise<void> {
  const data = userAuthLogoutRequestSchema.parse({ expectedSessionId: sessionId });
  const response = await page.request.post("/api/v1/auth/logout", { data });
  expect(response.status()).toBe(200);
  expect(response.headers()["set-cookie"]).toBeUndefined();
  expect(userAuthLogoutResponseSchema.parse(await response.json()).outcome).toBe("session_changed");
}
