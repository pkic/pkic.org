import { Badge, DescriptionList, Panel, PanelBody, PanelHeader } from "pkic-org-events-backend";

/**
 * DescriptionList is the record block: term and value pairs on a real `<dl>`.
 * It always sits inside the panel of the record it describes, so each cell
 * shows it there rather than floating on the canvas.
 */

/** Default density — the organization record as the directory shows it. */
export function OrganizationRecord() {
  return (
    <div class="pk">
      <Panel>
        <PanelHeader title="SecureTrust Authority" />
        <PanelBody>
          <DescriptionList
            items={[
              { term: "Legal name", value: "SecureTrust Authority AS" },
              { term: "Membership", value: "Full member since 2021" },
              { term: "Headquarters", value: "Trondheim, Norway" },
              {
                term: "Certification practice statement",
                value: <a href="#cps">https://repository.securetrust.example/cps/current</a>,
              },
              { term: "Working groups", value: "Post-Quantum Cryptography, Certificate Lifecycle Automation" },
              { term: "Primary contact", value: "Tomas Riedel" },
            ]}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}

/**
 * `compact` is the same list at the smaller type a sidebar or card wants —
 * here the review record beside a membership application.
 */
export function CompactSubmissionRecord() {
  return (
    <div class="pk">
      <Panel>
        <PanelHeader title="Membership application" />
        <PanelBody>
          <DescriptionList
            density="compact"
            items={[
              { term: "Applicant", value: "Ibérica Trust Services" },
              { term: "Submitted", value: "2026-08-14" },
              { term: "Reviewer", value: "Amara Osei" },
              { term: "Membership class", value: "Associate" },
              { term: "Signed agreement", value: "Consortium Membership Agreement v4" },
              { term: "Decision due", value: "2026-09-11" },
            ]}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}

/**
 * What a value can be, and what an absent one looks like: a badge, a link,
 * a paragraph that wraps, and an em dash where the record holds nothing.
 * A blank `<dd>` reads as a rendering fault; the dash reads as an absence.
 */
export function ValuesAndAbsences() {
  return (
    <div class="pk">
      <Panel>
        <PanelHeader title="Charter: Quantum-Safe Cryptography" />
        <PanelBody>
          <DescriptionList
            items={[
              { term: "Status", value: <Badge tone="ok">Ratified</Badge> },
              { term: "Ratified", value: "2026-03-02" },
              {
                term: "Scope",
                value:
                  "Coordinates the consortium's migration to quantum-safe certificates, including hybrid signature profiles, root program timelines, and guidance for relying parties.",
              },
              { term: "Charter document", value: <a href="#charter">quantum-safe-cryptography-charter-v2.pdf</a> },
              { term: "Superseded charter" },
              { term: "Next review" },
            ]}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}
