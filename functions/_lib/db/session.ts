import type { DatabaseLike } from "../types";

type D1SessionConstraint = "first-primary" | "first-unconstrained";

export type DatabaseSessionLike = DatabaseLike & {
  getBookmark?(): string | null;
};

export function withD1Session(db: DatabaseLike, constraint: D1SessionConstraint): DatabaseSessionLike {
  return db.withSession?.(constraint) ?? db;
}

export function readReplicaDb(db: DatabaseLike, bookmark?: string | null): DatabaseSessionLike {
  return db.withSession?.(bookmark || "first-unconstrained") ?? db;
}

export function primaryFirstDb(db: DatabaseLike): DatabaseSessionLike {
  return withD1Session(db, "first-primary");
}
