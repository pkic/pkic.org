/**
 * Screenshot one gallery entry: `pnpm gallery:shot <id> [--phone] [--dark]`.
 *
 * Starts the gallery, renders the entry alone, opens its popup when the entry
 * marks a trigger with `data-gallery-open` (`"focus"` for focus-open cards),
 * and writes `.gallery-shots/<id>.png`.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { startGallery } from "./server.mjs";
import { parseShotArguments } from "./shot-options.mjs";

const options = parseShotArguments(process.argv.slice(2));
const server = await startGallery({ port: 0 });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: options.viewport, colorScheme: options.colorScheme });
  await page.goto(`${server.resolvedUrls.local[0]}?only=${options.id}`);
  const section = page.locator(`section#${options.id}`);
  await section.waitFor({ timeout: 15000 }).catch(() => {
    throw new Error(`No gallery entry "${options.id}". Entries are the section ids in assets/ts/ui/preview/.`);
  });
  const trigger = section.locator("[data-gallery-open] button").first();
  if (await trigger.count()) {
    if (await section.locator('[data-gallery-open="focus"]').count()) await trigger.focus();
    else await trigger.click();
    await page.waitForTimeout(250);
  }
  const directory = resolve(".gallery-shots");
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, options.file);
  await page.screenshot({ path });
  console.log(path);
} finally {
  await browser.close();
  await server.close();
}
