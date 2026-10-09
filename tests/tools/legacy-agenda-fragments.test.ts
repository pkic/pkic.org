import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { legacyAgendaFragments } from "../../scripts/lib/legacy-agenda-fragments.mjs";
import { prepareLegacyAgendaImport } from "../../scripts/lib/legacy-agenda-import.mjs";
import { readLegacyAgendaSource } from "../../scripts/lib/legacy-agenda-preparation.mjs";
import retainedFragments from "../fixtures/legacy-agenda-fragments.json";

// Exact observed IDs from retained Hugo outputs for unchanged public historical sources.
describe("authored legacy agenda fragment preservation", () => {
  it.each(retainedFragments)("matches every retained Hugo dialog for $sourcePath", async (fixture) => {
    const text = await readFile(fixture.sourcePath, "utf8");
    expect(createHash("sha256").update(text).digest("hex")).toBe(fixture.sourceFileSHA256);
    const { source } = readLegacyAgendaSource(text, fixture.sourcePath);
    const result = prepareLegacyAgendaImport(source, { sourcePath: fixture.sourcePath, archivePublicSource: true });
    const fragments = result.document.occurrences.flatMap((row) => row.archive?.legacyFragments ?? []);
    expect(fragments.filter((alias) => alias.kind === "dialog").map((alias) => alias.anchor)).toEqual(
      fixture.dialogAnchors,
    );
    expect(fragments.filter((alias) => alias.kind === "dialog_label").map((alias) => alias.anchor)).toEqual(
      fixture.dialogAnchors.map((anchor) => `${anchor}-label`),
    );
    expect(result.unresolved.filter((finding) => finding.kind === "legacy_fragment")).toEqual([]);
    for (const row of result.document.occurrences)
      for (const fragment of row.archive?.legacyFragments ?? []) {
        expect(fragment.sourcePath).toBe(fixture.sourcePath);
        expect(fragment.sourceDigest).toBe(result.document.source.sourceDigest);
        expect(fragment.sourceLocator).toBe(row.ref);
        expect(row.roomRefs).toContain(fragment.roomRef);
      }
  });

  it("keeps original clock/title/room index after an explicit title review and uses day-specific order", () => {
    const source = {
      timezone: "Europe/Amsterdam",
      locations: { order: ["plenary", "breakout"], "2023-11-07": { order: ["breakout", "plenary"] } },
      agenda: {
        "2023-11-07": [
          { time: "8:30", durationMinutes: 30, sessions: [{ title: "HW/FW & Unicode café", locations: ["breakout"] }] },
        ],
      },
    };
    const pending = prepareLegacyAgendaImport(source, {
      sourcePath: "content/events/example/index.md",
      archivePublicSource: true,
    });
    const result = prepareLegacyAgendaImport(source, {
      sourcePath: "content/events/example/index.md",
      archivePublicSource: true,
      roomIds: { breakout: "11111111-1111-4111-8111-111111111111" },
      sourceRows: {
        "2023-11-07:0:0": {
          sourceDigest: pending.document.source.sourceDigest,
          title: { decision: "reviewed_title", value: "Verified replacement", reviewedAt: "2026-10-04T00:00:00.000Z" },
        },
      },
    });
    expect(result.ready).toBe(true);
    expect(result.document.occurrences[0]!.fields.title).toBe("Verified replacement");
    expect(result.document.occurrences[0]!.archive!.legacyFragments).toEqual([
      expect.objectContaining({
        anchor: "sessionModal-830-0-hw/fw-unicode-café",
        kind: "dialog",
        authoredTitle: "HW/FW & Unicode café",
        authoredStart: "8:30",
        roomRef: "breakout",
        roomId: "11111111-1111-4111-8111-111111111111",
      }),
      expect.objectContaining({ anchor: "sessionModal-830-0-hw/fw-unicode-café-label", kind: "dialog_label" }),
    ]);
  });

  it("rejects unsafe and duplicate anchors and does not invent a room column order", () => {
    const context = {
      sourceKey: "row",
      sourcePath: "event.md",
      sourceDigest: "1".repeat(64),
      date: "2023-11-07",
      authoredStart: "8:30",
    };
    expect(legacyAgendaFragments({}, { title: "Talk", locations: ["room"] }, context, {}).fragments).toEqual([]);
    const unsafe = legacyAgendaFragments(
      { locations: { order: ["room"] } },
      { title: "C#", locations: ["room"] },
      context,
      {},
    );
    expect(unsafe.fragments).toEqual([]);
    expect(unsafe.unresolved).toHaveLength(1);
    const source = {
      timezone: "Europe/Amsterdam",
      locations: { order: ["room"] },
      agenda: {
        "2023-11-07": [
          {
            time: "8:30",
            durationMinutes: 30,
            sessions: [
              { title: "Talk", locations: ["room"] },
              { title: "Talk", locations: ["room"] },
            ],
          },
        ],
      },
    };
    // A new agenda keeps the first row for a repeated anchor, as the single Hugo page did, and records the rest.
    const current = prepareLegacyAgendaImport(source, { sourcePath: "event.md" });
    expect(current.unresolved.filter((finding) => finding.kind === "legacy_fragment")).toEqual([]);
    expect(current.shadowedFragments.length).toBeGreaterThan(0);
    // An archive must reproduce every published anchor exactly, so the collision still blocks it.
    expect(
      prepareLegacyAgendaImport(source, { sourcePath: "event.md", archivePublicSource: true }).unresolved.filter(
        (finding) => finding.kind === "legacy_fragment",
      ),
    ).toHaveLength(2);
  });
});
