import { createHash, randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page, type Route } from "@playwright/test";
import {
  enrolledEventScanRequestSchema,
  eventScanResponseSchema,
} from "../../../assets/shared/schemas/event-participation-scanning";
import { z } from "zod";
import { scannerOfflineContextSchema } from "../../../assets/shared/schemas/event-scanner-offline-context";
import { SCAN_STORAGE_VERSION } from "../../../assets/ts/member-flows/portal/sections/events/detail/scanner/outbox-storage";
import {
  scannerRecoveryEpochSchema,
  scannerDeviceSessionStatusSchema,
} from "../../../assets/shared/schemas/event-scanner-devices";
import {
  downloadScannerRecovery,
  openScannerDiagnostics,
  openScannerRecovery,
  scannerSessionState,
  reconnectScannerBrowser,
  scannerStorage,
} from "./scanner-recovery-storage";

type Scan = ReturnType<typeof enrolledEventScanRequestSchema.parse>;
type Receipt = ReturnType<typeof eventScanResponseSchema.parse>;

export async function storedEpochs(page: Page) {
  const rows = await page.evaluate(async (version): Promise<unknown[]> => {
    const opening = indexedDB.open("pkic-scanner-outbox", version);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error ?? new Error("Scanner database unavailable"));
    });
    try {
      return await new Promise<unknown[]>((resolve, reject) => {
        const request = db.transaction("scanner-epochs").objectStore("scanner-epochs").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Scanner epochs unavailable"));
      });
    } finally {
      db.close();
    }
  }, SCAN_STORAGE_VERSION);
  return rows.map((row) =>
    scannerRecoveryEpochSchema
      .safeExtend({ key: z.string(), collectorContext: scannerOfflineContextSchema.optional() })
      .parse(row),
  );
}

/** Real module URL revision: this exercises replacement, not a changed-code/database migration. */
export async function replaceScannerWorker(context: BrowserContext, page: Page, original: Scan) {
  const before = await scannerStorage(page);
  const epochsBefore = await storedEpochs(page);
  expect(before.pending.map(({ scan }) => scan)).toEqual([original]);
  expect(await scannerSessionState(page)).toMatchObject({ active: null });
  const previous = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/portal/");
    if (!registration?.active) throw new Error("The canonical scanner worker must already be active");
    return { scope: registration.scope, scriptURL: registration.active.scriptURL };
  });
  const revision = new URL(previous.scriptURL);
  revision.searchParams.set("scannerRecoveryRevision", randomUUID());
  const originalResponse = await context.request.get(previous.scriptURL);
  const revisionResponse = await context.request.get(revision.href);
  expect(originalResponse.status()).toBe(200);
  expect(revisionResponse.status()).toBe(200);
  const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const sourceHash = digest(await originalResponse.body());
  expect(digest(await revisionResponse.body())).toBe(sourceHash);
  await page.evaluate(
    async ({ url, scope }) => {
      await navigator.serviceWorker.register(url, { scope, type: "module" });
    },
    { url: revision.href, scope: previous.scope },
  );
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration("/portal/");
        return {
          active: registration?.active?.scriptURL,
          waiting: registration?.waiting?.scriptURL,
          state: registration?.waiting?.state,
        };
      }),
    )
    .toEqual({ active: previous.scriptURL, waiting: revision.href, state: "installed" });
  // Activation follows the browser lifecycle: release clients rather than force skipWaiting.
  const viewport = page.viewportSize();
  const resumed = await context.newPage();
  if (viewport) await resumed.setViewportSize(viewport);
  // Keep a same-origin observer outside the worker scope until activation completes.
  // Immediately reopening /portal/ can give the old worker another controlled client.
  const observerUrl = new URL("/", previous.scope).href;
  const observerResponse = await resumed.goto(observerUrl);
  expect(observerResponse?.status()).toBe(200);
  await expect(resumed).toHaveURL(observerUrl);
  await expect(resumed.locator('[data-module="member-flows/portal-page"]')).toHaveCount(0);
  expect(await resumed.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  for (const client of context.pages()) if (client !== resumed) await client.close();
  await expect
    .poll(() =>
      resumed.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration("/portal/");
        return {
          active: registration?.active?.scriptURL,
          state: registration?.active?.state,
          waiting: registration?.waiting?.scriptURL ?? null,
          controller: navigator.serviceWorker.controller?.scriptURL ?? null,
        };
      }),
    )
    .toEqual({ active: revision.href, state: "activated", waiting: null, controller: null });
  await resumed.goto(new URL("/portal/", previous.scope).href);
  await expect
    .poll(() =>
      resumed.evaluate(() => ({
        url: navigator.serviceWorker.controller?.scriptURL,
        state: navigator.serviceWorker.controller?.state,
      })),
    )
    .toEqual({ url: revision.href, state: "activated" });
  expect(await scannerStorage(resumed)).toEqual(before);
  expect(await storedEpochs(resumed)).toEqual(epochsBefore);
  const cachedPaths = await resumed.evaluate(async () => {
    const paths: string[] = [];
    for (const name of (await caches.keys()).filter((key) => key.startsWith("pkic-scanner-")))
      paths.push(...(await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname));
    return paths;
  });
  expect(cachedPaths).toContain("/portal/");
  expect(cachedPaths.filter((path) => path.startsWith("/api/"))).toEqual([]);
  return {
    page: resumed,
    receipt: {
      previous,
      replacement: revision.href,
      sourceHash,
      observedWaiting: true,
      observedActivated: true,
      activationObserverPath: new URL(observerUrl).pathname,
      epochsBefore,
      cachedPaths,
    },
  };
}

