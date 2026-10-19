import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page, type Worker } from "@playwright/test";

type BrowserTabs = {
  query(query: Record<string, never>): Promise<{ id?: number; url?: string }[]>;
  setZoomSettings(id: number, settings: { mode: "automatic"; scope: "per-tab" }): Promise<void>;
  setZoom(id: number, factor: number): Promise<void>;
  getZoom(id: number): Promise<number>;
  getZoomSettings(id: number): Promise<{ mode?: string; scope?: string }>;
};

/** Browser-owned tab zoom; the extension never injects or scales site content. */
export async function openBrowserZoomContext(directory: string, baseURL: string) {
  const extension = join(directory, "extension");
  await mkdir(extension, { recursive: true });
  await writeFile(
    join(extension, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Browser zoom acceptance control",
      version: "1.0.0",
      permissions: ["tabs"],
      background: { service_worker: "background.js" },
    }),
  );
  await writeFile(join(extension, "background.js"), "chrome.runtime.onInstalled.addListener(() => {});\n");
  const context = await chromium.launchPersistentContext(join(directory, "profile"), {
    channel: "chromium",
    headless: true,
    viewport: null,
    baseURL,
    args: ["--window-size=1280,900", `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    return { context, worker };
  } catch (error) {
    await context.close();
    throw error;
  }
}

export async function setBrowserZoom(worker: Worker, page: Page, factor: number) {
  return worker.evaluate(
    async ({ url, zoom }) => {
      const tabs = (globalThis as unknown as { chrome: { tabs: BrowserTabs } }).chrome.tabs;
      const matches = (await tabs.query({})).filter((tab) => tab.url === url);
      if (matches.length !== 1 || matches[0]?.id === undefined)
        throw new Error("Browser zoom requires exactly one matching site tab");
      const id = matches[0].id;
      await tabs.setZoomSettings(id, { mode: "automatic", scope: "per-tab" });
      await tabs.setZoom(id, zoom);
      return { factor: await tabs.getZoom(id), settings: await tabs.getZoomSettings(id) };
    },
    { url: page.url(), zoom: factor },
  );
}

/** No CSS-sized clip: capture the browser's actual zoomed viewport surface. */
export async function captureBrowserZoomViewport(page: Page, path: string) {
  const session = await page.context().newCDPSession(page);
  try {
    const result = await session.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const pixels = Buffer.from(result.data, "base64");
    await writeFile(path, pixels);
    return { width: pixels.readUInt32BE(16), height: pixels.readUInt32BE(20) };
  } finally {
    await session.detach();
  }
}
