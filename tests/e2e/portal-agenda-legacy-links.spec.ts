import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import YAML from "yaml";
import {
  authoredAgendaDayFragments,
  authoredAgendaSessionFragments,
} from "../../assets/shared/legacy-agenda-fragments";

type RetainedFragmentFixture = {
  sourcePath: string;
  sourceFileSHA256: string;
  dialogAnchors: string[];
  downloadUrls: string[];
};

type AuthoredSource = {
  locations: { order?: string[]; [date: string]: unknown };
  agenda: Record<
    string,
    { time: string; sessions?: { title?: string | null; locations: string[]; speakers?: string[] }[] }[]
  >;
};
type SessionEvidence = { anchor: string; date: string; title?: string | null; rooms: string[]; speakers: string[] };
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const byId = (page: Page, id: string) => page.locator(`[id=${JSON.stringify(id)}]`);

async function capture(page: Page, info: TestInfo, name: string, fullPage: boolean) {
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
  });
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
}

async function openFragment(page: Page, evidence: SessionEvidence, anchor = evidence.anchor) {
  await page.evaluate((value) => {
    window.location.hash = value;
  }, anchor);
  const alias = byId(page, anchor);
  const dialogId = await alias.getAttribute("data-agenda-fragment-dialog");
  expect(dialogId, anchor).toBeTruthy();
  const dialog = byId(page, dialogId!);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("open", "");
  await expect(page.locator(`[data-agenda-tab="${evidence.date}"]`)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(`[data-agenda-panel="${evidence.date}"]`)).toBeVisible();
  const headingId = await dialog.getAttribute("aria-labelledby");
  expect(headingId, anchor).toBeTruthy();
  const heading = byId(page, headingId!);
  if (typeof evidence.title === "string") expect(await heading.textContent(), anchor).toBe(evidence.title);
  if (evidence.title?.trim()) await expect(heading).toBeVisible();
  return dialog;
}

