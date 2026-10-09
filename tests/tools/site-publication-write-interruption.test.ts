import ICAL from "ical.js";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { sitePublicationReleaseSchema } from "../../assets/shared/schemas/site-publication-release";
import { assembleStaticRelease } from "../../scripts/publication/assemble-static-release.mjs";
import { createReleaseIntegrity, verifyReleaseIntegrity } from "../../scripts/publication/release-integrity.mjs";
import { createTemporaryDirectory } from "./helpers/temporary-directory";

// Deterministic pending filenames let an actual filesystem obstruction interrupt
// the second write without changing the assembler or mocking its filesystem I/O.
vi.mock("node:crypto", async (original) => ({
  ...(await original<typeof import("node:crypto")>()),
  randomUUID: () => "11111111-1111-4111-8111-111111111111",
}));

it("keeps the active release served coherently through a failed second candidate write and verified retry", async () => {
  const root = await createTemporaryDirectory("publication-write-interruption");
  const active = resolve(root, "active");
  const candidate = resolve(root, "candidate-assets");
  const files = ["index.html", "events/failure/event-data.json", "events/failure/agenda.ics"];
  const server = createServer(async (request, response) => {
    try {
      const file = request.url === "/" ? "index.html" : request.url?.slice(1);
      if (!file || ![...files, "publication.json"].includes(file)) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200).end(await readFile(resolve(active, file)));
    } catch {
      response.writeHead(503).end();
    }
  });
  try {
    async function source(name: string, sequence: number) {
      const directory = resolve(root, name);
      const calendar = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//PKI Consortium//Publication boundary fixture//EN",
        "BEGIN:VEVENT",
        "UID:publication-boundary@example.test",
        "DTSTAMP:20261008T000000Z",
        "DTSTART:20261201T090000Z",
        "DTEND:20261201T100000Z",
        `SEQUENCE:${sequence}`,
        `SUMMARY:Release ${sequence}`,
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n");
      const parsedCalendar = new ICAL.Component(ICAL.parse(calendar));
      expect(parsedCalendar.getFirstPropertyValue("version")).toBe("2.0");
      const events = parsedCalendar.getAllSubcomponents("vevent");
      expect(events).toHaveLength(1);
      const event = new ICAL.Event(events[0]!);
      expect(event.uid).toBe("publication-boundary@example.test");
      expect(event.sequence).toBe(sequence);
      expect(event.startDate.toString()).toBe("2026-12-01T09:00:00Z");
      expect(event.endDate.toString()).toBe("2026-12-01T10:00:00Z");
      for (const [index, file] of files.entries()) {
        await mkdir(dirname(resolve(directory, file)), { recursive: true });
        const bytes = [`<main>Release ${sequence}</main>`, JSON.stringify({ revision: sequence }), calendar][index]!;
        await writeFile(resolve(directory, file), bytes);
      }
      const release = sitePublicationReleaseSchema.parse({
        version: 1,
        source: "native",
        environment: "production",
        sourceSequence: sequence,
        snapshotId: String(sequence).repeat(64),
        files,
        integrity: await createReleaseIntegrity(directory, files),
      });
      await writeFile(resolve(directory, "publication.json"), JSON.stringify(release));
      return directory;
    }
    await assembleStaticRelease(await source("last-good", 1), active, "production");
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    const origin = `http://127.0.0.1:${address.port}`;
    async function served() {
      return Promise.all(
        [...files, "publication.json"].map(async (file) => {
          const response = await fetch(`${origin}/${file}`, { cache: "no-store" });
          expect(response.status).toBe(200);
          return { file, bytes: await response.text() };
        }),
      );
    }
    const before = await served();
    const incoming = await source("incoming", 2);
    const blocker = resolve(candidate, `${files[1]}.11111111-1111-4111-8111-111111111111.pending`);
    await mkdir(blocker, { recursive: true });
    await expect(assembleStaticRelease(incoming, candidate, "production")).rejects.toThrow();
    // Prove failure occurred after one artifact was installed, not during preflight.
    expect(await readFile(resolve(candidate, files[0]!), "utf8")).toBe("<main>Release 2</main>");
    await expect(readFile(resolve(candidate, "publication.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await served()).toEqual(before);
    await rm(blocker, { recursive: true, force: true });
    await assembleStaticRelease(incoming, candidate, "production");
    const recovered = sitePublicationReleaseSchema.parse(
      JSON.parse(await readFile(resolve(candidate, "publication.json"), "utf8")),
    );
    expect(recovered.sourceSequence).toBe(2);
    await verifyReleaseIntegrity(candidate, recovered);
    for (const file of files)
      expect(await readFile(resolve(candidate, file))).toEqual(await readFile(resolve(incoming, file)));
    // Complete candidate bytes do not activate a release: the existing provider
    // coordinator owns that separate, attested transition.
    expect(await served()).toEqual(before);
  } finally {
    if (server.listening)
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(root, { recursive: true, force: true });
  }
});
