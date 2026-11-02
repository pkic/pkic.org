/**
 * A person's profile read live for the portal: the same projection the
 * static page renders, from the same published agendas and contributions.
 * Its owner also receives their hidden identities, marked as hidden.
 */
import { all, first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import { memberProfileHref } from "../../../../assets/shared/member-profile-url";
import { publicationAgendaPage } from "../../../../assets/shared/publication-agenda-routes";
import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import type { PersonProfileAudience, PersonProfileResponse } from "../../../../assets/shared/schemas/person-profile";
import { personDisplayNameSql } from "./person-name-sql";
import { projectPublishedAgendas, readPublishedAgendasCrediting } from "../site-publication-agendas";
import { publishedSpeakerHistory } from "../site-session-history";
import { personProfile } from "../site-person-profile";
import { readPublishedPeople } from "./published-person";

/** Member pages of these organizations, by the rule the member directory publishes them. */
async function readOrganizationPages(db: DatabaseLike, organizationIds: readonly string[]) {
  if (!organizationIds.length) return new Map<string, string>();
  const rows = await all<{ id: string; slug: string | null }>(
    db,
    `SELECT organization.id, organization.slug FROM organizations organization
      WHERE organization.id IN (SELECT value FROM json_each(?))
        AND EXISTS (SELECT 1 FROM members member JOIN member_category_assignments category ON category.member_id = member.id
                     WHERE member.organization_id = organization.id AND member.status = 'active')`,
    [JSON.stringify([...new Set(organizationIds)].slice(0, 100))],
  );
  return new Map(rows.map((row) => [row.id, memberProfileHref(row)]));
}

export async function readPersonProfile(
  db: DatabaseLike,
  userId: string,
  audience: PersonProfileAudience,
): Promise<PersonProfileResponse> {
  const account = await first<{ name: string }>(
    db,
    `SELECT ${personDisplayNameSql("person", "Member")} AS name FROM users person
      WHERE person.id = ? AND person.merged_into_user_id IS NULL AND person.pii_redacted_at IS NULL`,
    [userId],
  );
  if (!account) throw new AppError(404, "USER_NOT_FOUND", "User not found");
  const projected = await projectPublishedAgendas(db, await readPublishedAgendasCrediting(db, userId));
  const eventAgendas: Record<string, AgendaSnapshot> = Object.fromEntries(
    projected.map(({ row, publicAgenda }) => [row.slug, publicAgenda]),
  );
  const speaker = publishedSpeakerHistory({ eventAgendas }).find((entry) => entry.userId === userId);
  const person = (await readPublishedPeople(db, [userId], audience))[userId];
  const organizationPages = await readOrganizationPages(db, [
    ...(person?.identities ?? []).flatMap((identity) => (identity.organizationId ? [identity.organizationId] : [])),
    ...(speaker?.appearances ?? []).flatMap((item) =>
      item.credit.affiliations.flatMap((affiliation) =>
        affiliation.organizationId ? [affiliation.organizationId] : [],
      ),
    ),
  ]);
  return {
    audience,
    profile: personProfile({
      userId,
      accountName: account.name,
      page: speaker,
      person,
      links: {
        organizationPage: (organizationId) => (organizationId ? organizationPages.get(organizationId) : undefined),
        // Authored event pages are resolved from site content at build time; the portal links the agenda itself.
        agendaPage: (agenda) => publicationAgendaPage({ eventAgendas }, agenda),
        // Every candidacy read here is in a public, uncancelled election, which has its own page.
        votePage: () => true,
      },
    }),
  };
}
