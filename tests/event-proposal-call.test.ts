import { seedEventAndAdmin } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { profileD1Flow } from "./helpers/d1-flow-profile";
import { isReadOnlySql } from "../functions/_lib/db/read-only-sql";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { callApi } from "./helpers/app";
import { eventDetailResponseSchema } from "../assets/shared/schemas/event-management";
import { prepareDirectEventFormSelection } from "../functions/_lib/services/events/direct-form-selection";
import { getEventById } from "../functions/_lib/services/events";
import { getActiveFormForEvent } from "../functions/_lib/services/forms";
import { prepareFormSubmissionGuard } from "../functions/_lib/services/forms/submission-command";
import { readEventProposalCall } from "../functions/_lib/services/events/proposal-call";

const at = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

async function insertEvent(input: { slug: string; endsAt?: string; basePath?: string | null; settings?: object }) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO events
       (id, slug, name, timezone, starts_at, ends_at, registration_mode, visibility,
        settings_json, links_json, profile_key, source_mode, base_path, created_at, updated_at)
     VALUES (?, ?, ?, 'UTC', ?, ?, 'open', 'public', ?, '[]', 'conference', 'integration', ?, datetime('now'), datetime('now'))`,
  )
    .bind(
      id,
      input.slug,
      `${input.slug} event`,
      at(30),
      input.endsAt ?? at(32),
      JSON.stringify(input.settings ?? {}),
      input.basePath === undefined ? `/events/2026/${input.slug}/` : input.basePath,
    )
    .run();
  return id;
}

async function placeProposalForm(eventId: string, window: { opensAt?: string; closesAt?: string } = {}) {
  const formId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO forms (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
       VALUES (?, ?, 'event', ?, 'proposal_submission', 'active', 'Call for proposals', NULL, datetime('now'), datetime('now'))`,
    ).bind(formId, `proposal-${formId}`, eventId),
    env.DB.prepare(
      `INSERT INTO form_placements
         (id, form_id, owner_group_id, context_type, context_ref, audience, active, opens_at, closes_at, created_at, updated_at)
       VALUES (?, ?, NULL, 'event', ?, 'speaker', 1, ?, ?, datetime('now'), datetime('now'))`,
    ).bind(crypto.randomUUID(), formId, eventId, window.opensAt ?? null, window.closesAt ?? null),
  ]);
}

beforeEach(async () => {
  await resetDb();
});

