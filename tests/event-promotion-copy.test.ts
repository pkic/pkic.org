import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { promotionFixture, eventBase } from "./helpers/promotion-fixture";
import { resetDb } from "./helpers/reset-db";
import { callApi } from "./helpers/app";
import { publicAgendaProjection } from "../functions/_lib/services/event-agenda/public-projection";
import { promotionKitSchema } from "../assets/shared/schemas/event-promotion-kit";
import { agendaSnapshotSchema } from "../assets/shared/schemas/event-agenda";

type Fixture = Awaited<ReturnType<typeof promotionFixture>>;

const approvedCopy = {
  whyAttend: "A reviewed summary of the practical migration session.",
  takeaways: ["Inventory cryptography"],
  callToAction: "Register to attend",
  campaign: "speaker-kit",
  approvedAt: "2026-10-03T00:00:00.000Z",
};

function save(
  f: Fixture,
  expectedApprovedAt: string | null,
  copy: Record<string, unknown> = approvedCopy,
  headers: Fixture["headers"] = f.headers,
) {
  return callApi(
    env,
    f.sessionBase,
    { method: "POST", headers, body: JSON.stringify({ expectedApprovedAt, copy }) },
    { maxRoundTrips: 1 },
  );
}

async function readKit(f: Fixture) {
  const response = await callApi(env, f.sessionBase, { headers: f.headers });
  expect(response.status, await response.clone().text()).toBe(200);
  return promotionKitSchema.parse(await response.json());
}

function agendaState(f: Fixture) {
  return env.DB.prepare(
    "SELECT state.revision,state.published_revision,(SELECT COUNT(*) FROM event_agenda_publications WHERE event_id=state.event_id) AS publications FROM event_agenda_state state WHERE state.event_id=?",
  )
    .bind(f.eventId)
    .first();
}

function savedAudits() {
  return env.DB.prepare("SELECT entity_type,entity_id FROM audit_log WHERE action='agenda.promotion_copy.saved'").all();
}

describe("session promotion copy", () => {
  beforeEach(() => resetDb());

  it("reaches the kit without an agenda revision or a new publication", async () => {
    const f = await promotionFixture();
    const before = await agendaState(f);
    const original = await readKit(f);

    const saved = await save(f, null);
    expect(saved.status, await saved.clone().text()).toBe(200);
    const agenda = agendaSnapshotSchema.parse(await saved.json());
    expect(agenda.revision).toBe(agenda.publishedRevision);
    expect(agenda.occurrences[0]).toMatchObject({ promotionCopy: approvedCopy, publicationStatus: "published" });

    const kit = await readKit(f);
    expect(kit.copy).toEqual(approvedCopy);
    expect(kit.publishedRevision).toBe(original.publishedRevision);
    expect(kit.fingerprint).not.toBe(original.fingerprint);
    expect(await agendaState(f)).toEqual(before);
    expect((await savedAudits()).results).toEqual([{ entity_type: "event_agenda_occurrence", entity_id: f.sessionId }]);
  });

  it("keeps the session description until the copy is approved", async () => {
    const f = await promotionFixture();
    expect((await save(f, null, { ...approvedCopy, approvedAt: null })).status).toBe(200);
    const kit = await readKit(f);
    expect(kit.copy.whyAttend).toContain("practical session abstract");
    expect(kit.copy.takeaways).toEqual([]);
    expect(kit.copy.approvedAt).toBeNull();
  });

  it("refuses a stale editor and an unauthorized one without writing, but not an agenda edit", async () => {
    const f = await promotionFixture();
    expect((await save(f, null)).status).toBe(200);
    const replacement = { ...approvedCopy, callToAction: "Save your seat", approvedAt: "2026-10-04T00:00:00.000Z" };

    const stale = await save(f, null, replacement);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "PROMOTION_COPY_CHANGED" } });
    expect((await save(f, approvedCopy.approvedAt, replacement, f.attendeeHeaders)).status).toBe(403);
    expect((await readKit(f)).copy).toEqual(approvedCopy);
    expect((await savedAudits()).results).toHaveLength(1);

    await env.DB.prepare("UPDATE event_agenda_state SET revision=revision+1 WHERE event_id=?").bind(f.eventId).run();
    expect((await save(f, approvedCopy.approvedAt, replacement)).status).toBe(200);
    expect((await readKit(f)).copy).toEqual(replacement);
  });

  it("stays out of new publications and is dropped from earlier approved agendas", async () => {
    const f = await promotionFixture();
    expect((await save(f, null)).status).toBe(200);
    const { revision } = (await agendaState(f)) as { revision: number };
    const edited = await callApi(env, `${eventBase}/agenda/occurrences/${f.sessionId}`, {
      method: "PATCH",
      headers: f.headers,
      body: JSON.stringify({ expectedRevision: revision, title: "Planning a quantum-safe rollout" }),
    });
    expect(edited.status, await edited.clone().text()).toBe(200);
    const published = await callApi(env, `${eventBase}/agenda/publications`, {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({ expectedRevision: revision + 1 }),
    });
    expect(published.status, await published.clone().text()).toBe(200);

    const stored = await env.DB.prepare(
      "SELECT publication.snapshot_json,occurrence.payload_json FROM event_agenda_publications publication JOIN event_agenda_published_occurrences occurrence ON occurrence.event_id=publication.event_id AND occurrence.revision=publication.revision WHERE publication.event_id=? AND publication.revision=?",
    )
      .bind(f.eventId, revision + 2)
      .first<{ snapshot_json: string; payload_json: string }>();
    expect(stored!.snapshot_json).not.toContain("promotionCopy");
    expect(stored!.payload_json).not.toContain("promotionCopy");

    const approved = agendaSnapshotSchema.parse(JSON.parse(stored!.snapshot_json));
    const earlier = {
      ...approved,
      occurrences: approved.occurrences.map((item) => ({ ...item, promotionCopy: approvedCopy })),
    };
    const projected = publicAgendaProjection(earlier, {
      basePath: null,
      visibility: "public",
      city: "Toronto",
      country: "CA",
    });
    expect(projected.occurrences[0]!.promotionCopy).toBeUndefined();
  });
});
