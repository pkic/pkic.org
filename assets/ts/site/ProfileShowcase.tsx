/**
 * A person's professional profile: who they are, the capacities they hold or
 * held, and what they contributed. One layout in two modes. `public` is the
 * static page at /people/<slug>/, read-only. `owner` is the same page in the
 * portal for the person it describes: it also lists what is not published,
 * marked so, and carries the commands the portal supplies: each identity opens
 * its own edit view. Editing itself never happens on the showcase.
 */
import type { ComponentChildren } from "preact";
import type { PersonGroupRole, PersonProfile, PersonProfileIdentity } from "../../shared/schemas/person-profile";
import { formatMonthYear } from "../../shared/format-date";
import { contractClock } from "../../shared/event-clock";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { LinkList } from "../ui/LinkList";
import { Markdown } from "../ui/Markdown";
import { ProfileHeader } from "../ui/ProfileHeader";
import { AgendaSpeakerOrganizationLogo } from "./AgendaSpeakerAffiliations";
import { AgendaSpeakerSessionList } from "./AgendaSpeakerProfile";
import "../../design/tokens.agenda.generated.css";
import "../../design/tokens.event.generated.css";
import "./AgendaSpeaker.css";
import "./ProfileShowcase.css";

export type ProfileShowcaseMode = "public" | "owner";

/** Only staff withhold an identity from the public page; its owner still sees it, marked. */
const HIDDEN_LABEL = "Hidden from your public page by an administrator";

function period(startsAt: string | null, endsAt: string | null): string | null {
  if (!startsAt && !endsAt) return null;
  const start = startsAt ? formatMonthYear(startsAt) : "";
  return `${start} – ${endsAt ? formatMonthYear(endsAt) : "Present"}`.trim();
}

function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="pk-profile-showcase__section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function IdentityItem({
  identity,
  mode,
  action,
}: {
  identity: PersonProfileIdentity;
  mode: ProfileShowcaseMode;
  action: ComponentChildren;
}) {
  const organization = identity.organization;
  const when = period(identity.startedAt, identity.endedAt);
  return (
    <li class="pk-profile-showcase__identity">
      <span class="pk-profile-showcase__mark" title={organization?.name}>
        {organization?.logoSrc ? <AgendaSpeakerOrganizationLogo organization={organization} size="preview" /> : null}
      </span>
      <div class="pk-stack pk-stack--snug">
        <h3>{identity.title ?? organization?.name ?? "Independent"}</h3>
        {identity.title && organization ? (
          <p class="pk-profile-showcase__organization">
            {organization.href ? <a href={organization.href}>{organization.name}</a> : organization.name}
          </p>
        ) : null}
        {when ? <p class="pk-small pk-muted">{when}</p> : null}
        {mode === "owner" && (identity.visibility === "hidden" || action) ? (
          <div class="pk-cluster">
            {identity.visibility === "hidden" ? <Badge tone="neutral">{HIDDEN_LABEL}</Badge> : null}
            {action}
          </div>
        ) : null}
        {identity.biography ? <Markdown markdown={identity.biography} /> : null}
        {identity.links.length ? <LinkList compact links={identity.links} /> : null}
      </div>
    </li>
  );
}

function GroupItem({ role }: { role: PersonGroupRole }) {
  const when = period(role.startsAt, role.endsAt);
  return (
    <li>
      <strong>{role.groupName}</strong>
      <span>{role.title}</span>
      {when ? <span class="pk-small pk-muted">{when}</span> : null}
    </li>
  );
}

export function ProfileShowcase({
  profile,
  mode,
  actions,
  identityAction,
}: {
  profile: PersonProfile;
  mode: ProfileShowcaseMode;
  /** The owner's commands: view the public page, open the edit views. */
  actions?: ComponentChildren;
  /** The owner's command on one identity: open its own edit view. */
  identityAction?: (identity: PersonProfileIdentity) => ComponentChildren;
}) {
  const identities =
    mode === "owner" ? profile.identities : profile.identities.filter((identity) => identity.visibility !== "hidden");
  const hasContributions = profile.events.length + profile.groups.length + profile.candidacies.length > 0;
  return (
    <article class="pk-profile-showcase" data-profile-mode={mode}>
      <ProfileHeader
        tone="field"
        headingLevel={mode === "public" ? 1 : 2}
        media={<Avatar name={profile.name} src={profile.imageSrc ?? undefined} size="xl" original />}
        title={profile.name}
        lede={profile.headline ?? undefined}
        facts={profile.links.length ? [<LinkList compact links={profile.links} ownerName={profile.name} />] : []}
        actions={mode === "owner" ? actions : undefined}
      />
      {profile.biographyMarkdown ? (
        <Section title="About">
          <Markdown markdown={profile.biographyMarkdown} />
        </Section>
      ) : null}
      {identities.length ? (
        <Section title="Experience">
          <ul class="pk-profile-showcase__identities">
            {identities.map((identity) => (
              <IdentityItem
                key={identity.id}
                identity={identity}
                mode={mode}
                action={mode === "owner" ? identityAction?.(identity) : null}
              />
            ))}
          </ul>
        </Section>
      ) : null}
      {profile.events.length ? (
        <Section title="Speaking">
          {profile.events.map((event) => (
            <AgendaSpeakerSessionList
              key={event.agendaPage}
              headingLevel="h3"
              heading={<a href={event.agendaPage}>{event.eventName}</a>}
              sessions={event.sessions}
              timeZone={contractClock(event)}
            />
          ))}
        </Section>
      ) : null}
      {profile.groups.length ? (
        <Section title="Working groups and governance">
          <ul class="pk-profile-showcase__list">
            {profile.groups.map((role, index) => (
              <GroupItem key={`${role.groupSlug}-${index}`} role={role} />
            ))}
          </ul>
        </Section>
      ) : null}
      {profile.candidacies.length ? (
        <Section title="Elections">
          <ul class="pk-profile-showcase__list">
            {profile.candidacies.map((candidacy) => (
              <li key={candidacy.voteSlug}>
                <a href={`/votes/${encodeURIComponent(candidacy.voteSlug)}/`}>{candidacy.voteTitle}</a>
                <span>Candidate</span>
                <span class="pk-small pk-muted">{formatMonthYear(candidacy.closesAt)}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {mode === "owner" && !profile.route ? (
        <p class="pk-profile-showcase__section pk-muted">
          {hasContributions
            ? "Your public page is on its way. It appears with the next site update."
            : "You don't have a public page yet. Speaking at a conference, holding a seat in a public working group or standing in a public election creates one."}
        </p>
      ) : null}
    </article>
  );
}