test("retained historical event links resolve static IDs, dialogs, days, speakers, and original PDF bytes", async ({
  page,
}, info) => {
  test.setTimeout(360_000);
  const retainedFragments = JSON.parse(
    await readFile("tests/fixtures/legacy-agenda-fragments.json", "utf8"),
  ) as RetainedFragmentFixture[];
  const browserAgendaRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/v1\/events\/[^/]+\/agenda(?:\/|\?|$)/u.test(new URL(request.url()).pathname))
      browserAgendaRequests.push(request.url());
  });
  // Public historical pages must work even if the visitor agenda endpoint is unavailable.
  await page.route("**/api/v1/events/*/agenda**", (route) => route.abort());
  await page.route("https://www.youtube-nocookie.com/**", (route) => route.abort());
  const summary: {
    sourcePath: string;
    dialogs: number;
    labels: number;
    days: number;
    downloads: { url: string; sha256: string; bytes: number }[];
  }[] = [];
  for (const fixture of retainedFragments) {
    const text = await readFile(fixture.sourcePath, "utf8");
    expect(digest(text)).toBe(fixture.sourceFileSHA256);
    const source = YAML.parse(text.split(/^---\s*$/mu)[1]!).data as AuthoredSource;
    const dates = Object.keys(source.agenda).sort();
    const evidence: SessionEvidence[] = [];
    for (const date of dates) {
      const authoredDay = source.locations[date] as { order?: string[] } | undefined;
      const order = authoredDay?.order ?? source.locations.order ?? [];
      for (const slot of source.agenda[date]!)
        for (const session of slot.sessions ?? [])
          for (const fragment of authoredAgendaSessionFragments(
            slot.time,
            session.title ?? null,
            session.locations,
            order,
          ))
            if (fragment.kind === "dialog")
              evidence.push({
                anchor: fragment.anchor,
                date,
                title: session.title,
                rooms: session.locations,
                speakers: session.speakers ?? [],
              });
    }
    expect(evidence.map((row) => row.anchor)).toEqual(fixture.dialogAnchors);
    const eventPath = `/${dirname(fixture.sourcePath).replace(/^content\//u, "")}/`;
    const initial = evidence.find((row) => row.date === dates[1] && row.title?.trim())!;
    expect(initial, "A later-day source session is required for initial fragment coverage").toBeTruthy();
    await page.setViewportSize({ width: 1440, height: 1000 });
    const response = await page.goto(`${eventPath}#${encodeURIComponent(initial.anchor)}`);
    expect(response?.status()).toBe(200);
    const html = await response!.text();
    const ids = await page.evaluate(
      (markup) =>
        [...new DOMParser().parseFromString(markup, "text/html").querySelectorAll("[id]")].map((element) => element.id),
      html,
    );
    const expectedIds = [
      ...fixture.dialogAnchors,
      ...fixture.dialogAnchors.map((id) => `${id}-label`),
      ...dates.flatMap((date) => authoredAgendaDayFragments(date).map((fragment) => fragment.anchor)),
      "speakers",
      "nav-speakers",
    ];
    for (const id of expectedIds)
      expect(
        ids.filter((candidate) => candidate === id),
        `Static HTML must contain exactly one ${id}`,
      ).toHaveLength(1);
    // The initial URL must already select the later day and open its dialog.
    const initialDialogId = await byId(page, initial.anchor).getAttribute("data-agenda-fragment-dialog");
    const initialDialog = byId(page, initialDialogId!);
    await expect(initialDialog).toBeVisible();
    await expect(page.locator(`[data-agenda-tab="${initial.date}"]`)).toHaveAttribute("aria-selected", "true");
    await expect(initialDialog.getByRole("heading", { level: 2, name: initial.title!, exact: true })).toBeVisible();
    await capture(page, info, `${eventPath.split("/").at(-2)}-initial-dialog-desktop`, false);
    await initialDialog.getByRole("button", { name: "Close", exact: true }).click();
    await capture(page, info, `${eventPath.split("/").at(-2)}-agenda-desktop`, true);
    // Exercise every observed room-specific dialog and its old label alias through hashchange.
    for (const row of evidence) {
      await openFragment(page, row);
      const labelDialog = await openFragment(page, row, `${row.anchor}-label`);
      await labelDialog.getByRole("button", { name: "Close", exact: true }).click();
    }
    for (const date of dates)
      for (const fragment of authoredAgendaDayFragments(date)) {
        await page.evaluate((anchor) => {
          window.location.hash = anchor;
        }, fragment.anchor);
        await expect(page.locator(`[data-agenda-tab="${date}"]`)).toHaveAttribute("aria-selected", "true");
        await expect(page.locator(`[data-agenda-panel="${date}"]`)).toBeVisible();
        await expect(page.locator("dialog[open]")).toHaveCount(0);
      }
    for (const anchor of ["speakers", "nav-speakers"]) {
      await page.evaluate((value) => {
        window.location.hash = value;
      }, anchor);
      await expect(page.getByRole("tab", { name: "Speakers", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(byId(page, "agenda-speakers")).toBeVisible();
    }
    const multiroom = evidence.find((row) => row.rooms.length > 1 && row.title?.trim()) ?? initial;
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileDialog = await openFragment(page, multiroom);
    for (const speaker of multiroom.speakers.filter((name) => !["None", "TBC", "TBD"].includes(name)))
      await expect(
        mobileDialog.getByRole("heading", { level: 3, name: speaker.replace(/ \*$/u, ""), exact: true }),
      ).toBeVisible();
    const bounds = await mobileDialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeLessThanOrEqual(390);
    expect(bounds!.height).toBeLessThanOrEqual(844);
    await capture(page, info, `${eventPath.split("/").at(-2)}-dialog-mobile`, false);
    await mobileDialog.getByRole("button", { name: "Close", exact: true }).click();
    await capture(page, info, `${eventPath.split("/").at(-2)}-agenda-mobile`, true);
    // Fresh navigation also covers a day-tab alias and the speakers alias on the mobile viewport.
    const lastDayTab = authoredAgendaDayFragments(dates.at(-1)!)[1]!.anchor;
    await page.goto(`${eventPath}#${lastDayTab}`);
    await expect(page.locator(`[data-agenda-tab="${dates.at(-1)}"]`)).toHaveAttribute("aria-selected", "true");
    await page.goto(`${eventPath}#nav-speakers`);
    await expect(byId(page, "agenda-speakers")).toBeVisible();
    const downloads: { url: string; sha256: string; bytes: number }[] = [];
    for (const url of fixture.downloadUrls) {
      const original = await readFile(resolve("content", decodeURIComponent(url).slice(1)));
      expect(original.subarray(0, 5).toString()).toBe("%PDF-");
      const oldDownload = await page.request.get(url);
      expect(oldDownload.status(), url).toBe(200);
      expect(oldDownload.headers()["content-type"], url).toMatch(/^application\/pdf(?:;|$)/iu);
      const actual = await oldDownload.body();
      expect(new Uint8Array(actual), url).toEqual(new Uint8Array(original));
      expect(digest(actual), url).toBe(digest(original));
      downloads.push({ url, sha256: digest(actual), bytes: actual.length });
    }
    summary.push({
      sourcePath: fixture.sourcePath,
      dialogs: evidence.length,
      labels: evidence.length,
      days: dates.length,
      downloads,
    });
  }
  expect(summary.reduce((sum, event) => sum + event.dialogs, 0)).toBe(172);
  expect(summary.reduce((sum, event) => sum + event.downloads.length, 0)).toBe(112);
  expect(browserAgendaRequests).toEqual([]);
  const tempRoot = process.env.PKIC_TEST_TEMP_ROOT;
  const evidencePath = tempRoot
    ? join(tempRoot, `legacy-agenda-links-${crypto.randomUUID()}.json`)
    : info.outputPath("legacy-agenda-links.json");
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(
    evidencePath,
    JSON.stringify({ events: summary, browserAgendaRequests, databaseQueriesInstrumented: false }, null, 2),
    { mode: 0o600 },
  );
  await info.attach("historical-link-evidence", { path: evidencePath, contentType: "application/json" });
});
