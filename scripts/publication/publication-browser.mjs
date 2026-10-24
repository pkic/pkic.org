import { publicationCacheDirectory } from "./build-context.mjs";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { linuxDiagramBrowserOptions } from "./diagram-browser.mjs";

const require = createRequire(import.meta.url);

export async function launchPublicationBrowser() {
  const { default: puppeteer } = require("puppeteer");
  if (process.platform === "linux" && process.arch === "x64") {
    return puppeteer.launch(await linuxDiagramBrowserOptions());
  }
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= publicationCacheDirectory("publication-browser");
  const { chromium } = require("@playwright/test");
  const executablePath = chromium.executablePath();
  try {
    await access(executablePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const args = ["exec", "playwright", "install", "chromium"];
    // Build hosts are unprivileged; OS dependencies belong in the build image.
    // Download Chromium without attempting a privileged package installation.
    const installer = spawn("pnpm", args, { stdio: "inherit" });
    const [code] = await once(installer, "exit");
    if (code !== 0)
      throw new Error(`Image publication requires Playwright's Chromium installation (installer exit ${code})`, {
        cause: error,
      });
  }
  return puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
}
