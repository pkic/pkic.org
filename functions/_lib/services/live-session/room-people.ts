import type { LiveRoomSql } from "./room-sql";

export interface LiveRoomPerson {
  photoUrl: string | null;
  staff: boolean;
  /** The person's opaque handle in this room; null when the room cannot sign one. */
  handle: string | null;
}

/**
 * What the room shows about the people who write in it: the public profile
 * photo they had when they last wrote, whether they operate the room, and
 * their room handle. Refreshed on every message and question; erased with the person.
 */
export class LiveRoomPeople {
  constructor(private readonly sql: LiveRoomSql) {}

  remember(userId: string, person: LiveRoomPerson): void {
    this.sql.exec(
      `INSERT INTO room_people(user_id, handle, photo_url, staff) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET handle = excluded.handle, photo_url = excluded.photo_url, staff = excluded.staff`,
      userId,
      person.handle,
      person.photoUrl,
      person.staff ? 1 : 0,
    );
  }

  people(userIds: readonly string[]): Map<string, LiveRoomPerson> {
    if (!userIds.length) return new Map();
    return new Map(
      this.sql
        .rows<{ user_id: string; handle: string | null; photo_url: string | null; staff: number }>(
          "SELECT user_id, handle, photo_url, staff FROM room_people WHERE user_id IN (SELECT value FROM json_each(?))",
          JSON.stringify([...new Set(userIds)]),
        )
        .map((row) => [row.user_id, { photoUrl: row.photo_url, staff: row.staff === 1, handle: row.handle }]),
    );
  }

  /** The person a handle names in this room, if anyone who wrote here holds it. */
  byHandle(handle: string): string | null {
    return (
      this.sql.rows<{ user_id: string }>("SELECT user_id FROM room_people WHERE handle = ?", handle)[0]?.user_id ?? null
    );
  }
}
