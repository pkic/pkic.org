/**
 * A person's long-lived public profile address, /people/<slug>/. One table
 * holds every address a person was ever given; one rule plans every change.
 *
 * An address is issued for a contribution that earns a page: by the agenda
 * approval that credits a speaker, and by the scheduled issuance for a public
 * group seat, leadership term or election candidacy, which those many writers
 * share instead of each minting their own. An identity never earns one.
 */
import { prepareSitePublicationRequest } from "../site-publication-requests";
import { all } from "../../db/queries";
import { batchRows } from "../../db/pagination";
import type { DatabaseLike, D1StatementResult } from "../../types";
import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import {
  nextPublicPageSlug,
  personProfileSlugBase,
  publicPageSlugNameBase,
  publicPageSlugSchema,
} from "../../../../assets/shared/schemas/public-page-slug";
import { personDisplayNameSql } from "./person-name-sql";
import { PUBLIC_CANDIDACY_SOURCE_SQL, PUBLIC_LEADERSHIP_SOURCE_SQL, PUBLIC_SEAT_SOURCE_SQL } from "./published-person";

const BATCH = 100;
const HOLDER_PAGE = 500;
const PUBLIC_CONTRIBUTION_SQL = `(EXISTS(SELECT 1 ${PUBLIC_LEADERSHIP_SOURCE_SQL} AND ur.user_id=person.id)
  OR EXISTS(SELECT 1 ${PUBLIC_SEAT_SOURCE_SQL} AND membership.user_id=person.id)
  OR EXISTS(SELECT 1 ${PUBLIC_CANDIDACY_SOURCE_SQL} AND candidate.user_id=person.id))`;
// Enumerate contributors once for scheduled issuance instead of probing every account.
const PUBLIC_CONTRIBUTOR_IDS_SQL = `SELECT ur.user_id ${PUBLIC_LEADERSHIP_SOURCE_SQL}
  UNION SELECT membership.user_id ${PUBLIC_SEAT_SOURCE_SQL}
  UNION SELECT candidate.user_id ${PUBLIC_CANDIDACY_SOURCE_SQL}`;

export interface PersonProfileSlugRow {
  slug: string;
  userId: string;
  createdAt: string;
  retiredAt: string | null;
}
/** The name an address is made from, and when the person approved it for publication. */
export interface PersonProfileName {
  userId: string;
  displayName: string;
  approvedAt: string;
}
export type PersonProfileSlugChange =
  | { kind: "mint"; userId: string; slug: string }
  | { kind: "retire"; userId: string; slug: string }
  | { kind: "restore"; userId: string; slug: string };

/** Each credited person's latest approved appearance in this revision; frozen older approvals never move an address. */
export function approvedSpeakerNames(occurrences: AgendaSnapshot["occurrences"]): PersonProfileName[] {
  const latest = new Map<string, PersonProfileName>();
  for (const occurrence of occurrences)
    for (const appearance of occurrence.history?.appearances ?? []) {
      const current = latest.get(appearance.userId);
      if (!current || appearance.approvedAt > current.approvedAt)
        latest.set(appearance.userId, {
          userId: appearance.userId,
          displayName: appearance.displayName,
          approvedAt: appearance.approvedAt,
        });
    }
  return [...latest.values()].sort((a, b) => a.userId.localeCompare(b.userId));
}

/**
 * Plan address changes. A person keeps their current address unless a name
 * approved after it was minted differs; then a former address of theirs with
 * that name returns, or a new one is minted. A person without an address gets
 * one the same way. `taken` holds every stored slug that could collide with a
 * wanted base.
 */
export function planPersonProfileSlugs(
  people: readonly PersonProfileName[],
  rows: readonly PersonProfileSlugRow[],
  taken: ReadonlySet<string>,
): PersonProfileSlugChange[] {
  const reserved = new Set(taken);
  const changes: PersonProfileSlugChange[] = [];
  for (const person of people) {
    const own = rows.filter((row) => row.userId === person.userId);
    const current = own.find((row) => row.retiredAt === null);
    const base = personProfileSlugBase(person.displayName);
    if (current && (publicPageSlugNameBase(current.slug) === base || person.approvedAt <= current.createdAt)) continue;
    if (current) changes.push({ kind: "retire", userId: person.userId, slug: current.slug });
    const former = own.find((row) => row.retiredAt !== null && publicPageSlugNameBase(row.slug) === base);
    if (former) {
      changes.push({ kind: "restore", userId: person.userId, slug: former.slug });
      continue;
    }
    const slug = publicPageSlugSchema.parse(nextPublicPageSlug(base, reserved));
    reserved.add(slug);
    changes.push({ kind: "mint", userId: person.userId, slug });
  }
  return changes;
}

