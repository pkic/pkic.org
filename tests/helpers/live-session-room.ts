import { env } from "cloudflare:workers";
import { vi, onTestFinished } from "vitest";
import { runInDurableObject } from "cloudflare:test";
import { closeLiveRoomSocket } from "../../functions/_lib/services/live-session/room-socket-close";
import type { z } from "zod";
import {
  LIVE_OVERLAY_PROTOCOL_PREFIX,
  LIVE_ROOM_PROTOCOL,
  liveRoomClientMessageSchema,
  liveRoomServerMessageSchema,
  type LiveRoomServerMessage,
} from "../../assets/shared/schemas/live-session-room";
import { getAgenda } from "../../functions/_lib/services/event-agenda/read";
import { liveRoomName } from "../../functions/_lib/services/live-session/room-admission";
import { grantAdministrator } from "./administrator";
import { callApi } from "./app";
import { createAdminSession } from "./auth";
import { resetDb } from "./reset-db";

const EVENT_SLUG = "live-room-test";
const ORIGIN = "https://app.test";

type Person = "attendee" | "secondAttendee" | "speaker" | "operator" | "secondOperator" | "outsider";

/**
 * A published session running now, with a registered attendee (two), a credited
 * speaker, two administrator operators and a signed-in outsider with no registration.
 */
