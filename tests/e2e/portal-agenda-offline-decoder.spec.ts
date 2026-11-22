import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { openScannerSessionDetails, scannerShellCachedUrls } from "./helpers/scanner-recovery-storage";
import { badgeCameraScanRegion } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/camera-driver";
import { generateBadgeCredential } from "../../assets/shared/schemas/badge-credential";

test("the camera decoder reads a small badge QR away from the frame center", async ({ page }) => {
  await page.addInitScript(() => Reflect.deleteProperty(globalThis, "BarcodeDetector"));
  await page.goto("/portal/");
  const manifestResponse = await page.request.get("/js/built/scanner-offline-inventory-build.json");
  expect(manifestResponse.ok()).toBe(true);
  const manifest: { assets: string[] } = await manifestResponse.json();
  const moduleUrl = manifest.assets.find((url) => /\/qr-scanner\.min\.[^/]+\.js$/u.test(url));
  expect(moduleUrl).toBeDefined();
  const value = generateBadgeCredential();
  const imageData = await QRCode.toDataURL(value, { width: 100, margin: 4 });
  const region = badgeCameraScanRegion({ videoWidth: 1920, videoHeight: 1080 });
  const decoded = await page.evaluate(
    async ({ moduleUrl, imageData, region }) => {
      const image = new Image();
      image.src = imageData;
      await image.decode();
      const frame = document.createElement("canvas");
      frame.width = 1920;
      frame.height = 1080;
      const context = frame.getContext("2d")!;
      context.fillStyle = "white";
      context.fillRect(0, 0, frame.width, frame.height);
      context.drawImage(image, 100, (frame.height - image.height) / 2);
      const { default: QrScanner } = await import(moduleUrl);
      const result = await QrScanner.scanImage(frame, { scanRegion: region, returnDetailedScanResult: true });
      return result.data;
    },
    { moduleUrl: moduleUrl!, imageData, region },
  );
  expect(decoded).toBe(value);
});

test("a fresh offline page decodes a real QR image after preparing with native detection available", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    class NativeQrDetector {
      static async getSupportedFormats() {
        return ["qr_code"];
      }
      async detect() {
        return [];
      }
    }
    Object.defineProperty(globalThis, "BarcodeDetector", { value: NativeQrDetector, configurable: true });
  });
  await signInAsE2eStaff(page, e2eAdminEmail("default"));
  await page.goto("/portal/#/events/pqc-conference-amsterdam-nl/scanner");
  const diagnostics = await openScannerSessionDetails(page);
  await expect(diagnostics.getByText("Offline camera files prepared.", { exact: true })).toBeVisible();
  const cached = await scannerShellCachedUrls(page);
  const main = cached.find((url) => /\/qr-scanner\.min\.[^/]+\.js$/u.test(url));
  const fallback = cached.find((url) => /\/qr-scanner-worker\.min\.[^/]+\.js$/u.test(url));
  expect(main, "The actual camera module must be in the scanner code cache").toBeDefined();
  expect(fallback, "Native detection must not skip preparing the fallback module").toBeDefined();
  const value = randomUUID();
  const image = await QRCode.toDataURL(value, { width: 320, margin: 4 });
  await page.close();
  await context.setOffline(true);
  const offlinePage = await context.newPage();
  await offlinePage.addInitScript(() => {
    Reflect.deleteProperty(globalThis, "BarcodeDetector");
  });
  const decoderResponses: Array<{ url: string; fromWorker: boolean }> = [];
  offlinePage.on("response", (response) => {
    if (/\/qr-scanner(?:-worker)?\.min\./u.test(response.url()))
      decoderResponses.push({ url: response.url(), fromWorker: response.fromServiceWorker() });
  });
  await offlinePage.goto("/portal/", { waitUntil: "domcontentloaded" });
  await expect.poll(() => offlinePage.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const decoded = await offlinePage.evaluate(
    async ({ moduleUrl, imageData }) => {
      const scanner = await import(moduleUrl);
      const result = await scanner.default.scanImage(imageData, { returnDetailedScanResult: true });
      return result.data as string;
    },
    { moduleUrl: main!, imageData: image },
  );
  expect(decoded).toBe(value);
  expect(decoderResponses).toEqual(
    expect.arrayContaining([
      { url: main, fromWorker: true },
      { url: fallback, fromWorker: true },
    ]),
  );
});
