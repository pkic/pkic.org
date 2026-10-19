import type { AgendaOccurrence, AgendaSnapshot } from "./schemas/event-agenda";
import type { SessionAffiliation } from "./schemas/event-session-history";
import type { ContentAgendaAffiliation } from "./site-agenda";

type SpeakerOrganizations = NonNullable<AgendaSnapshot["speakerOrganizations"]>;

/** A credit's affiliations, primary first: an appearance's own list, or a source credit's single recorded one. */
export function creditAffiliations(credit: object): SessionAffiliation[] {
  if ("affiliations" in credit && Array.isArray(credit.affiliations))
    return credit.affiliations as SessionAffiliation[];
  const title = "jobTitle" in credit && typeof credit.jobTitle === "string" ? credit.jobTitle.trim() : "";
  const organizationName =
    "organizationName" in credit && typeof credit.organizationName === "string" ? credit.organizationName.trim() : "";
  return title || organizationName
    ? [{ identityId: null, title: title || null, organizationId: null, organizationName: organizationName || null }]
    : [];
}

/** Organizations the agenda's approved appearances credit; their logos are projected live, never frozen. */
export function agendaCreditedOrganizationIds(occurrences: readonly AgendaOccurrence[]): string[] {
  const ids = new Set<string>();
  for (const occurrence of occurrences)
    for (const appearance of occurrence.history?.appearances ?? [])
      for (const affiliation of appearance.affiliations)
        if (affiliation.organizationId) ids.add(affiliation.organizationId);
  return [...ids].sort();
}

/** Keep only the organizations of the credits a projection still carries. */
export function retainedSpeakerOrganizations(
  organizations: AgendaSnapshot["speakerOrganizations"],
  occurrences: readonly AgendaOccurrence[],
): AgendaSnapshot["speakerOrganizations"] {
  if (!organizations) return undefined;
  const retained: SpeakerOrganizations = {};
  for (const id of agendaCreditedOrganizationIds(occurrences))
    if (Object.hasOwn(organizations, id)) retained[id] = organizations[id]!;
  return retained;
}

/**
 * One affiliation as shown: the frozen title and organization name, with the
 * organization's current logo when it has one. Without a name there is no badge.
 */
export function agendaAffiliationContent(
  organizations: AgendaSnapshot["speakerOrganizations"],
  affiliation: SessionAffiliation,
): ContentAgendaAffiliation {
  const live =
    affiliation.organizationId && organizations && Object.hasOwn(organizations, affiliation.organizationId)
      ? organizations[affiliation.organizationId]
      : undefined;
  const name = affiliation.organizationName?.trim() || live?.name;
  const title = name ? titleWithoutOrganization(affiliation.title ?? "", name) : affiliation.title?.trim();
  return {
    ...(title ? { title } : {}),
    ...(name ? { organization: { name, ...(live?.logoUrl ? { logoSrc: live.logoUrl } : {}) } } : {}),
  };
}

/**
 * A title recorded as free text often already names its organization ("President, LDIQ").
 * The organization is shown once, beside the title, so that mention is dropped from the title.
 */
export function titleWithoutOrganization(title: string, organizationName: string): string {
  const escaped = organizationName.trim().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  if (!escaped) return title.trim();
  const mention = new RegExp(`(?:\\s*(?:,|·|\\||-|–|—|@|\\bat\\b)\\s*)?\\b${escaped}\\b`, "gu");
  return title
    .replace(mention, "")
    .replace(/^[\s,·|@–—-]+|[\s,·|@–—-]+$/gu, "")
    .trim();
}

/** Every frozen affiliation as one plain-text summary for review screens: "Chair · PKI Consortium; CEO · Digitorus". */
export function affiliationsSummary(affiliations: readonly SessionAffiliation[]): string {
  return affiliations
    .map((affiliation) =>
      affiliationLabel({
        ...(affiliation.title ? { title: affiliation.title } : {}),
        ...(affiliation.organizationName ? { organization: { name: affiliation.organizationName } } : {}),
      }),
    )
    .filter(Boolean)
    .join("; ");
}

/** The plain-text line for one affiliation, as on cards and in structured data: "Chair · PKI Consortium". */
export function affiliationLabel(affiliation: ContentAgendaAffiliation): string {
  return [affiliation.title, affiliation.organization?.name].filter(Boolean).join(" · ");
}

/** A credit's affiliations as plain-text lines, primary first, for text-only surfaces such as promotion images. */
export function creditAffiliationLabels(credit: object): string[] {
  return creditAffiliations(credit)
    .map((affiliation) => affiliationLabel(agendaAffiliationContent(undefined, affiliation)))
    .filter(Boolean);
}

/** Every organization logo a set of affiliations shows, so a static build prepares each image once. */
export function affiliationLogoSources(affiliations: readonly ContentAgendaAffiliation[] | undefined): string[] {
  return (affiliations ?? []).flatMap((affiliation) =>
    affiliation.organization?.logoSrc ? [affiliation.organization.logoSrc] : [],
  );
}

/**
 * Every affiliation on one text line, for surfaces that cannot draw logos (a stream lower third):
 * "Chair · PKI Consortium | CEO · Digitorus". Without logos, each organization is named.
 */
export function affiliationsLine(affiliations: readonly ContentAgendaAffiliation[] | undefined): string {
  return (affiliations ?? []).map(affiliationLabel).filter(Boolean).join(" | ");
}
