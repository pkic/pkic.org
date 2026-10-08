import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { expect, it } from "vitest";
import { publicAgendaCalendarSchema } from "../../assets/shared/schemas/site-agenda-calendar";
import { sitePublicationReleaseSchema } from "../../assets/shared/schemas/site-publication-release";
import {
  publicAgendaCalendar,
  publicSessionCalendarPath,
} from "../../functions/_lib/services/site-public-agenda-calendar";
import { assembleStaticRelease } from "../../scripts/publication/assemble-static-release.mjs";
import { collectConferenceOutputs } from "../../scripts/publication/collect-conference-outputs.mjs";
import { createReleaseIntegrity, verifyReleaseIntegrity } from "../../scripts/publication/release-integrity.mjs";
import { createTemporaryDirectory } from "./helpers/temporary-directory";

const occurrenceId = "1ecb85cb-36e0-4114-b6e1-82a33f348c2f";
const calendar = publicAgendaCalendarSchema.parse({
  basis: "approved_history",
  name: "Synthetic public conference",
  timeZone: "Europe/Amsterdam",
  agendaPath: "/conferences/synthetic/agenda/",
  entries: [
    {
      occurrenceId,
      sequence: 2,
      updatedAt: "2026-10-05T08:00:00.000Z",
      startAt: "2026-12-01T09:00:00.000Z",
      endAt: "2026-12-01T10:00:00.000Z",
      status: "confirmed",
      agendaPath: "/conferences/synthetic/agenda/",
      title: "Synthetic public session",
      description: "Approved public abstract",
      speakers: [],
      locations: [],
    },
  ],
});
const endpoint = publicSessionCalendarPath(calendar.agendaPath, occurrenceId).slice(1);
const bytes = publicAgendaCalendar(calendar, "https://pkic.org", {
  occurrenceId,
});
async function put(root: string, path: string, content: string) {
  await mkdir(dirname(resolve(root, path)), { recursive: true });
  await writeFile(resolve(root, path), content);
}
async function writeRelease(source: string, privatePaths: string[] = []) {
  // This is the endpoint collector used by finish-astro-release, not a hand-authored file inventory.
  const files = [
    "index.html",
    ...privatePaths.map((path) => `${path.slice(1)}index.html`),
    ...(await collectConferenceOutputs(source)),
  ];
  const release = sitePublicationReleaseSchema.parse({
    version: 1,
    source: "native",
    environment: "preview",
    snapshotId: "a".repeat(64),
    sourceSequence: 1,
    privatePaths,
    files,
    integrity: await createReleaseIntegrity(source, files),
  });
  await writeFile(resolve(source, "publication.json"), JSON.stringify(release));
  return release;
}

