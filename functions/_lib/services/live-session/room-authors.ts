import { PUBLIC_LIVE_QUESTION_STATUSES } from "../../../../assets/shared/live-session-policy";
import { personProfileRoute } from "../../../../assets/shared/public-agenda-pages";
import {
  liveAuthorDetailsSchema,
  liveAuthorStampSchema,
  type LiveAuthorDetails,
  type LiveAuthorStamp,
} from "../../../../assets/shared/schemas/live-session-author";
import { publicSessionPortraitUrlSchema } from "../../../../assets/shared/schemas/event-session-history";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { liveRoomName, type LiveRoomParticipant } from "./room-admission";
import { readLiveAuthorStamp } from "./room-author-stamp";
import type { LiveRoomPeople } from "./room-people";
import type { LiveRoomSql } from "./room-sql";

const encoder = new TextEncoder();
const NO_STAMP: LiveAuthorStamp = { affiliation: null, roles: [] };

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

/** A message still shown: not hidden or held, and not written by someone banned from the chat. */
const SHOWN_CHAT = `chat.id NOT IN (SELECT message_id FROM room_chat_hidden)
  AND chat.author_user_id NOT IN (SELECT user_id FROM room_chat_restrictions WHERE restriction = 'banned')`;

export function parseLiveAuthorStamp(json: string | null | undefined): LiveAuthorStamp {
  if (!json) return NO_STAMP;
  const parsed = liveAuthorStampSchema.safeParse(JSON.parse(json));
  return parsed.success ? parsed.data : NO_STAMP;
}

/**
 * The authors of a room: their opaque handles, who each was when they wrote
 * (capacity and roles, frozen with the message or question), and their
 * cards. A card resolves only for someone who wrote something the asking
 * viewer can still see in this room, and never for a redacted or merged
 * account, so a handle cannot be used to look anyone up.
 */
export class LiveRoomAuthors {
  constructor(
    private readonly sql: LiveRoomSql,
    readonly people: LiveRoomPeople,
    private readonly env: { DB: DatabaseLike; INTERNAL_SIGNING_SECRET?: string },
    private readonly room: () => { eventId: string; occurrenceId: string } | null,
  ) {}

