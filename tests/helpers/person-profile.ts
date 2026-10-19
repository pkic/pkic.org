import { readSitePublicationSnapshot } from "../../functions/_lib/services/site-publication-snapshot";
import { publishedPersonPages } from "../../functions/_lib/services/site-session-history";
import { publishedPersonProfile } from "../../functions/_lib/services/site-person-profile";
import { env } from "cloudflare:workers";
import { nowIso } from "../../functions/_lib/utils/time";

export async function insertGroupSeat(
  slug: string,
  flags: { publicRoster: boolean },
  seat: { userId: string; memberId: string; identityId: string },
) {
  const groupId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO groups (id, type_key, name, slug, active, public_roster, created_at, updated_at)
     VALUES (?, 'working_group', ?, ?, 1, ?, ?, ?)`,
  )
    .bind(groupId, `${slug} group`, slug, flags.publicRoster ? 1 : 0, nowIso(), nowIso())
    .run();
  await env.DB.prepare(
    `INSERT INTO group_memberships (id, group_id, user_id, identity_id, member_id, source, joined_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'staff', ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), groupId, seat.userId, seat.identityId, seat.memberId, nowIso(), nowIso(), nowIso())
    .run();
}

/** The person profile the static renderer receives, if this publication renders its page. */
export async function readPublicPersonProfile(userId: string) {
  const publication = await readSitePublicationSnapshot(env.DB, []);
  const page = publishedPersonPages(publication).find((person) => person.userId === userId);
  return page ? publishedPersonProfile(publication, page) : undefined;
}
