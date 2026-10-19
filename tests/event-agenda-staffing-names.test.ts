import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { agendaSnapshotSchema, agendaStaffingSchema } from "../assets/shared/schemas/event-agenda";
import { AppError } from "../functions/_lib/errors";
import { saveAgendaStaffing } from "../functions/_lib/services/event-agenda/staffing";
import type { DatabaseLike, StatementLike } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { resetDb } from "./helpers/reset-db";

let eventId: string, token: string, actorId: string;
const catalogs = [
  {
    field: "staffingRoles",
    table: "event_agenda_staffing_roles",
    row: { id: "first", name: "Door scanner", showOnAgenda: false },
  },
  {
    field: "staffingPosts",
    table: "event_agenda_staffing_posts",
    row: { id: "first", name: "North door", roomId: null },
  },
] as const;
const input = (revision = 0) =>
  agendaStaffingSchema.parse({
    expectedRevision: revision,
    shifts: [],
    roleMembers: [],
    assignments: [],
    staffingRoles: [catalogs[0].row],
    staffingPosts: [catalogs[1].row],
  });
const request = (body: unknown, slug = "pqc-2026") =>
  callApi(env, `/api/v1/events/${slug}/agenda/staffing`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
async function state() {
  return {
    roles: await queryAll(
      env.DB,
      "SELECT event_id,id,name,show_on_agenda FROM event_agenda_staffing_roles ORDER BY event_id,id",
    ),
    posts: await queryAll(
      env.DB,
      "SELECT event_id,id,name,room_id FROM event_agenda_staffing_posts ORDER BY event_id,id",
    ),
    revisions: await queryAll(env.DB, "SELECT event_id,revision,updated_at FROM event_agenda_state ORDER BY event_id"),
    audits: await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id"),
  };
}
beforeEach(async () => {
  await resetDb();
  const seeded = await seedEventAndAdmin(env.DB);
  eventId = seeded.eventId;
  actorId = seeded.admin.id;
  token = await createAdminSession(env.DB, actorId, "staffing-name-validation");
});

describe("Event staffing catalog name refusals", () => {
  for (const { field, table, row } of catalogs) {
    it(`refuses creating a duplicate ${field} name at its actual name field without writes`, async () => {
      const before = await state();
      const body = { ...input(), [field]: [row, { ...row, id: "second", name: ` ${row.name} ` }] };
      const result = await request(body);
      expect(result.status).toBe(400);
      expect(await result.json()).toMatchObject({
        error: {
          code: "VALIDATION_ERROR",
          details: {
            fieldErrors: { [`${field}.1.name`]: [expect.stringContaining("unique")] },
          },
        },
      });
      expect(await state()).toEqual(before);
    });

    it(`refuses renaming another ${field} resource but accepts the same owned ID`, async () => {
      const body = { ...input(), [field]: [row, { ...row, id: "second", name: "Other name" }] };
      expect((await request(body)).status).toBe(200);
      const before = await state();
      const invalid = { ...body, expectedRevision: 1, [field]: [row, { ...row, id: "second" }] };
      const refused = await request(invalid);
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({
        error: {
          details: {
            fieldErrors: { [`${field}.1.name`]: [expect.stringContaining("unique")] },
          },
        },
      });
      expect(await state()).toEqual(before);
      const saved = await request({ ...body, expectedRevision: 1 });
      expect(saved.status).toBe(200);
      expect(agendaSnapshotSchema.parse(await saved.json()).revision).toBe(2);
    });

    it(`maps only the exact ${table} name constraint after a real atomic rollback`, async () => {
      expect((await request(input())).status).toBe(200);
      const before = await state();
      const statements = new WeakMap<StatementLike, string>();
      const originals = new WeakMap<StatementLike, StatementLike>();
      const wrap = (statement: StatementLike, sql: string): StatementLike => {
        const tracked: StatementLike = {
          bind: (...values) => wrap(statement.bind(...values), sql),
          run: <T = Record<string, unknown>>() => statement.run<T>(),
          all: <T = Record<string, unknown>>() => statement.all<T>(),
          first: <T = Record<string, unknown>>(column?: string) => statement.first<T>(column),
        };
        statements.set(tracked, sql);
        originals.set(tracked, statement);
        return tracked;
      };
      const db: DatabaseLike = {
        prepare: (sql) => wrap(env.DB.prepare(sql), sql),
        batch: (batch) => {
          const index = batch.findIndex((statement) => statements.get(statement)?.startsWith(`INSERT INTO ${table}(`));
          expect(index).toBeGreaterThanOrEqual(0);
          const collision =
            field === "staffingRoles"
              ? env.DB.prepare(
                  "INSERT INTO event_agenda_staffing_roles(event_id,id,name,show_on_agenda) VALUES(?,?,?,0)",
                )
              : env.DB.prepare("INSERT INTO event_agenda_staffing_posts(event_id,id,name,room_id) VALUES(?,?,?,NULL)");
          const actual = batch.map((statement) => originals.get(statement) ?? statement);
          return env.DB.batch([
            ...actual.slice(0, index),
            collision.bind(eventId, "interposed", row.name),
            ...actual.slice(index),
          ]);
        },
      };
      const body = agendaStaffingSchema.parse({ ...input(1), [field]: [{ ...row, id: "replacement" }] });
      const failure = await saveAgendaStaffing(db, eventId, "pqc-2026", body, actorId).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AppError);
      if (!(failure instanceof AppError)) throw new Error("Expected exact staffing name refusal");
      expect(failure).toMatchObject({
        status: 409,
        code: "AGENDA_STAFFING_NAME_CONFLICT",
        details: {
          fieldErrors: { [`${field}.0.name`]: [expect.stringContaining("unique")] },
        },
      });
      expect(await state()).toEqual(before);
    });
  }

  it("permits the same catalog names in another event", async () => {
    expect((await request(input())).status).toBe(200);
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,starts_at,ends_at,settings_json,created_at,updated_at) VALUES(?,?,'Other synthetic conference','Europe/Amsterdam',?,?, '{}',datetime('now'),datetime('now'))",
    )
      .bind(crypto.randomUUID(), "other-catalog", "2026-12-01T08:00:00.000Z", "2026-12-03T18:00:00.000Z")
      .run();
    const result = await request(input(), "other-catalog");
    expect(result.status).toBe(200);
    const saved = agendaSnapshotSchema.parse(await result.json());
    expect(saved.staffingRoles[0].name).toBe(catalogs[0].row.name);
    expect(saved.staffingPosts[0].name).toBe(catalogs[1].row.name);
  });

  it("retains a competing canonical catalog save with no losing audit or revision", async () => {
    let before = await state();
    const racing = mutateBeforeNextBatch(env.DB, async () => {
      const winner = input();
      winner.staffingRoles[0].id = "winner";
      await saveAgendaStaffing(env.DB, eventId, "pqc-2026", winner, actorId);
      before = await state();
    });
    await expect(saveAgendaStaffing(racing, eventId, "pqc-2026", input(), actorId)).rejects.toMatchObject({
      status: 409,
      code: "AGENDA_REVISION_CHANGED",
    });
    expect(await state()).toEqual(before);
  });

  it("propagates unrelated database failures without inventing a duplicate-name refusal", async () => {
    const error = new Error(
      "UNIQUE constraint failed: event_agenda_staffing_roles.event_id, event_agenda_staffing_roles.id",
    );
    const db: DatabaseLike = {
      prepare: (sql) => env.DB.prepare(sql),
      batch: async () => {
        throw error;
      },
    };
    const before = await state();
    await expect(saveAgendaStaffing(db, eventId, "pqc-2026", input(), actorId)).rejects.toBe(error);
    expect(await state()).toEqual(before);
  });
});
