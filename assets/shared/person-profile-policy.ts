import type { PersonIdentityVisibility, PublishedPerson, PublishedPersonIdentity } from "./schemas/person-profile";
import { personProfileRoute } from "./public-agenda-pages";

/**
 * The publication rule for one identity on a person's profile. Identities are
 * not hidden in principle: every identity the person holds or held is public,
 * an ended one as past, unless staff withheld it from the public profile.
 */
export function personIdentityVisibility(identity: { hiddenFromPublicProfile: boolean }): PersonIdentityVisibility {
  return identity.hiddenFromPublicProfile ? "hidden" : "public";
}

/** Only an identity staff did not withhold may cross into a public projection. */
export function publicPersonIdentities<T extends Pick<PublishedPersonIdentity, "visibility">>(
  identities: readonly T[],
): T[] {
  return identities.filter((identity) => identity.visibility !== "hidden");
}

/**
 * Something public of the person's own beyond their agenda appearances: a
 * seat or leadership term in a group that publishes it, or a candidacy in an
 * election whose page is rendered. An identity alone never counts, since
 * everybody has one; it shows on a page a contribution earned.
 */
export function personHasPublicContribution(
  person: Pick<PublishedPerson, "groups" | "candidacies">,
  votePage: (slug: string) => boolean,
): boolean {
  return person.groups.length > 0 || person.candidacies.some((candidacy) => votePage(candidacy.voteSlug));
}

/**
 * The page rule for a person without an approved appearance: their page is
 * rendered, and may be linked, only while they hold an address and have a
 * public contribution to show on it. A speaker's page follows
 * `publishedSpeakerProfileRoute` instead.
 */
export function publishedContributorRoute(
  person: Pick<PublishedPerson, "slug" | "groups" | "candidacies">,
  votePage: (slug: string) => boolean,
): string | undefined {
  return person.slug && personHasPublicContribution(person, votePage) ? personProfileRoute(person.slug) : undefined;
}
