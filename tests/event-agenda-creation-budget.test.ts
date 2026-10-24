import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { agendaOccurrenceCreateSchema, agendaRoomCreateSchema } from "../assets/shared/schemas/event-agenda";
import { agendaAuthoringFixture, agendaAuthoringEffects } from "./helpers/agenda-authoring";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { profileD1Flow } from "./helpers/d1-flow-profile";
import { insertIndividualMembershipForUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { nowIso } from "../functions/_lib/utils/time";

beforeEach(resetDb);

function input(kind: "room" | "session", userId: string) {
  return kind === "room"
    ? {
        path: "/rooms",
        body: agendaRoomCreateSchema.parse({ expectedRevision: 0, name: "Planning hall", capacity: null }),
      }
    : {
        path: "/occurrences",
        body: agendaOccurrenceCreateSchema.parse({
          expectedRevision: 0,
          title: "Planning session",
          startAt: null,
          endAt: null,
          roomId: null,
          speakerUserIds: [userId],
        }),
      };
}

describe("complete agenda creation requests", () => {
  it.each(["room", "session"] as const)(
    "composes %s preflight with authentication and projects the atomic response",
    async (kind) => {
      const f = await agendaAuthoringFixture();
      const request = input(kind, f.adminId);
      const profile = profileD1Flow(env.DB);
      const saved = await f.saved(await f.raw(request.path, request.body, "POST", profile.db));
      expect(saved.revision).toBe(1);
      expect(kind === "room" ? saved.rooms[0].name : saved.occurrences[0].title).toBe(
        kind === "room" ? "Planning hall" : "Planning session",
      );
      // Preflight and the guarded command remain two complete-request calls; the one-call target is unfinished.
      expect((await profile.report()).roundTrips).toBe(2);
      const fresh = await f.saved(await f.raw(""));
      expect(saved).toEqual(fresh);
    },
  );

  for (const kind of ["room", "session"] as const) {
    it.each(["permission", "session", "revision", "settings"] as const)(
      `rolls back ${kind} creation when %s changes before the command`,
      async (change) => {
        const f = await agendaAuthoringFixture();
        const request = input(kind, f.adminId);
        let raced = false;
        let concurrent: Awaited<ReturnType<typeof agendaAuthoringEffects>> | undefined;
        const db = mutateBeforeMatchingQuery(
          env.DB,
          (sql) =>
            sql.startsWith(
              kind === "room" ? "INSERT INTO event_agenda_rooms(" : "INSERT INTO event_agenda_occurrences(",
            ),
          async () => {
            raced = true;
            if (change === "permission")
              await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?")
                .bind(nowIso(), f.adminId)
                .run();
            else if (change === "session")
              await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?").bind(nowIso(), f.adminId).run();
            else if (change === "revision")
              await env.DB.prepare(
                "INSERT INTO event_agenda_state(event_id,revision,updated_at) VALUES(?,1,?) ON CONFLICT(event_id) DO UPDATE SET revision=revision+1",
              )
                .bind(f.eventId, nowIso())
                .run();
            else
              await env.DB.prepare("UPDATE events SET settings_json=json_set(settings_json,'$.competing',1) WHERE id=?")
                .bind(f.eventId)
                .run();
            concurrent = await agendaAuthoringEffects();
          },
        );
        const response = await f.raw(request.path, request.body, "POST", db);
        expect(raced).toBe(true);
        expect(response.ok).toBe(false);
        expect(concurrent).toBeDefined();
        expect(await agendaAuthoringEffects()).toEqual(concurrent);
      },
    );
  }

  it("rechecks an explicitly chosen speaker identity inside the creation command", async () => {
    const f = await agendaAuthoringFixture();
    const { identityId } = await insertIndividualMembershipForUser(env.DB, f.adminId);
    const body = agendaOccurrenceCreateSchema.parse({
      ...input("session", f.adminId).body,
      title: "Chosen identity",
      speakerIdentityIds: { [f.adminId]: [identityId] },
    });
    const before = await agendaAuthoringEffects();
    let raced = false;
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.startsWith("INSERT INTO event_agenda_occurrences("),
      async () => {
        raced = true;
        await env.DB.prepare("UPDATE identities SET ended_at=? WHERE id=?").bind(nowIso(), identityId).run();
      },
    );
    const response = await f.raw("/occurrences", body, "POST", db);
    expect(raced).toBe(true);
    expect(response.ok).toBe(false);
    expect(await agendaAuthoringEffects()).toEqual(before);
  });
});