async function observeScannerClaim(page: Page, operationId: string) {
  const marker = randomUUID();
  await page.evaluate(
    ({ operationId, marker }) => {
      const original = IDBObjectStore.prototype.openCursor;
      const observations: Array<{ operationId: string; leaseUntil: number; completed: true }> = [];
      let clicked = false;
      const button = [...document.querySelectorAll("button")].find(
        (element) => element.textContent?.trim() === "Sync now",
      );
      if (!button) throw new Error("The real scanner sync control is required");
      const onClick = () => {
        clicked = true;
      };
      button.addEventListener("click", onClick, { capture: true, once: true });
      IDBObjectStore.prototype.openCursor = function (this: IDBObjectStore, ...args) {
        const request = original.apply(this, args);
        const transaction = this.transaction;
        if (
          clicked &&
          this.name === "scans" &&
          transaction.db.name === "pkic-scanner-outbox" &&
          transaction.mode === "readwrite"
        ) {
          let observed: { operationId: string; leaseUntil: number } | null = null;
          request.addEventListener("success", () => {
            const value: unknown = request.result?.value;
            if (!clicked || !value || typeof value !== "object" || !("scan" in value) || !("leaseUntil" in value))
              return;
            const scan = value.scan;
            if (
              scan &&
              typeof scan === "object" &&
              "operationId" in scan &&
              scan.operationId === operationId &&
              typeof value.leaseUntil === "number" &&
              value.leaseUntil > Date.now()
            )
              observed = { operationId, leaseUntil: value.leaseUntil };
          });
          transaction.addEventListener("complete", () => {
            if (observed) observations.push({ ...observed, completed: true });
          });
        }
        return request;
      };
      Object.defineProperty(window, marker, {
        configurable: true,
        value: {
          observations,
          cleanup: () => {
            IDBObjectStore.prototype.openCursor = original;
            button.removeEventListener("click", onClick, true);
          },
        },
      });
    },
    { operationId, marker },
  );
  return {
    async completed() {
      return page.evaluate(
        (key) =>
          Reflect.get(window, key).observations as Array<{ operationId: string; leaseUntil: number; completed: true }>,
        marker,
      );
    },
    async cleanup() {
      await page.evaluate((key) => {
        Reflect.get(window, key).cleanup();
        Reflect.deleteProperty(window, key);
      }, marker);
    },
  };
}