function prepareOwnedRows(db: DatabaseLike, userIds: readonly string[]) {
  const owned = [];
  for (let offset = 0; offset < userIds.length; offset += BATCH)
    owned.push(
      db
        .prepare(
          `SELECT slug,user_id AS userId,created_at AS createdAt,retired_at AS retiredAt FROM person_profile_slugs
          WHERE user_id IN (SELECT value FROM json_each(?)) ORDER BY user_id,created_at,slug`,
        )
        .bind(JSON.stringify(userIds.slice(offset, offset + BATCH))),
    );
  return owned;
}
async function readRows(db: DatabaseLike, userIds: readonly string[]) {
  const statements = prepareOwnedRows(db, userIds);
  return statements.length
    ? (await db.batch(statements)).flatMap((result) => batchRows<PersonProfileSlugRow>(result))
    : [];
}
function preparePersonSlugPlan(db: DatabaseLike, people: readonly PersonProfileName[]) {
  const owned = prepareOwnedRows(
    db,
    people.map((person) => person.userId),
  );
  const bases = [...new Set(people.map((person) => personProfileSlugBase(person.displayName)))];
  const collisions = [];
  for (let offset = 0; offset < bases.length; offset += BATCH) {
    collisions.push(
      db
        .prepare(
          `SELECT slug FROM person_profile_slugs slugs JOIN json_each(?) base
        ON slugs.slug=base.value OR (INSTR(slugs.slug,base.value||'-')=1 AND SUBSTR(slugs.slug,LENGTH(base.value)+2,1) BETWEEN '1' AND '9')`,
        )
        .bind(JSON.stringify(bases.slice(offset, offset + BATCH))),
    );
  }
  return {
    statements: [...owned, ...collisions],
    decode(loaded: D1StatementResult[]) {
      const rows = loaded.slice(0, owned.length).flatMap((result) => batchRows<PersonProfileSlugRow>(result));
      const taken = new Set(
        loaded.slice(owned.length).flatMap((result) => batchRows<{ slug: string }>(result).map((row) => row.slug)),
      );
      return planPersonProfileSlugs(people, rows, taken);
    },
  };
}

/**
 * The statements for a plan. A person who gained an address in a concurrent
 * write keeps it: an address is restored or minted only while the person holds
 * none. A concurrent write that minted the same slug for somebody else first
 * makes the batch fail on the primary key, so nobody ever shares an address.
 */
function changeStatements(db: DatabaseLike, changes: readonly PersonProfileSlugChange[], at: string) {
  const unheld = "NOT EXISTS(SELECT 1 FROM person_profile_slugs held WHERE held.user_id=? AND held.retired_at IS NULL)";
  return changes.map((change) =>
    change.kind === "retire"
      ? db
          .prepare("UPDATE person_profile_slugs SET retired_at=? WHERE slug=? AND user_id=? AND retired_at IS NULL")
          .bind(at, change.slug, change.userId)
      : change.kind === "restore"
        ? db
            .prepare(`UPDATE person_profile_slugs SET retired_at=NULL WHERE slug=? AND user_id=? AND ${unheld}`)
            .bind(change.slug, change.userId, change.userId)
        : db
            .prepare(
              `INSERT INTO person_profile_slugs(slug,user_id,created_at,retired_at) SELECT ?,?,?,NULL WHERE ${unheld}`,
            )
            .bind(change.slug, change.userId, at, change.userId),
  );
}

async function planSlugs(db: DatabaseLike, people: readonly PersonProfileName[]) {
  const read = preparePersonSlugPlan(db, people);
  return read.decode(read.statements.length ? await db.batch(read.statements) : []);
}

/** Statements that give every person this approval credits a public profile address, inside the approval's own batch. */
export function prepareSpeakerProfileSlugsRead(db: DatabaseLike, approved: AgendaSnapshot, at: string) {
  const read = preparePersonSlugPlan(db, approvedSpeakerNames(approved.occurrences));
  return {
    statements: read.statements,
    decode: (loaded: D1StatementResult[]) => changeStatements(db, read.decode(loaded), at),
  };
}

/**
 * Plan an address from each person's account name when they hold none yet. Somebody
 * who already has one keeps it unchanged.
 */
