import { SiteImage } from "./SiteImage";
import { Fragment } from "preact";
import { memberProfileLinks } from "../../shared/member-profile-links";
import { formatMonthYear } from "../../shared/format-date";
import type { PublicMemberDetail as MemberDetail } from "../../shared/schemas/members-directory";
import { Markdown } from "../ui/Markdown";
import { Panel, PanelBody, PanelHeader } from "../ui/Panel";
import { LinkList } from "../ui/LinkList";
import { Avatar } from "../ui/Avatar";
import "../ui/Content.css";
import "./member-directory.css";
type PublicIdentity = MemberDetail["identities"][number];

function IdentityCard({ identity }: { identity: PublicIdentity }) {
  return (
    <article class="member-representative">
      <div class="pk-stack pk-stack--snug">
        <div class="member-representative-heading">
          {/* Decorative: the name it belongs to is the heading beside it. */}
          <Avatar name={identity.name} src={identity.photoUrl ?? undefined} size="xl" />
          <div class="pk-stack pk-stack--tight">
            <h3>{identity.name}</h3>
            {identity.jobTitle && <p class="pk-muted">{identity.jobTitle}</p>}
            <LinkList links={memberProfileLinks(identity)} ownerName={identity.name} />
          </div>
        </div>
        {identity.bio && (
          <div class="member-representative-bio">
            <Markdown markdown={identity.bio} />
          </div>
        )}
      </div>
    </article>
  );
}

export function MemberDetailView({
  member,
  directoryHref,
  workingGroups = [],
}: {
  member: MemberDetail;
  directoryHref: string;
  workingGroups?: ReadonlyArray<{ name: string; href: string }>;
}) {
  const namedLinks: Array<[string, string | null | undefined]> = [
    ["Website", member.website],
    ["Press", member.pressUrl],
    ["Careers", member.careersUrl],
    ["Blog", member.blogUrl],
  ];

  return (
    <div class="pk pk-stack pk-stack--loose pk-section">
      <header class="pk-container member-profile-header">
        <div class="member-profile-logo-wrap pk-cluster pk-cluster--center">
          {member.logoUrl ? (
            <SiteImage class="member-profile-logo" alt={member.name} src={member.logoUrl} />
          ) : (
            <Avatar name={member.name} shape="square" size="xl" />
          )}
        </div>
        <div class="member-profile-introduction">
          <p class="member-profile-membership">Member of the PKI Consortium</p>
          <h1>{member.name}</h1>
          {member.jobTitle && <p class="member-profile-slogan">{member.jobTitle}</p>}
          {member.slogan && <p class="member-profile-slogan">{member.slogan}</p>}
          {member.description && <p class="member-profile-description">{member.description}</p>}
        </div>
      </header>

      <div
        class={
          member.content
            ? "pk-container member-profile-body"
            : "pk-container member-profile-body member-profile-body--details"
        }
      >
        {member.content && (
          <div class="member-profile-content pk-stack">
            <Markdown markdown={member.content} />
          </div>
        )}
        <Panel class="member-profile-details">
          <PanelHeader title="Member details" headingLevel={2} />
          <PanelBody class="pk-stack pk-stack--snug">
            {/* A term/value list, which is what this always was: it used to be
                a run of `<strong>Label:</strong> value<br>` inside a `<small>`,
                so nothing paired a term with its value for a reader who could
                not see the layout. */}
            <dl class="pk-datalist pk-small">
              <dt>Member since</dt>
              <dd>{formatMonthYear(member.memberSince)}</dd>
              {namedLinks.map(([label, url]) =>
                url ? (
                  <Fragment key={label}>
                    <dt>{label}</dt>
                    <dd class="pk-break">
                      <a href={url} target="_blank" rel="noopener">
                        {url.replace(/^https?:\/\//, "")}
                      </a>
                    </dd>
                  </Fragment>
                ) : null,
              )}
            </dl>
            {/*
              The profile links, as the marked row the portal and every contact
              record already use — not as a `<dt>LinkedIn</dt>` over a raw
              address, which is what issue #13 reports: the portal grew the
              shared list and this page kept printing URLs. A term list is the
              wrong shape for them anyway. The set is owner-ordered and
              open-ended, so the mark comes from the host rather than from a
              label this page would have to keep a table for.
            */}
            <LinkList links={member.links} ownerName={member.name} />
            {workingGroups.length > 0 && (
              <div class="member-profile-working-groups" aria-labelledby="member-working-groups">
                <h3 id="member-working-groups">Working groups</h3>
                <ul>
                  {workingGroups.map((group) => (
                    <li key={group.href}>
                      <a href={group.href}>{group.name}</a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </PanelBody>
        </Panel>
      </div>

      {member.identities.length > 0 && (
        <section class="pk-container pk-stack" aria-labelledby="member-representatives">
          <h2 id="member-representatives">Representatives</h2>
          <div class="member-representatives">
            {member.identities.map((identity) => (
              <IdentityCard key={identity.name} identity={identity} />
            ))}
          </div>
        </section>
      )}

      <p class="pk-container">
        <a href={directoryHref}>&larr; Back to members</a>
      </p>
    </div>
  );
}