  /** The person's handle in this room: a keyed digest of the room and the person, never their id. */
  async handle(userId: string): Promise<string | null> {
    const secret = this.env.INTERNAL_SIGNING_SECRET;
    const room = this.room();
    if (!secret || !room) return null;
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
    ]);
    const name = liveRoomName(room.eventId, room.occurrenceId);
    const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(`live-author:v1:${name}:${userId}`));
    return base64url(new Uint8Array(digest).slice(0, 24));
  }

  /** Remembers who is writing, and returns who they are now, to record with what they write. */
  async writing(viewer: LiveRoomParticipant): Promise<LiveAuthorStamp> {
    const room = this.room();
    if (!viewer.userId || !room) return NO_STAMP;
    const [handle, stamp] = await Promise.all([
      this.handle(viewer.userId),
      readLiveAuthorStamp(this.env.DB, room.eventId, viewer),
    ]);
    this.people.remember(viewer.userId, {
      photoUrl: viewer.photoUrl ?? null,
      staff: viewer.role === "operator",
      handle,
    });
    return stamp;
  }

  recordMessage(messageId: string, stamp: LiveAuthorStamp): void {
    this.sql.exec(
      "INSERT OR REPLACE INTO room_chat_authorship(message_id, author_json) VALUES (?, ?)",
      messageId,
      JSON.stringify(stamp),
    );
  }

  recordQuestion(questionId: string, stamp: LiveAuthorStamp): void {
    this.sql.exec(
      "INSERT OR REPLACE INTO question_authorship(question_id, author_json) VALUES (?, ?)",
      questionId,
      JSON.stringify(stamp),
    );
  }

  messageStamps(ids: readonly string[]): Map<string, LiveAuthorStamp> {
    return this.stamps("room_chat_authorship", "message_id", ids);
  }

  questionStamps(ids: readonly string[]): Map<string, LiveAuthorStamp> {
    return this.stamps("question_authorship", "question_id", ids);
  }

  private stamps(table: string, key: string, ids: readonly string[]): Map<string, LiveAuthorStamp> {
    if (!ids.length) return new Map();
    return new Map(
      this.sql
        .rows<{ id: string; author_json: string }>(
          `SELECT ${key} AS id, author_json FROM ${table} WHERE ${key} IN (SELECT value FROM json_each(?))`,
          JSON.stringify(ids),
        )
        .map((row) => [row.id, parseLiveAuthorStamp(row.author_json)]),
    );
  }

  /** Drops what was recorded for messages and questions the room no longer holds. */
  prune(): void {
    this.sql.exec(
      "DELETE FROM room_chat_authorship WHERE message_id NOT IN (SELECT id FROM room_chat UNION ALL SELECT id FROM room_operator_chat)",
    );
    this.sql.exec("DELETE FROM question_authorship WHERE question_id NOT IN (SELECT id FROM questions)");
  }

  /**
   * The latest thing this person wrote that the viewer can see here: a shown
   * attendee message (operators also see operator chat), or a question under
   * their name that the viewer may read. Anonymous questions never count.
   */
  private latestVisible(userId: string, viewer: LiveRoomParticipant) {
    const staff = viewer.role === "operator";
    const statuses = staff ? ["pending", "approved", "answered"] : PUBLIC_LIVE_QUESTION_STATUSES;
    return this.sql.rows<{ name: string; author_json: string | null; at: string }>(
      `SELECT author_name AS name, author_json, at FROM (
         SELECT chat.author_name, authorship.author_json, chat.sent_at AS at
           FROM room_chat chat LEFT JOIN room_chat_authorship authorship ON authorship.message_id = chat.id
          WHERE chat.author_user_id = ? AND ${SHOWN_CHAT}
         ${
           staff
             ? `UNION ALL SELECT chat.author_name, authorship.author_json, chat.sent_at
           FROM room_operator_chat chat LEFT JOIN room_chat_authorship authorship ON authorship.message_id = chat.id
          WHERE chat.author_user_id = ? AND chat.id NOT IN (SELECT message_id FROM room_chat_hidden)`
             : ""
         }
         UNION ALL SELECT question.author_name, authorship.author_json, question.asked_at
           FROM questions question LEFT JOIN question_authorship authorship ON authorship.question_id = question.id
          WHERE question.author_user_id = ? AND question.anonymous = 0
            AND question.status IN (SELECT value FROM json_each(?)))
       ORDER BY at DESC LIMIT 1`,
      ...(staff ? [userId, userId] : [userId]),
      userId,
      JSON.stringify(statuses),
    )[0];
  }

  /** The card a handle names for this viewer, or null when it names no one they may see. */
  async lookup(viewer: LiveRoomParticipant, handle: string): Promise<LiveAuthorDetails | null> {
    if (viewer.role === "overlay") return null;
    const userId = this.people.byHandle(handle);
    if (!userId) return null;
    const latest = this.latestVisible(userId, viewer);
    if (!latest) return null;
    const account = await first<{ slug: string | null }>(
      this.env.DB,
      `SELECT address.slug FROM users person
         LEFT JOIN person_profile_slugs address ON address.user_id = person.id AND address.retired_at IS NULL
        WHERE person.id = ? AND person.active = 1 AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL`,
      [userId],
    );
    if (!account) return null;
    const photo = this.people.people([userId]).get(userId)?.photoUrl ?? null;
    const stamp = parseLiveAuthorStamp(latest.author_json);
    return liveAuthorDetailsSchema.parse({
      handle,
      name: latest.name,
      // A stored photo that no longer passes the public portrait rule is left out rather than refusing the card.
      photoUrl: photo && publicSessionPortraitUrlSchema.safeParse(photo).success ? photo : null,
      affiliation: stamp.affiliation,
      roles: stamp.roles,
      profilePath: account.slug ? personProfileRoute(account.slug) : null,
    });
  }
}
