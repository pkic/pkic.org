import { guardDatabaseBatches } from "../../db/guarded-database";
import { readReplicaDb, type DatabaseSessionLike } from "../../db/session";
import type { DatabaseLike, StatementLike } from "../../types";
import type { LiveRoomStore } from "./room-store";

/**
 * A room's monotonic D1 session survives hibernation without caching authority.
 * Reads opt into replicas; D1 forwards writes (such as first-use check-in keys)
 * to primary and advances the same cursor, preserving subsequent read-your-writes.
 */
export class LiveRoomDatabaseSession implements DatabaseLike {
  private session: DatabaseSessionLike | undefined;
  private admissionBookmark: string | null = null;
  private readonly db: DatabaseLike;

  constructor(
    private readonly sourceDb: DatabaseLike,
    private readonly store: LiveRoomStore,
  ) {
    this.db = guardDatabaseBatches(
      {
        prepare: (query) => this.current().prepare(query),
        batch: (statements) => this.current().batch(statements),
      },
      async (statements) => {
        const session = this.current();
        const results = await session.batch(statements);
        const bookmark = session.getBookmark?.();
        if (bookmark) this.store.saveD1ReadBookmark(bookmark);
        return results;
      },
    );
  }

  /** Only the first admission seeds a room; later clients cannot replace its established cursor. */
  seedBookmark(bookmark?: string | null): void {
    if (!this.session && !this.admissionBookmark && bookmark) this.admissionBookmark = bookmark;
  }

  private current(): DatabaseSessionLike {
    // The same D1 session advances its own opaque bookmark across overlapping
    // reads. Persist its latest cursor, never compare or order bookmark strings.
    return (this.session ??= readReplicaDb(this.sourceDb, this.store.d1ReadBookmark() ?? this.admissionBookmark));
  }

  prepare(query: string): StatementLike {
    return this.db.prepare(query);
  }

  batch(statements: StatementLike[]) {
    return this.db.batch(statements);
  }

  /** Purging room storage also discards its read cursor. Durable D1 copy writes use the original binding. */
  reset(): void {
    this.session = undefined;
    this.admissionBookmark = null;
  }
}
