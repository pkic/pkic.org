import { expect, it } from "vitest";
import { prepareLegacyAgendaImport } from "../../scripts/lib/legacy-agenda-import.mjs";
import { agendaTransferSchema } from "../../assets/shared/schemas/event-agenda-transfer";

it.each([false, true])(
  "emits exact reviewed row keys while keeping human mapping coordinates (override %s)",
  (override) => {
    const source = {
      timezone: "UTC",
      transitionMinutes: 0,
      agenda: {
        "2023-04-01": [
          {
            time: "10:00",
            durationMinutes: 60,
            noTransition: true,
            sessions: [
              { title: " ", speakers: ["Authored speaker"], description: "Authored abstract" },
              { title: "Other authored row", speakers: [] },
            ],
          },
        ],
      },
    };
    const config = { sourcePath: "content/events/historical/_index.md", archivePublicSource: true };
    const initial = prepareLegacyAgendaImport(source, config);
    const digest = initial.document.source.sourceDigest;
    const original = initial.document.occurrences[0]!.ref;
    const key = override ? "reviewed:historical:missing-title" : original;
    const reviewedAt = "2023-04-02T00:00:00.000Z";
    const prepared = prepareLegacyAgendaImport(source, {
      ...config,
      sourceRows: {
        "2023-04-01:0:0": {
          sourceDigest: digest,
          ...(override ? { sourceKey: key, reviewedAt } : {}),
          title: { decision: "title_not_recorded", reviewedAt },
          credits: { "Authored speaker": { decision: "retain_source_credit", reviewedAt } },
        },
      },
    });
    expect(prepared.ready, JSON.stringify(prepared.unresolved)).toBe(true);
    const document = agendaTransferSchema.parse(prepared.document);
    const row = document.occurrences[0]!;
    expect(row).toMatchObject({ ref: key, sourceKey: key, fields: { title: "Title not recorded" } });
    expect(row.archive!.sourceDecisions).toHaveLength(2);
    expect(
      row.archive!.sourceDecisions.map((decision) => [
        decision.sourcePath,
        decision.sourceDigest,
        decision.sourceLocator,
      ]),
    ).toEqual([
      [config.sourcePath, digest, key],
      [config.sourcePath, digest, key],
    ]);
    expect(prepared.sourceRows[0]).toMatchObject({
      sourceLocator: "2023-04-01:0:0",
      sourceKey: key,
      originalSourceKey: original,
    });
    expect(document.occurrences[1]!.ref).toBe(initial.document.occurrences[1]!.ref);
    expect(document.occurrences[1]!.archive?.sourceDecisions ?? []).toEqual([]);
  },
);
