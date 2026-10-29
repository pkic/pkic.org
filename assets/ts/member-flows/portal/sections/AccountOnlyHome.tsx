import { JoinPrompt } from "./JoinPrompt";
/**
 * Home for a signed-in person who holds no capacity: no membership, sponsorship,
 * staff role, event participation, or organization identity. They reach their
 * own account and the entries that apply for a capacity, nothing else.
 */
import { PageHeader } from "../../../ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { ButtonLink } from "../../../ui/Button";
import { usePortalHashLocation } from "../hash-location";
import { portalSession, profile } from "../state";
import { AffiliationOfferCard } from "./AffiliationOfferCard";

export function AccountOnlyHome() {
  const session = portalSession.value;
  const firstName = profile.value?.preferredName || profile.value?.firstName || "";
  const ownRecord = session?.identity.id ? `/users/${encodeURIComponent(session.identity.id)}` : null;

  return (
    <div class="pk pk-stack">
      <Panel stripe>
        <PanelBody>
          <PageHeader
            title="Home"
            description={`Welcome${firstName ? `, ${firstName}` : ""}. Your account is not linked to a membership, sponsorship, or event yet.`}
          />
        </PanelBody>
      </Panel>
      <AffiliationOfferCard />
      <Panel>
        <PanelHeader title="Your account">
          {ownRecord && <ButtonLink href={usePortalHashLocation.hrefs(ownRecord)}>Open my profile</ButtonLink>}
        </PanelHeader>
        <PanelBody>
          <p>Keep your name, email addresses, and notification choices up to date.</p>
        </PanelBody>
      </Panel>
      <JoinPrompt />
      <p>
        <ButtonLink href="/sponsors/sponsor/">Ask about sponsoring</ButtonLink>
      </p>
    </div>
  );
}
