import { describe, it, expect } from "vitest";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { sessionMaterialSchema } from "../../assets/shared/schemas/event-session-history";
const source = "../../functions/_lib/services/site-agenda-material-eligibility";
const eligibleVersion = (eventId: string, id: string) => ({
  event_id: eventId,
  id,
  source: "proposal",
  occurrence_id: "",
  event_slug: null,
  digest: null,
});
const material = (id: string) =>
  sessionMaterialSchema.parse({
    id,
    kind: "presentation",
    title: `Version ${id}`,
    url: `/materials/${id}.pdf`,
    presentationVersionId: id,
    version: 1,
    rightsConfirmed: true,
    consentConfirmed: true,
    validated: true,
    status: "approved",
    approvedAt: "2026-10-03T00:00:00.000Z",
  });
function snapshot() {
  return agendaSnapshotSchema.parse({
    eventSlug: "synthetic",
    revision: 2,
    publishedRevision: 2,
    timeZone: "UTC",
    rooms: [],
    blocks: [],
    roleMembers: [],
    assignments: [],
    occurrences: Array.from({ length: 3 }, (_, index) => ({
      id: `occurrence-${index}`,
      title: "Session",
      description: "Substantive approved archive text for public session pages.",
      startAt: "2026-12-01T09:00:00.000Z",
      endAt: "2026-12-01T10:00:00.000Z",
      roomId: null,
      speakers: [],
      presentationUrl: `/materials/${index * 50}.pdf`,
      history: { materials: Array.from({ length: 50 }, (_, item) => material(String(index * 50 + item))) },
    })),
  });
}
function currentRows(eventId: string, input: ReturnType<typeof snapshot>) {
  return input.occurrences.map((item) => ({
    event_id: eventId,
    occurrence_id: item.id,
    metadata_json: JSON.stringify(item.history),
  }));
}
describe("live archive material release projection", () => {
  it("bounds version queries, filters canonical eligibility and retains immutable approval history", async () => {
    const { projectLiveAgendaMaterials } = await import(source);
    const bindings: unknown[][] = [];
    const approved = snapshot();
    const db = {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => ({
          all: async () => {
            if (sql.includes("event_agenda_session_history")) return { results: currentRows("event", approved) };
            bindings.push(values);
            const pairs = JSON.parse(String(values[0])) as Array<{ eventId: string; id: string }>;
            return { results: pairs.some((pair) => pair.id === "0") ? [eligibleVersion("event", "0")] : [] };
          },
        }),
      }),
    };
    const projected = await projectLiveAgendaMaterials(db, "event", approved);
    expect(bindings).toHaveLength(2);
    expect(bindings.every((values) => (JSON.parse(String(values[0])) as unknown[]).length <= 100)).toBe(true);
    expect(projected.occurrences[0].history.materials.map((item: { id: string }) => item.id)).toEqual(["0"]);
    expect(projected.occurrences[1].history.materials).toEqual([]);
    expect(projected.occurrences[1].presentationUrl).toBeNull();
    expect(approved.occurrences[1]!.history!.materials).toHaveLength(50);
  });
  it("batches multiple events and never reuses another event's eligible version", async () => {
    const { projectLiveAgendaMaterialBatch } = await import(source);
    let queries = 0;
    const input = snapshot();
    input.occurrences = input.occurrences.slice(0, 1);
    input.occurrences[0]!.history!.materials = input.occurrences[0]!.history!.materials.slice(0, 1);
    const db = {
      prepare: (sql: string) => ({
        bind: () => ({
          all: async () => {
            queries++;
            return {
              results: sql.includes("event_agenda_session_history")
                ? currentRows("first", input)
                : [eligibleVersion("first", "0")],
            };
          },
        }),
      }),
    };
    const [first, second] = await projectLiveAgendaMaterialBatch(db, [
      { eventId: "first", snapshot: input },
      { eventId: "second", snapshot: input },
    ]);
    expect(queries).toBe(2);
    expect(first.occurrences[0].history.materials).toHaveLength(1);
    expect(second.occurrences[0].history.materials).toEqual([]);
  });
  it("matches session versions to the exact event and occurrence and honors live withdrawal", async () => {
    const { projectLiveAgendaMaterialBatch } = await import(source);
    const input = snapshot(),
      occurrenceId = "11111111-1111-4111-8111-111111111111",
      versionId = "22222222-2222-4222-8222-222222222222";
    input.occurrences = input.occurrences.slice(0, 2);
    input.occurrences[0]!.id = occurrenceId;
    for (const occurrence of input.occurrences)
      occurrence.history!.materials = [{ ...material(versionId), presentationSource: "session" }];
    const digest = "a".repeat(64);
    const db = {
      prepare: (sql: string) => ({
        bind: () => ({
          all: async () => ({
            results: sql.includes("event_agenda_session_history")
              ? [
                  {
                    event_id: "first",
                    occurrence_id: occurrenceId,
                    metadata_json: JSON.stringify({
                      materials: [{ ...input.occurrences[0]!.history!.materials[0], status: "withdrawn" }],
                    }),
                  },
                ]
              : [
                  {
                    event_id: "first",
                    id: versionId,
                    source: "session",
                    occurrence_id: occurrenceId,
                    event_slug: "synthetic",
                    digest,
                  },
                ],
          }),
        }),
      }),
    };
    const [first, foreign] = await projectLiveAgendaMaterialBatch(db, [
      { eventId: "first", snapshot: input },
      { eventId: "other", snapshot: input },
    ]);
    expect(first.occurrences[0].history.materials).toEqual([]);
    expect(first.occurrences[1].history.materials).toEqual([]);
    expect(
      foreign.occurrences.every(
        (occurrence: { history: { materials: unknown[] } }) => occurrence.history.materials.length === 0,
      ),
    ).toBe(true);
    expect(input.occurrences[0]!.history!.materials).toHaveLength(1);
  });
  it.each(["removed", "draft", "withdrawn", "failed", "rights", "consent", "validation", "approval", "url", "version"])(
    "cannot revive an old recording release after current %s changes",
    async (change) => {
      const { projectLiveAgendaMaterials } = await import(source);
      const input = snapshot();
      input.occurrences = input.occurrences.slice(0, 1);
      const released = sessionMaterialSchema.parse({
        ...material("recording"),
        kind: "recording",
        presentationVersionId: null,
        url: "https://www.youtube.com/watch?v=AbCdEf12345&start=90",
      });
      input.occurrences[0]!.history!.materials = [released];
      input.occurrences[0]!.recordingUrl = released.url;
      const current = { ...released };
      if (["draft", "withdrawn", "failed"].includes(change))
        current.status = change as "draft" | "withdrawn" | "failed";
      if (change === "rights") current.rightsConfirmed = false;
      if (change === "consent") current.consentConfirmed = false;
      if (change === "validation") current.validated = false;
      if (change === "approval") current.approvedAt = null;
      if (change === "url") current.url = "https://example.test/replacement";
      if (change === "version") current.version++;
      const db = {
        prepare: () => ({
          bind: () => ({
            all: async () => ({
              results: [
                {
                  event_id: "event",
                  occurrence_id: input.occurrences[0]!.id,
                  metadata_json: JSON.stringify({ materials: change === "removed" ? [] : [current] }),
                },
              ],
            }),
          }),
        }),
      };
      const projected = await projectLiveAgendaMaterials(db, "event", input);
      expect(projected.occurrences[0].history.materials).toEqual([]);
      expect(projected.occurrences[0].recordingUrl).toBeNull();
      expect(projected.occurrences[0].presentationUrl).toBeNull();
      expect(input.occurrences[0]!.history!.materials).toEqual([released]);
      expect(input.occurrences[0]!.recordingUrl).toContain("&start=90");
    },
  );
  it("retains the frozen released link through unrelated draft candidates and editorial history changes", async () => {
    const { projectLiveAgendaMaterials } = await import(source);
    const input = snapshot();
    input.occurrences = input.occurrences.slice(0, 1);
    const released = sessionMaterialSchema.parse({
      ...material("recording"),
      kind: "recording",
      presentationVersionId: null,
    });
    input.occurrences[0]!.history!.materials = [released];
    const db = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({
            results: [
              {
                event_id: "event",
                occurrence_id: input.occurrences[0]!.id,
                metadata_json: JSON.stringify({
                  prerequisites: "Unpublished editorial correction",
                  materials: [
                    { ...released, title: "Unpublished title correction" },
                    {
                      ...released,
                      id: "new-draft",
                      url: "https://example.test/new-candidate",
                      status: "draft",
                      approvedAt: null,
                    },
                  ],
                }),
              },
            ],
          }),
        }),
      }),
    };
    const projected = await projectLiveAgendaMaterials(db, "event", input);
    expect(projected.occurrences[0].history.materials).toEqual([released]);
    expect(projected.occurrences[0].recordingUrl).toBe(released.url);
    expect(input.occurrences[0]!.history!.materials).toEqual([released]);
  });
  it("fails extraction on authority lookup failure rather than publishing an unchecked last-good copy", async () => {
    const { projectLiveAgendaMaterials } = await import(source);
    const db = {
      prepare: () => ({
        bind: () => ({
          all: async () => {
            throw new Error("Authority unavailable");
          },
        }),
      }),
    };
    await expect(projectLiveAgendaMaterials(db, "event", snapshot())).rejects.toThrow("Authority unavailable");
  });
});