async function planPersonProfileAddresses(
  db: DatabaseLike,
  userIds: readonly string[],
  at: string,
): Promise<PersonProfileSlugChange[]> {
  const people: PersonProfileName[] = [];
  const ids = [...new Set(userIds)].sort();
  for (let offset = 0; offset < ids.length; offset += BATCH)
    people.push(
      ...(
        await all<{ userId: string; displayName: string }>(
          db,
          `SELECT person.id AS userId, ${personDisplayNameSql("person", "Member")} AS displayName
             FROM users person
            WHERE person.id IN (SELECT value FROM json_each(?))
              AND person.merged_into_user_id IS NULL AND person.pii_redacted_at IS NULL
              AND NOT EXISTS(SELECT 1 FROM person_profile_slugs held WHERE held.user_id=person.id AND held.retired_at IS NULL)
            ORDER BY person.id`,
          [JSON.stringify(ids.slice(offset, offset + BATCH))],
        )
      ).map((person) => ({ ...person, approvedAt: at })),
    );
  return planSlugs(db, people);
}

/**
 * People with a public contribution of their own and no address yet: a seat
 * or leadership term in a group that publishes it, or a candidacy in a public election. Read by the scheduled
 * issuance, in bounded pages.
 */
export async function readUnaddressedContributors(db: DatabaseLike, limit: number): Promise<string[]> {
  const rows = await all<{ id: string }>(
    db,
    `SELECT person.id FROM users person
      WHERE person.merged_into_user_id IS NULL AND person.pii_redacted_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM person_profile_slugs held WHERE held.user_id=person.id AND held.retired_at IS NULL)
        AND person.id IN (${PUBLIC_CONTRIBUTOR_IDS_SQL})
      ORDER BY person.id LIMIT ?`,
    [limit],
  );
  return rows.map((row) => row.id);
}

/** Give up to `limit` public contributors their address in one atomic batch. */
export async function issueContributorProfileAddresses(db: DatabaseLike, at: string, limit: number) {
  const userIds = await readUnaddressedContributors(db, limit);
  const changes = await planPersonProfileAddresses(db, userIds, at);
  const mutations = changeStatements(db, changes, at);
  const statements = mutations.flatMap((mutation, index) => {
    const userId = changes[index]!.userId;
    return [
      mutation,
      prepareSitePublicationRequest(
        db,
        {
          resourceType: "user_profile",
          resourceId: userId,
          revision: Date.parse(at),
          reasonCode: "user_profile_changed",
          deduplicationKey: `contributor-address:${at}:${userId}`,
        },
        {
          // Must immediately follow its address mutation: skipped writes leave no request.
          sql: `changes()=1 AND EXISTS(SELECT 1 FROM users person WHERE person.id=?
        AND person.merged_into_user_id IS NULL AND person.pii_redacted_at IS NULL
        AND ${PUBLIC_CONTRIBUTION_SQL})`,
          bindings: [userId],
        },
      ),
    ];
  });
  const results = statements.length ? await db.batch(statements) : [];
  const issued = changes.reduce(
    (count, change, index) =>
      count + (change.kind !== "retire" && (results[index * 2]?.meta?.changes ?? 0) > 0 ? 1 : 0),
    0,
  );
  return { examined: userIds.length, issued };
}

/** Each person's current address. */
export async function readPersonProfileSlugs(db: DatabaseLike, userIds: readonly string[]) {
  const slugs: Record<string, string> = {};
  for (const row of await readRows(db, userIds)) if (row.retiredAt === null) slugs[row.userId] = row.slug;
  return slugs;
}

/** Everybody who holds a current address, read in bounded pages. */
export async function readPersonProfileHolders(db: DatabaseLike): Promise<string[]> {
  const holders: string[] = [];
  for (let after = ""; ;) {
    const rows = await all<{ user_id: string }>(
      db,
      "SELECT user_id FROM person_profile_slugs WHERE retired_at IS NULL AND user_id > ? ORDER BY user_id LIMIT ?",
      [after, HOLDER_PAGE],
    );
    holders.push(...rows.map((row) => row.user_id));
    if (rows.length < HOLDER_PAGE) return holders;
    after = rows[rows.length - 1]!.user_id;
  }
}

/** Attach the current address of every person with an approved appearance in this projection. */
export async function withSpeakerProfileSlugs<T extends AgendaSnapshot>(db: DatabaseLike, snapshot: T): Promise<T> {
  return {
    ...snapshot,
    speakerProfileSlugs: await readPersonProfileSlugs(
      db,
      approvedSpeakerNames(snapshot.occurrences).map((person) => person.userId),
    ),
  };
}

/** Every former address of these people, leading to their current one. */
export async function readPersonProfileRedirects(db: DatabaseLike, current: Readonly<Record<string, string>>) {
  const rows = await readRows(db, Object.keys(current).sort());
  return rows
    .filter((row) => row.retiredAt !== null && current[row.userId] && current[row.userId] !== row.slug)
    .map((row) => ({ fromSlug: row.slug, toSlug: current[row.userId]! }))
    .sort((a, b) => a.fromSlug.localeCompare(b.fromSlug));
}