it("inventories generated single-session calendar bytes for fresh assembly, integrity and later withdrawal", async () => {
  const root = await createTemporaryDirectory("public-calendar-integrity");
  const source = resolve(root, "source"),
    destination = resolve(root, "fresh-worker");
  try {
    await put(source, "index.html", "Approved agenda page");
    await put(source, endpoint, bytes);
    const release = await writeRelease(source);
    expect(release.files).toEqual(["index.html", endpoint]);
    expect(release.integrity!.files[endpoint]).toEqual({
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: Buffer.byteLength(bytes),
    });
    await assembleStaticRelease(source, destination, "preview");
    expect(await readFile(resolve(destination, endpoint), "utf8")).toBe(bytes);
    const installed = sitePublicationReleaseSchema.parse(
      JSON.parse(await readFile(resolve(destination, "publication.json"), "utf8")),
    );
    expect(installed.integrity!.files[endpoint]).toEqual(release.integrity!.files[endpoint]);
    await verifyReleaseIntegrity(destination, installed);
    expect(await readFile(resolve(destination, "_headers"), "utf8")).toContain(
      "/conferences/synthetic/agenda/calendar/*\n",
    );

    await writeFile(resolve(source, endpoint), `${bytes}Tampered`);
    await expect(assembleStaticRelease(source, destination, "preview")).rejects.toThrow("integrity");
    expect(await readFile(resolve(destination, endpoint), "utf8")).toBe(bytes);
    expect(await readFile(resolve(destination, "publication.json"), "utf8")).toBe(JSON.stringify(installed));

    const unrelated = "conferences/synthetic/agenda/notes.txt";
    await put(destination, unrelated, "Unowned retained file");
    await rm(resolve(source, endpoint));
    await writeRelease(source);
    await assembleStaticRelease(source, destination, "preview");
    await expect(readFile(resolve(destination, endpoint))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(resolve(destination, unrelated), "utf8")).toBe("Unowned retained file");
    const withdrawn = sitePublicationReleaseSchema.parse(
      JSON.parse(await readFile(resolve(destination, "publication.json"), "utf8")),
    );
    expect(withdrawn.files).not.toContain(endpoint);
    expect(Object.hasOwn(withdrawn.integrity!.files, endpoint)).toBe(false);
    await verifyReleaseIntegrity(destination, withdrawn);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("validates only immediate single-session ICS children of the owned agenda calendar directory", async () => {
  const root = await createTemporaryDirectory("public-calendar-inventory");
  try {
    for (const path of [
      "conferences/synthetic/calendar/unrelated.ics",
      "conferences/synthetic/agenda/calendar/nested/unrelated.ics",
      "conferences/synthetic/agenda/calendar/unrelated.txt",
      "conferences/synthetic/agenda/calendarish/unrelated.ics",
    ])
      await put(root, path, "Not a calendar");
    await put(root, endpoint, bytes);
    expect(await collectConferenceOutputs(root)).toEqual([endpoint]);
    await writeFile(resolve(root, endpoint), "BEGIN:VEVENT\r\nEND:VEVENT\r\n");
    await expect(collectConferenceOutputs(root)).rejects.toThrow("Conference calendar is invalid");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps 240 session calendars and private-page protections inside the edge header budget", async () => {
  const root = await createTemporaryDirectory("public-calendar-header-budget");
  const source = resolve(root, "source"),
    destination = resolve(root, "fresh-worker");
  const privatePaths = Array.from({ length: 40 }, (_, index) => `/private/review-${index}/`);
  const agendaPaths = Array.from({ length: 4 }, (_, index) => `events/history-${index}/agenda/`);
  try {
    await put(source, "index.html", "Approved home");
    for (const path of privatePaths) await put(source, `${path.slice(1)}index.html`, "Private invitation view");
    for (const [index, path] of agendaPaths.entries()) {
      await put(source, `${path}data.json`, JSON.stringify({ timezone: "UTC", agenda: {} }));
      await put(source, `${path}calendar.ics`, bytes);
      await put(source, `events/history-${index}/event-data.json`, JSON.stringify({ timezone: "UTC", agenda: {} }));
      await put(source, `events/history-${index}/agenda.ics`, bytes);
      for (let session = 0; session < 60; session += 1)
        await put(source, `${path}calendar/session-${session}.ics`, bytes);
    }
    const release = await writeRelease(source, privatePaths);
    expect(release.files.filter((file) => /\/calendar\/[^/]+\.ics$/.test(file))).toHaveLength(240);
    await assembleStaticRelease(source, destination, "preview");
    const headers = await readFile(resolve(destination, "_headers"), "utf8");
    const rules = headers.split(/\r?\n/).filter((line) => line && !/^(?:\s|#)/.test(line));
    expect(rules.length).toBeLessThanOrEqual(100);
    expect(rules.filter((rule) => rule.endsWith("/agenda/calendar/*"))).toHaveLength(4);
    expect(rules.some((rule) => /\/calendar\/session-\d+\.ics$/.test(rule))).toBe(false);
    for (const [index, path] of agendaPaths.entries()) {
      for (const file of [
        `${path}data.json`,
        `${path}calendar.ics`,
        `${path}calendar/*`,
        `events/history-${index}/event-data.json`,
        `events/history-${index}/agenda.ics`,
      ])
        expect(headers).toContain(`/${file}\n    ! X-Robots-Tag\n    X-Robots-Tag: noindex, nofollow, noarchive`);
    }
    for (const path of privatePaths) {
      expect(rules.indexOf(path)).toBeGreaterThanOrEqual(0);
      expect(rules.indexOf(path)).toBeLessThan(100);
      expect(headers).toContain(
        `${path}\n    ! Cache-Control\n    Cache-Control: no-store, max-age=0\n    ! Referrer-Policy\n    Referrer-Policy: no-referrer\n    ! X-Robots-Tag\n    X-Robots-Tag: noindex, nofollow, noarchive`,
      );
    }
    // A fresh destination inherits the actual canonical security baseline, including scanner camera policy.
    expect(headers).toContain("Content-Security-Policy: default-src 'none'");
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    expect(headers).toContain("Permissions-Policy: camera=(self), microphone=()");
    for (const path of ["/meetings/join/*", "/m/*"])
      expect(headers).toContain(
        `${path}\n    ! Cache-Control\n    Cache-Control: no-store, max-age=0\n    ! Referrer-Policy\n    Referrer-Policy: no-referrer`,
      );
    expect(headers).toContain(
      "/_assets/*\n    ! Cache-Control\n    Cache-Control: public, max-age=31536000, immutable\n    Service-Worker-Allowed: /portal/",
    );
    expect(headers.indexOf("/_published/agenda/*")).toBeLessThan(headers.indexOf(privatePaths[0]!));
    await writeFile(resolve(destination, "_headers"), `${headers}\n/existing-private/*\n    Cache-Control: no-store\n`);
    await assembleStaticRelease(source, destination, "preview");
    const repeated = await readFile(resolve(destination, "_headers"), "utf8");
    expect(repeated.match(/X-PKIC-Publication/g)).toHaveLength(1);
    expect(repeated).toContain("/existing-private/*\n    Cache-Control: no-store");
    expect(repeated.split(/\r?\n/).filter((line) => line && !/^(?:\s|#)/.test(line)).length).toBeLessThanOrEqual(100);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("refuses an over-budget release instead of installing silently truncated private protections", async () => {
  const root = await createTemporaryDirectory("public-header-budget-refusal");
  const source = resolve(root, "source"),
    destination = resolve(root, "fresh-worker");
  const privatePaths = Array.from({ length: 100 }, (_, index) => `/private/review-${index}/`);
  try {
    await put(source, "index.html", "Approved home");
    for (const path of privatePaths) await put(source, `${path.slice(1)}index.html`, "Private invitation view");
    await writeRelease(source, privatePaths);
    const baseline = await readFile("static/_headers", "utf8");
    await put(destination, "_headers", baseline);
    await expect(assembleStaticRelease(source, destination, "preview")).rejects.toThrow("100 header-rule limit");
    expect(await readFile(resolve(destination, "_headers"), "utf8")).toBe(baseline);
    await expect(readFile(resolve(destination, "publication.json"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
