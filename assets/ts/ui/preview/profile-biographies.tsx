/** General and organization biography fields rendered with synthetic gallery data. */
import { useState } from "preact/hooks";
import { IdentityProfileFields, type IdentityProfileDraft } from "../../components/identities/IdentityProfileFields";
import { Panel, PanelBody, PanelHeader } from "../Panel";

export function ProfileBiographiesExample() {
  return (
    <div class="pk-preview__shelf pk-preview__shelf--stack">
      <Panel aria-label="About">
        <PanelHeader title="About" />
        <PanelBody>
          <p class="pk-small pk-muted">From the Example Trust profile.</p>
          <p class="pk-affiliation__summary">
            Ana works on certificate validation and public key infrastructure. She helps teams design services, review
            operational practices, and plan improvements across their certificate lifecycle. Her experience includes
            research, engineering, and collaboration with standards groups. She shares practical guidance through
            workshops and community projects, bringing together people from different organizations to solve common
            challenges and improve the reliability of the services they operate.
          </p>
        </PanelBody>
      </Panel>
      <BiographyFieldsExample organization={false} />
      <BiographyFieldsExample organization />
    </div>
  );
}

function BiographyFieldsExample({ organization }: { organization: boolean }) {
  const [draft, setDraft] = useState<IdentityProfileDraft>({
    jobTitle: organization ? "Security researcher" : "",
    biography: "Ir. Dr. Ana works on certificate validation.\n\nDr. Ana shares practical guidance with the community.",
    links: ["https://github.com/example", "https://www.linkedin.com/in/example"],
  });
  return (
    <Panel>
      <PanelHeader title={organization ? "Speaker profile: Example Trust" : "About you"} />
      <PanelBody>
        <div class="pk-stack">
          <IdentityProfileFields
            draft={draft}
            onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            of={() => ({})}
            organizationId={organization ? "00000000-0000-4000-8000-000000000099" : null}
            organizationName={organization ? "Example Trust" : null}
            purpose={organization ? "speaker" : "profile"}
          />
        </div>
      </PanelBody>
    </Panel>
  );
}