/** Two real tabs compete for the existing operation; any worker/foreground uploader may win. */
export async function replayScannerFromTwoTabs(
  context: BrowserContext,
  page: Page,
  scannerPath: string,
  scansPath: string,
  original: Scan,
  receipt: Receipt,
) {
  const other = await context.newPage();
  await other.goto(new URL(scannerPath, page.url()).href);
  await expect(other.getByLabel("Scan mode", { exact: true })).toHaveValue("attendance");
  const epochPath = `${scansPath.replace(/\/scans$/u, "")}/scanner/devices/sessions/${original.scannerSession.epochId}`;
  const statusBefore = await page.request.get(epochPath);
  expect(statusBefore.status()).toBe(200);
  const epochBefore = scannerDeviceSessionStatusSchema.parse(await statusBefore.json());
  await openScannerRecovery(page);
  const backupBefore = await downloadScannerRecovery(page);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Restore uploaded scans", exact: true }).click();
  await openScannerRecovery(other);
  await other.getByRole("button", { name: "Restore uploaded scans", exact: true }).click();
  expect((await scannerStorage(page)).pending.map(({ scan }) => scan)).toEqual([original]);

  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const actualRequests: unknown[] = [];
  const actualReceipts: Receipt[] = [];
  const pattern = `**${scansPath}`;
  const handler = async (route: Route) => {
    const request = route.request();
    if (request.method() !== "POST" || request.postDataJSON()?.operationId !== original.operationId)
      return route.continue();
    actualRequests.push(request.postDataJSON());
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    actualReceipts.push(eventScanResponseSchema.parse(await response.json()));
    // Hold only delivery of the real canonical receipt until both real sync controls are exercised.
    await released;
    await route.fulfill({ response });
  };
  await context.route(pattern, handler);
  const observers: Awaited<ReturnType<typeof observeScannerClaim>>[] = [];
  try {
    await openScannerDiagnostics(page);
    await openScannerDiagnostics(other);
    const uploading = context.waitForEvent(
      "response",
      (response) =>
        new URL(response.url()).pathname === scansPath &&
        response.request().method() === "POST" &&
        response.request().postDataJSON()?.operationId === original.operationId &&
        response.ok(),
    );
    await reconnectScannerBrowser(context, page);
    await expect
      .poll(() => actualReceipts.length, {
        message: "A real canonical replay must be held before competing sync triggers",
      })
      .toBeGreaterThan(0);
    observers.push(
      await observeScannerClaim(page, original.operationId),
      await observeScannerClaim(other, original.operationId),
    );
    await Promise.all([
      page.getByRole("button", { name: "Sync now", exact: true }).click(),
      other.getByRole("button", { name: "Sync now", exact: true }).click(),
    ]);
    await Promise.all(
      observers.map((observer) =>
        expect
          .poll(async () => (await observer.completed()).length, {
            message: "The clicked tab must complete a real claim transaction while the original lease remains held",
          })
          .toBeGreaterThan(0),
      ),
    );
    const claims = await Promise.all(observers.map((observer) => observer.completed()));
    const held = (await scannerStorage(page)).pending;
    expect(held).toHaveLength(1);
    expect(held[0].scan).toEqual(original);
    expect(held[0].leaseUntil).toBeGreaterThan(Date.now());
    for (const claim of claims.flat()) {
      expect(claim.operationId).toBe(original.operationId);
      expect(claim.leaseUntil).toBe(held[0].leaseUntil);
    }
    release();
    const response = await uploading;
    expect(enrolledEventScanRequestSchema.parse(response.request().postDataJSON())).toEqual(original);
    expect(eventScanResponseSchema.parse(await response.json())).toEqual(receipt);
    await expect.poll(async () => (await scannerStorage(page)).pending.length).toBe(0);
    // A losing tab read the queue while the winning receipt was held. Refresh both
    // mounted scanners through their real control after the durable acknowledgment.
    await Promise.all(
      [page, other].map(async (scanner) => {
        await scanner.getByRole("button", { name: "Sync now", exact: true }).click();
        await expect(scanner.getByRole("heading", { name: "Badge scanner", exact: true })).toBeVisible();
        await expect(scanner.locator(".pk-event-scanner")).toHaveCount(0);
      }),
    );
    const stored = await scannerStorage(page);
    expect(stored.history).toHaveLength(1);
    expect(stored.history[0].scan).toEqual(original);
    expect(stored.history[0].receipt).toEqual(receipt);
    const backupAfter = await downloadScannerRecovery(page);
    expect(backupAfter.records).toEqual(backupBefore.records);
    expect(backupAfter.scannerEpochs).toEqual(backupBefore.scannerEpochs);
    const statusAfter = await page.request.get(epochPath);
    expect(statusAfter.status()).toBe(200);
    expect(scannerDeviceSessionStatusSchema.parse(await statusAfter.json())).toEqual(epochBefore);
    expect(actualRequests.length).toBeGreaterThan(0);
    for (const body of actualRequests) expect(enrolledEventScanRequestSchema.parse(body)).toEqual(original);
    for (const result of actualReceipts) expect(result).toEqual(receipt);
    return {
      syncTriggers: 2,
      completedClaims: claims,
      routedRequests: actualRequests.length,
      epochBefore,
      epochAfter: epochBefore,
    };
  } finally {
    release();
    for (const observer of observers) await observer.cleanup();
    await context.unroute(pattern, handler);
    await other.close();
  }
}
