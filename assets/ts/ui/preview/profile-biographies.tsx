/** General and organization biography fields rendered with synthetic gallery data. */
import { useState } from "preact/hooks";
import { IdentityProfileFields, type IdentityProfileDraft } from "../../components/identities/IdentityProfileFields";
import { Panel, PanelBody, PanelHeader } from "../Panel";

export function ProfileBiographiesExample() {
  return (
    <div class="pk-preview__shelf pk-preview__shelf--stack">
      <BiographyFieldsExample organization={false} />
      <BiographyFieldsExample organization />
    </div>
  );
}

function BiographyFieldsExample({ organization }: { organization: boolean }) {
  const [draft, setDraft] = useState<IdentityProfileDraft>({
    jobTitle: organization ? "Security researcher" : "",
    biography: "",
    links: [],
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