describe("event call for proposals", () => {
  it("is open only while a placed proposal form's window is open on a public, unfinished event", async () => {
    const open = await insertEvent({ slug: "open-call" });
    const closesAt = at(7);
    await placeProposalForm(open, { opensAt: at(-1), closesAt });
    await placeProposalForm(open, { opensAt: at(-1), closesAt: at(5) });
    // The placement that stays open longest decides when the call closes.
    expect(await readEventProposalCall(env.DB, open)).toEqual({
      open: true,
      path: "/events/2026/open-call/propose/",
      closesAt,
    });

    const scheduled = await insertEvent({ slug: "scheduled-call" });
    await placeProposalForm(scheduled, { opensAt: at(3) });
    const closed = await insertEvent({ slug: "closed-call" });
    await placeProposalForm(closed, { closesAt: at(-1) });
    const ended = await insertEvent({ slug: "ended-call", endsAt: at(-1) });
    await placeProposalForm(ended);
    const unpublished = await insertEvent({ slug: "unpublished-call", basePath: null });
    await placeProposalForm(unpublished);
    const unlinked = await insertEvent({ slug: "unlinked-call", settings: { forms: { proposal_submission: null } } });
    await placeProposalForm(unlinked);
    await env.DB.prepare("UPDATE form_placements SET active=0 WHERE context_ref=?").bind(unlinked).run();
    const none = await insertEvent({ slug: "no-call" });
    for (const id of [scheduled, closed, ended, unpublished, unlinked, none])
      expect(await readEventProposalCall(env.DB, id)).toEqual({ open: false, path: null, closesAt: null });
  });

  it("gives a website event its own window without changing the shared installation form", async () => {
    const id = await insertEvent({
      slug: "website-call",
      settings: { forms: { proposal_submission: "website-proposals" } },
    });
    const otherId = await insertEvent({
      slug: "other-website-call",
      settings: { forms: { proposal_submission: "website-proposals" } },
    });
    const formId = crypto.randomUUID();
    const globalPlacementId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO forms(id,key,scope_type,purpose,status,title,created_at,updated_at) VALUES (?, 'website-proposals', 'global', 'proposal_submission', 'active', 'Website proposals', ?, ?)",
      ).bind(formId, at(-10), at(-10)),
      env.DB.prepare(
        "INSERT INTO form_placements(id,form_id,context_type,context_ref,audience,active,created_at,updated_at) VALUES (?, ?, 'installation', NULL, 'speaker', 1, ?, ?)",
      ).bind(globalPlacementId, formId, at(-10), at(-10)),
    ]);
    const event = await getEventById(env.DB, id);
    const target = { id, source_mode: "hugo" };
    const save = async (window: { opensAt: string | null; closesAt: string | null }) => {
      await env.DB.batch(
        await prepareDirectEventFormSelection(
          env.DB,
          event,
          "proposal_submission",
          new Date().toISOString(),
          "website-proposals",
          window,
        ),
      );
      return (await getActiveFormForEvent(env.DB, target, "proposal_submission"))!;
    };
    const scheduled = await save({ opensAt: at(2), closesAt: at(5) });
    expect(scheduled.placement?.contextRef).toBe(id);
    expect(() => prepareFormSubmissionGuard(env.DB, scheduled)).toThrow("This form opens on");
    expect((await readEventProposalCall(env.DB, id)).open).toBe(false);
    const closed = await save({ opensAt: at(-2), closesAt: at(-1) });
    expect(closed.placement?.closesAt).toBeTruthy();
    expect(() => prepareFormSubmissionGuard(env.DB, closed)).toThrow("This form closed on");
    expect((await readEventProposalCall(env.DB, id)).open).toBe(false);
    const reopened = await save({ opensAt: at(-2), closesAt: null });
    await prepareFormSubmissionGuard(env.DB, reopened).run();
    expect((await readEventProposalCall(env.DB, id)).open).toBe(true);
    const replacementId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO forms(id,key,scope_type,purpose,status,title,created_at,updated_at) VALUES (?, 'replacement-proposals', 'global', 'proposal_submission', 'active', 'Replacement proposals', ?, ?)",
    )
      .bind(replacementId, at(-10), at(-10))
      .run();
    await env.DB.batch(
      await prepareDirectEventFormSelection(
        env.DB,
        event,
        "proposal_submission",
        new Date().toISOString(),
        "replacement-proposals",
      ),
    );
    const replacement = await getActiveFormForEvent(env.DB, target, "proposal_submission");
    expect(replacement?.id).toBe(replacementId);
    expect(replacement?.placement?.opensAt).toBe(reopened.placement?.opensAt);
    expect(replacement?.placement?.closesAt).toBeNull();
    expect(
      await env.DB.prepare("SELECT active,form_id FROM form_placements WHERE id=?")
        .bind(reopened.placement!.id)
        .first(),
    ).toEqual({ active: 0, form_id: formId });
    await env.DB.batch(
      await prepareDirectEventFormSelection(
        env.DB,
        event,
        "proposal_submission",
        new Date().toISOString(),
        "website-proposals",
      ),
    );
    expect((await getActiveFormForEvent(env.DB, target, "proposal_submission"))?.placement?.id).toBe(
      reopened.placement?.id,
    );

    const otherForm = await getActiveFormForEvent(env.DB, { id: otherId, source_mode: "hugo" }, "proposal_submission");
    expect(otherForm).toBeNull();
    const global = await env.DB.prepare("SELECT opens_at, closes_at FROM form_placements WHERE id=?")
      .bind(globalPlacementId)
      .first();
    expect(global).toEqual({ opens_at: null, closes_at: null });
  });

  it("is part of the event detail the portal reads", async () => {
    const id = await insertEvent({ slug: "detail-call" });
    await placeProposalForm(id);
    const response = await callApi(env, "/api/v1/events/detail-call");
    expect(response.status).toBe(200);
    const { event } = eventDetailResponseSchema.parse(await response.json());
    // A call without an end date has no close date to show.
    expect(event.proposalCall).toEqual({ open: true, path: "/events/2026/detail-call/propose/", closesAt: null });
  });
});

it("loads the mounted staff event detail with one participation batch and no primary guard writes", async () => {
  const fixture = await seedEventAndAdmin(env.DB);
  const token = await createAdminSession(env.DB, fixture.admin.id, crypto.randomUUID());
  const profile = profileD1Flow(env.DB);
  const response = await callApi({ ...env, DB: profile.db }, "/api/v1/events/pqc-2026", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  expect(eventDetailResponseSchema.parse(await response.json()).event.id).toBe(fixture.eventId);
  const report = await profile.report();
  expect(report.roundTrips).toBeLessThanOrEqual(4);
  expect(report.executedSql.every(isReadOnlySql)).toBe(true);
});
