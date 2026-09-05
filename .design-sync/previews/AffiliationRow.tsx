import { AffiliationRow, Avatar, Panel, PanelBody, PanelHeader } from "pkic-org-events-backend";

/** On a person's record: the organizations they have represented. */
export function OrganizationsOfAPerson() {
  return (
    <div class="pk">
      <Panel>
        <PanelHeader title="Organizations" />
        <PanelBody>
          <AffiliationRow
            media={<Avatar name="Digitorus" size="lg" />}
            title="Digitorus"
            href="#digitorus"
            marker="Primary contact"
            terms={["Solution architect", "since Jun 2024", "paul.vanbrouwershaven@digitorus.com"]}
          >
            Leads the trust services practice: signature validation services, eIDAS conformance, and the
            long-term preservation stack Digitorus ships to European registries.
          </AffiliationRow>
          <AffiliationRow
            past
            media={<Avatar name="Entrust" size="lg" />}
            title="Entrust"
            href="#entrust"
            terms={["Principal architect", "2016 – 2024"]}
          >
            Represented Entrust in the CA/Browser Forum and the consortium&rsquo;s early post-quantum work.
          </AffiliationRow>
        </PanelBody>
      </Panel>
    </div>
  );
}

/** The same component from the other side: an organization's delegates. */
export function PeopleOfAnOrganization() {
  return (
    <div class="pk">
      <Panel>
        <PanelHeader title="Delegates" />
        <PanelBody>
          <AffiliationRow
            media={<Avatar name="Amara Osei" size="lg" />}
            title="Amara Osei"
            href="#amara"
            marker="Voting delegate"
            terms={["Vice chair, PQC WG", "since Sep 2022"]}
          />
          <AffiliationRow
            past
            media={<Avatar name="Kenji Watanabe" size="lg" />}
            title="Kenji Watanabe"
            href="#kenji"
            terms={["Delegate", "2021 – 2024"]}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}
