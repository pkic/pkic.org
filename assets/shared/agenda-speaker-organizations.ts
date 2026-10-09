import type { AgendaOccurrence, AgendaSnapshot } from "./schemas/event-agenda";

type SpeakerOrganizations = NonNullable<AgendaSnapshot["speakerOrganizations"]>;

/**
 * Acting identities an agenda credits. Approved appearances are always included;
 * pending proposal selections only for organizer drafts, which never reach a public projection.
 */
export function agendaCreditedIdentityIds(occurrences: readonly AgendaOccurrence[], drafts = true): string[] {
  const ids = new Set<string>();
  for (const occurrence of occurrences) {
    for (const appearance of occurrence.history?.appearances ?? [])
      if (appearance.actingIdentityId) ids.add(appearance.actingIdentityId);
    if (drafts)
      for (const selection of occurrence.history?.proposalRepresentations ?? [])
        if (selection.actingIdentityId && selection.selectedAt !== null) ids.add(selection.actingIdentityId);
  }
  return [...ids].sort();
}

/** Keep only the organizations of the credits a projection still carries. */
export function retainedSpeakerOrganizations(
  organizations: AgendaSnapshot["speakerOrganizations"],
  occurrences: readonly AgendaOccurrence[],
  drafts: boolean,
): AgendaSnapshot["speakerOrganizations"] {
  if (!organizations) return undefined;
  const retained: SpeakerOrganizations = {};
  for (const id of agendaCreditedIdentityIds(occurrences, drafts))
    if (Object.hasOwn(organizations, id)) retained[id] = organizations[id]!;
  return retained;
}

/**
 * The organization shown beside a credit: the credit's own frozen name when it recorded one,
 * otherwise the acting identity's organization. The logo always follows that identity's organization.
 */
export function agendaCreditOrganization(
  organizations: AgendaSnapshot["speakerOrganizations"],
  credit: { actingIdentityId?: string | null; organizationName?: string | null },
): { name: string; logoSrc?: string } | undefined {
  const live =
    credit.actingIdentityId && organizations && Object.hasOwn(organizations, credit.actingIdentityId)
      ? organizations[credit.actingIdentityId]
      : undefined;
  const name = credit.organizationName?.trim() || live?.name;
  if (!name) return undefined;
  return { name, ...(live?.logoUrl ? { logoSrc: live.logoUrl } : {}) };
}