export function createLiveRoomFixture() {
  const eventId = crypto.randomUUID();
  const users: Record<Person, string> = {
    attendee: crypto.randomUUID(),
    secondAttendee: crypto.randomUUID(),
    speaker: crypto.randomUUID(),
    operator: crypto.randomUUID(),
    secondOperator: crypto.randomUUID(),
    outsider: crypto.randomUUID(),
  };
  const tokens = {} as Record<Person, string>;
  let occurrenceId = "";
  let roomId = "";

  async function setup(window = { startOffsetMinutes: -5, durationMinutes: 60 }) {
    await resetDb();
    occurrenceId = crypto.randomUUID();
    roomId = crypto.randomUUID();
    const now = new Date().toISOString();
    const names: Record<Person, [string, string]> = {
      attendee: ["Ada", "Attendee"],
      secondAttendee: ["Bea", "Attendee"],
      speaker: ["Sam", "Speaker"],
      operator: ["Olga", "Operator"],
      secondOperator: ["Remote", "Rita"],
      outsider: ["Otto", "Outsider"],
    };
    for (const person of Object.keys(users) as Person[])
      await env.DB.prepare(
        "INSERT INTO users (id,email,normalized_email,first_name,last_name,active) VALUES (?,?,?,?,?,1)",
      )
        .bind(users[person], `${person}@example.test`, `${person}@example.test`, ...names[person])
        .run();
    await grantAdministrator(env.DB, users.operator);
    await grantAdministrator(env.DB, users.secondOperator);
    await env.DB.prepare(
      "INSERT INTO events (id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES (?,?,'Live room test','Europe/Amsterdam','invite_or_open','{}',?,?)",
    )
      .bind(eventId, EVENT_SLUG, now, now)
      .run();
    // A cancelled registration still signs a person in, but does not admit them as an attendee.
    for (const [person, status] of [
      ["attendee", "registered"],
      ["secondAttendee", "registered"],
      ["speaker", "cancelled"],
      ["outsider", "cancelled"],
    ] as const)
      await env.DB.prepare(
        "INSERT INTO registrations (id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES (?,?,?,?,'in_person','test',?,?,?)",
      )
        .bind(crypto.randomUUID(), eventId, users[person], status, crypto.randomUUID(), now, now)
        .run();
    const start = new Date(Date.now() + window.startOffsetMinutes * 60_000).toISOString();
    const end = new Date(Date.parse(start) + window.durationMinutes * 60_000).toISOString();
    await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name) VALUES (?,?,'Physical room')")
      .bind(roomId, eventId)
      .run();
    await env.DB.prepare("UPDATE events SET starts_at=?,ends_at=? WHERE id=?").bind(start, end, eventId).run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrences (id,event_id,title,room_id,start_at,end_at) VALUES (?,?,'Post-quantum migration',?,?,?)",
    )
      .bind(occurrenceId, eventId, roomId, start, end)
      .run();
    await env.DB.prepare("INSERT INTO event_agenda_occurrence_speakers (occurrence_id,user_id) VALUES (?,?)")
      .bind(occurrenceId, users.speaker)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,1,1,?)",
    )
      .bind(eventId, now)
      .run();
    const snapshot = await getAgenda(env.DB, eventId, EVENT_SLUG);
    snapshot.revision = 1;
    snapshot.publishedRevision = 1;
    const json = JSON.stringify(snapshot);
    await env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,1,?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, json, users.operator, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_published_occurrences(event_id,revision,occurrence_id,payload_json) SELECT ?,1,json_extract(occurrence.value,'$.id'),occurrence.value FROM json_each(?,'$.occurrences') occurrence",
    )
      .bind(eventId, json)
      .run();
    for (const person of Object.keys(users) as Person[])
      tokens[person] = await createAdminSession(env.DB, users[person], crypto.randomUUID());
    const room = env.LIVE_SESSION_ROOMS!.getByName(liveRoomName(eventId, occurrenceId));
    onTestFinished(() =>
      runInDurableObject(room, async (_instance, state) => {
        for (const socket of state.getWebSockets()) closeLiveRoomSocket(socket, 1000, "Fixture complete");
        await state.storage.deleteAlarm();
      }),
    );
  }

  function path(suffix = "") {
    return `/api/v1/events/${EVENT_SLUG}/agenda/occurrences/${occurrenceId}/live${suffix}`;
  }

  /** A signed-in person, or a read-only source with its access and the output it draws. */
  type Credential = { person: Person } | { overlay: string; output?: string };
  function upgrade(credential: Credential | null, headers: Record<string, string> = {}) {
    const protocols = [
      LIVE_ROOM_PROTOCOL,
      ...(credential && "overlay" in credential ? [LIVE_OVERLAY_PROTOCOL_PREFIX + credential.overlay] : []),
    ];
    const output = credential && "output" in credential && credential.output ? `?output=${credential.output}` : "";
    return callApi(env, path(output), {
      headers: {
        upgrade: "websocket",
        origin: ORIGIN,
        "sec-websocket-protocol": protocols.join(", "),
        ...(credential && "person" in credential ? { authorization: `Bearer ${tokens[credential.person]}` } : {}),
        ...headers,
      },
    });
  }

  /** How the room closed a socket it did not admit: the close code and the error code as reason. */
  async function refusal(credential: Credential | null, occurrence?: string) {
    const response = occurrence
      ? await callApi(env, `/api/v1/events/${EVENT_SLUG}/agenda/occurrences/${occurrence}/live`, {
          headers: {
            upgrade: "websocket",
            origin: ORIGIN,
            "sec-websocket-protocol": LIVE_ROOM_PROTOCOL,
            ...(credential && "person" in credential ? { authorization: `Bearer ${tokens[credential.person]}` } : {}),
          },
        })
      : await upgrade(credential);
    if (response.status !== 101) throw new Error(`Expected 101, got ${response.status}: ${await response.text()}`);
    const socket = response.webSocket!;
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      socket.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason })),
    );
    socket.accept();
    return { protocol: response.headers.get("sec-websocket-protocol"), ...(await closed) };
  }

  /** An accepted socket that records every message the room sends it. */
  async function connect(credential: Credential) {
    const response = await upgrade(credential);
    if (response.status !== 101) throw new Error(`Expected 101, got ${response.status}: ${await response.text()}`);
    const socket = response.webSocket!;
    const received: LiveRoomServerMessage[] = [];
    socket.addEventListener("message", (event) => {
      received.push(liveRoomServerMessageSchema.parse(JSON.parse(String(event.data))));
    });
    socket.accept();
    const client = {
      socket,
      received,
      protocol: response.headers.get("sec-websocket-protocol"),
      send(
        message:
          | z.input<typeof liveRoomClientMessageSchema>
          | (Omit<Extract<z.input<typeof liveRoomClientMessageSchema>, { type: "question.ask" }>, "operationId"> & {
              operationId?: string;
            })
          | Omit<
              Extract<z.input<typeof liveRoomClientMessageSchema>, { type: "question.moderate" }>,
              "expectedRevision"
            >,
      ) {
        socket.send(
          JSON.stringify(
            liveRoomClientMessageSchema.parse(
              message.type === "question.ask"
                ? { operationId: crypto.randomUUID(), ...message }
                : message.type === "question.moderate"
                  ? { expectedRevision: 0, ...message }
                  : message,
            ),
          ),
        );
      },
      /**
       * The latest message of a type once it has arrived. `after` skips the messages
       * received before that count, so an earlier match cannot stand in for a later one.
       */
      async next<T extends LiveRoomServerMessage["type"]>(
        type: T,
        where: (message: Extract<LiveRoomServerMessage, { type: T }>) => boolean = () => true,
        { after = 0 }: { after?: number } = {},
      ) {
        return vi.waitFor(
          () => {
            const found = received
              .slice(after)
              .reverse()
              .find(
                (message): message is Extract<LiveRoomServerMessage, { type: T }> =>
                  message.type === type && where(message as Extract<LiveRoomServerMessage, { type: T }>),
              );
            if (!found) throw new Error(`No ${type} message yet`);
            return found;
            // Deferred updates are flushed on the room's configured broadcast cadence.
          },
          { timeout: 3000 },
        );
      },
    };
    await client.next("room.snapshot");
    return client;
  }

  return {
    eventId,
    eventSlug: EVENT_SLUG,
    users,
    tokens,
    setup,
    path,
    upgrade,
    refusal,
    connect,
    get roomId() {
      return roomId;
    },
    programPath(suffix = "") {
      return `/api/v1/events/${EVENT_SLUG}/agenda/rooms/${roomId}/live${suffix}`;
    },
    get occurrenceId() {
      return occurrenceId;
    },
    room() {
      return env.LIVE_SESSION_ROOMS!.getByName(liveRoomName(eventId, occurrenceId));
    },
  };
}
