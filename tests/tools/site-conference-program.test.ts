import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ICAL from "ical.js";
import { publishedConferenceProgram } from "../../functions/_lib/services/site-conference-program";
import { conferenceAgendaCalendar } from "../../functions/_lib/services/site-conference-calendar";
import { parseFrontMatter } from "../../functions/_lib/services/site-markdown";
import {
  collectConferenceOutputs,
  conferenceDisplayRedirects,
} from "../../scripts/publication/collect-conference-outputs.mjs";

describe("conference publication outputs", () => {
  it.each([
    "2023/post-quantum-cryptography-conference/index",
    "2023/pqc-conference-amsterdam-nl/index",
    "2025/pqc-conference-austin-us/index",
    "2025/pqc-conference-kuala-lumpur-my/_index",
    "2026/pqc-conference-amsterdam-nl/_index",
  ])("validates the complete authored program for %s", async (event) => {
    const source = parseFrontMatter(await readFile(`content/events/${event}.md`, "utf8"));
    const program = publishedConferenceProgram(source.data.data, () => []);
    expect(Object.keys(program.agenda).length).toBeGreaterThan(0);
    expect(program.speakers.length).toBeGreaterThan(0);
    for (const slots of Object.values(program.agenda)) {
      for (const slot of slots) expect(slot.startsAt).toMatch(/\.000Z$/);
    }
  });

  const program = () =>
    publishedConferenceProgram(
      {
        name: "Synthetic conference",
        timezone: "Asia/Kuala_Lumpur",
        draft: true,
        speakers: [{ name: "Synthetic speaker", id: "synthetic" }],
        locations: { red: { name: "Red hall" }, blue: { name: "Blue hall" } },
        agenda: {
          "2025-10-29": [
            {
              time: "9:00",
              sessions: [
                { title: "Long workshop", locations: ["red"], durationMinutes: 60, speakers: ["Synthetic speaker"] },
              ],
            },
            {
              time: "9:30",
              sessions: [
                {
                  title: "Talk, with punctuation; and Unicode 🗝️",
                  description: "First line\nSecond line",
                  locations: ["blue"],
                },
              ],
            },
            { time: "10:00", sessions: [{ title: "Next talk", locations: ["blue"] }] },
            { time: "10:30", title: "Break" },
          ],
        },
      },
      (pattern) => (pattern === "speakers/synthetic.*" ? ["/content-media/synthetic.webp"] : []),
    );

  it("preserves independent room windows and publishes speaker images", () => {
    const data = program();
    const slots = data.agenda["2025-10-29"]!;
    expect(slots[0]!.sessions[0]).toMatchObject({
      durationMinutes: 60,
      rowSpan: 2,
      endsAt: "2025-10-29T02:00:00.000Z",
    });
    expect(slots[1]!.coveredLocations).toEqual(["red"]);
    expect(slots[2]!.coveredLocations).toEqual([]);
    expect(slots[1]!.sessions[0]!.durationMinutes).toBe(25);
    expect(slots[2]!.sessions[0]!.durationMinutes).toBe(30);
    expect(data.speakers[0]!.headshot?.x250).toBe("/content-media/synthetic.webp");
  });

  it("publishes parseable UTC calendars with actual session ends and stable legacy UIDs", () => {
    const calendar = new ICAL.Component(
      ICAL.parse(conferenceAgendaCalendar(program(), "https://pkic.org/events/synthetic/", "2025-01-01T00:00:00.000Z")),
    );
    const sessions = calendar.getAllSubcomponents("vevent");
    expect(sessions).toHaveLength(3);
    expect(sessions[0]!.getFirstPropertyValue("uid")).toBe("red-2025-10-29-900@ics.pkic.org");
    expect(sessions[0]!.getFirstPropertyValue("location")).toBe("Red hall");
    const second = new ICAL.Event(sessions[1]!);
    expect(second.endDate.toJSDate().toISOString()).toBe("2025-10-29T01:55:00.000Z");
    expect(second.summary).toBe("Talk, with punctuation; and Unicode 🗝️");
    expect(second.description).toContain("First line\nSecond line");
    expect(second.description).toContain("preliminary agenda");
  });

  it("preserves calendar room categories and day-specific livestream links", () => {
    const data = program();
    data.locations.red = { name: "Main hall", color: "green", livestream: "https://example.test/main" };
    data.locations["2025-10-29"] = {
      red: { name: "Workshop room", livestream: "https://example.test/workshop?a=1&b=2" },
    };
    data.agenda["2025-10-29"]![0]!.sessions[0]!.track = "Technical";
    const calendar = new ICAL.Component(
      ICAL.parse(conferenceAgendaCalendar(data, "https://pkic.org/events/synthetic/", "2025-01-01T00:00:00.000Z")),
    );
    const first = calendar.getAllSubcomponents("vevent")[0]!;
    expect(first.getFirstPropertyValue("location")).toBe("Workshop room");
    expect(first.getFirstProperty("categories")!.getValues()).toEqual(["Workshop room", "Technical"]);
    const conference = first.getFirstProperty("conference")!;
    expect(conference.type).toBe("uri");
    expect(conference.getFirstValue()).toBe("https://example.test/workshop?a=1&b=2");
    expect(conference.getParameter("label")).toBe("Workshop room livestream");
    expect(conference.getParameter("feature")).toBe("AUDIO,VIDEO,SCREEN");
    expect(first.getFirstPropertyValue("x-microsoft-onlinemeetingconflink")).toBe(conference.getFirstValue());
    expect(first.getFirstPropertyValue("x-google-conference")).toBe(conference.getFirstValue());
    expect(first.getFirstProperty("color")).toBeNull();
    const second = calendar.getAllSubcomponents("vevent")[1]!;
    expect(second.getFirstProperty("conference")).toBeNull();
  });

  it("redirects only generated conference display aliases", () => {
    expect(
      conferenceDisplayRedirects([
        "events/synthetic/event-speakers/index.html",
        "events/synthetic/event-speakers2/index.html",
        "events/synthetic/event-session/index.html",
        "events/synthetic/event-overlays/index.html",
        "events/synthetic/index.html",
        "events/synthetic/event-data.json",
      ]),
    ).toEqual(
      ["event-speakers", "event-speakers2", "event-session", "event-overlays"].map((name) => ({
        from: `/events/synthetic/${name}.html`,
        to: `/events/synthetic/${name}/`,
        status: 301,
      })),
    );
  });

  it("owns generated JSON and calendar endpoints in the release and detects their withdrawal", async () => {
    const output = await mkdtemp(resolve(tmpdir(), "pkic-conference-outputs-"));
    try {
      const directory = resolve(output, "events", "synthetic");
      await mkdir(directory, { recursive: true });
      await writeFile(resolve(directory, "event-data.json"), JSON.stringify(program()));
      await writeFile(
        resolve(directory, "agenda.ics"),
        conferenceAgendaCalendar(program(), "https://pkic.org/events/synthetic/", "2025-01-01T00:00:00.000Z"),
      );
      await writeFile(resolve(directory, "unrelated.json"), "{}");
      expect(await collectConferenceOutputs(output)).toEqual([
        "events/synthetic/agenda.ics",
        "events/synthetic/event-data.json",
      ]);
      await rm(resolve(directory, "event-data.json"));
      expect(await collectConferenceOutputs(output)).toEqual(["events/synthetic/agenda.ics"]);
      await writeFile(resolve(directory, "event-data.json"), "{}");
      await expect(collectConferenceOutputs(output)).rejects.toThrow();
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  });
});
