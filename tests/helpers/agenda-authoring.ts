import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { agendaSnapshotSchema, agendaOccurrenceCreateSchema } from "../../assets/shared/schemas/event-agenda";
import type { DatabaseLike } from "../../functions/_lib/types";
import { callApi } from "./app";
import { createAdminSession } from "./auth";
import { queryAll, seedEventAndAdmin } from "./context";

/** One mounted editor client for the settings, manual-break, and person-preview regression suites. */
export async function agendaAuthoringFixture() {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
  const token = await createAdminSession(env.DB, admin.id, crypto.randomUUID());
  const base = "/api/v1/events/pqc-2026/agenda";
  const raw = (
    suffix: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
    db: DatabaseLike = env.DB,
  ) =>
    callApi({ ...env, DB: db }, base + suffix, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const saved = async (response: Response) => {
    expect(response.status, await response.clone().text()).toBe(200);
    return agendaSnapshotSchema.parse(await response.json());
  };
  const create = async (input: Parameters<typeof agendaOccurrenceCreateSchema.parse>[0]) =>
    saved(await raw("/occurrences", agendaOccurrenceCreateSchema.parse(input)));
  const settings = async () => {
    const row = await env.DB.prepare("SELECT settings_json FROM events WHERE id=?")
      .bind(eventId)
      .first<{ settings_json: string }>();
    return JSON.parse(row!.settings_json) as Record<string, unknown>;
  };
  return { eventId, adminId: admin.id, raw, saved, create, settings };
}

export async function agendaAuthoringEffects() {
  const result: Record<string, unknown[]> = {};
  for (const table of [
    "events",
    "event_agenda_rooms",
    "event_agenda_occurrences",
    "event_agenda_occurrence_rooms",
    "event_agenda_occurrence_speakers",
    "event_agenda_session_history",
    "event_agenda_state",
    "event_agenda_publications",
    "event_agenda_published_occurrences",
    "audit_log",
    "email_outbox",
    "site_publication_requests",
    "agenda_session_participations",
    "agenda_session_holds",
  ])
    result[table] = await queryAll(env.DB, `SELECT * FROM ${table} ORDER BY rowid`);
  return result;
}
