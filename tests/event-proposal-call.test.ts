import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { callApi } from "./helpers/app";
import { eventDetailResponseSchema } from "../assets/shared/schemas/event-management";
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
    await placeProposalForm(open, { opensAt: at(-1), closesAt: at(7) });
    expect(await readEventProposalCall(env.DB, open)).toEqual({
      open: true,
      path: "/events/2026/open-call/propose/",
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
    const none = await insertEvent({ slug: "no-call" });
    for (const id of [scheduled, closed, ended, unpublished, unlinked, none])
      expect(await readEventProposalCall(env.DB, id)).toEqual({ open: false, path: null });
  });

  it("is part of the event detail the portal reads", async () => {
    const id = await insertEvent({ slug: "detail-call" });
    await placeProposalForm(id);
    const response = await callApi(env, "/api/v1/events/detail-call");
    expect(response.status).toBe(200);
    const { event } = eventDetailResponseSchema.parse(await response.json());
    expect(event.proposalCall).toEqual({ open: true, path: "/events/2026/detail-call/propose/" });
  });
});
