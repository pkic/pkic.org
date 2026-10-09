import { all } from "../db/queries";
import type { DatabaseLike } from "../types";
import type { SitePublicationSnapshot } from "../../../assets/shared/schemas/site-publication";
import { USER_HEADSHOT_PATH } from "../../../assets/shared/headshot-variants";
import { userHeadshotKeyFile } from "./user-headshot";

/** Only image references selected by public read models authorize an R2 export. */
export function publishedMediaReferences(snapshot: SitePublicationSnapshot): string[] {
  const references = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (value?.startsWith("/api/v1/")) references.add(value);
  };
  for (const member of snapshot.members) {
    add(member.logoUrl);
    for (const identity of member.identities) add(identity.photoUrl);
  }
  for (const directory of Object.values(snapshot.groups)) {
    for (const entry of [
      ...directory.leadership,
      ...directory.pastLeadership,
      ...(directory.roster?.current ?? []),
      ...(directory.roster?.past ?? []),
    ]) {
      add(entry.person.photoUrl);
      add(entry.person.organizationLogoUrl);
    }
  }
  for (const groups of Object.values(snapshot.sponsors))
    for (const group of groups) for (const sponsor of group.sponsors) add(sponsor.logoUrl);
  for (const agenda of Object.values(snapshot.eventAgendas ?? {})) {
    for (const occurrence of agenda.occurrences) {
      if (occurrence.kind === "break") for (const sponsor of occurrence.sponsors ?? []) add(sponsor.logoUrl);
      // Approved credits may name a person's R2 headshot; source-only credits carry static paths.
      for (const credit of [...(occurrence.history?.appearances ?? []), ...(occurrence.history?.archivalCredits ?? [])])
        add(credit.photoUrl);
    }
    for (const organization of Object.values(agenda.speakerOrganizations ?? {})) add(organization.logoUrl);
  }
  for (const entry of snapshot.memberWall) add(entry.logoUrl);
  return [...references].sort();
}

export async function resolvePublishedMediaKeys(
  db: DatabaseLike,
  references: string[],
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const members = references.flatMap((url) => {
    const match = /^\/api\/v1\/members\/([^/]+)\/logo$/.exec(url);
    return match ? [decodeURIComponent(match[1]!)] : [];
  });
  for (let offset = 0; offset < members.length; offset += 25) {
    const ids = members.slice(offset, offset + 25);
    const placeholders = ids.map(() => "?").join(",");
    const rows = await all<{ id: string; image_key: string | null; priority: number }>(
      db,
      `SELECT id, logo_r2_key AS image_key, 0 AS priority FROM organizations WHERE id IN (${placeholders})
      UNION ALL SELECT m.id, u.headshot_r2_key AS image_key, 1 AS priority FROM members m JOIN users u ON u.id=m.user_id WHERE m.id IN (${placeholders})
      UNION ALL SELECT identity.id, u.headshot_r2_key AS image_key, 2 AS priority FROM identities identity JOIN users u ON u.id=identity.user_id WHERE identity.id IN (${placeholders}) ORDER BY priority`,
      [...ids, ...ids, ...ids],
    );
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      if (row.image_key) result[`/api/v1/members/${encodeURIComponent(row.id)}/logo`] = row.image_key;
    }
  }
  const sponsors = references.flatMap((url) => {
    const match = /^\/api\/v1\/sponsors\/([^/]+)\/logo$/.exec(url);
    return match ? [decodeURIComponent(match[1]!)] : [];
  });
  for (let offset = 0; offset < sponsors.length; offset += 100) {
    const ids = sponsors.slice(offset, offset + 100);
    const placeholders = ids.map(() => "?").join(",");
    const rows = await all<{ id: string; image_key: string | null }>(
      db,
      `SELECT id, non_member_logo_r2_key AS image_key FROM sponsorships WHERE id IN (${placeholders})`,
      ids,
    );
    for (const row of rows)
      if (row.image_key) result[`/api/v1/sponsors/${encodeURIComponent(row.id)}/logo`] = row.image_key;
  }
  const headshots = references.flatMap((url) => {
    const match = USER_HEADSHOT_PATH.exec(url);
    return match ? [{ url, userId: decodeURIComponent(match[1]!), file: decodeURIComponent(match[2]!) }] : [];
  });
  for (let offset = 0; offset < headshots.length; offset += 100) {
    const batch = headshots.slice(offset, offset + 100);
    const rows = await all<{ id: string; headshot_r2_key: string | null }>(
      db,
      `SELECT id, headshot_r2_key FROM users WHERE id IN (SELECT value FROM json_each(?))
        AND active=1 AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL`,
      [JSON.stringify([...new Set(batch.map((entry) => entry.userId))])],
    );
    const keys = new Map(rows.map((row) => [row.id, row.headshot_r2_key]));
    for (const entry of batch) {
      const key = keys.get(entry.userId) ?? null;
      // Only the file the credit froze is published; a replaced or removed portrait is never substituted.
      if (key && userHeadshotKeyFile(key) === entry.file) result[entry.url] = key;
    }
  }
  for (const reference of references)
    if (!result[reference] && !USER_HEADSHOT_PATH.test(reference))
      throw new Error("A published image reference has no source object");
  return result;
}
