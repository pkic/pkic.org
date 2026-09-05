import { useState } from "react";

import { AffiliationRow, Avatar, ExpandFooter, Panel, PanelBody, PanelHeader } from "pkic-org-events-backend";

const OLDER = [
  { name: "GlobalSign", terms: ["Senior architect", "2011 – 2016"] },
  { name: "Logius", terms: ["PKI consultant", "2009 – 2011"] },
  { name: "Keyplan", terms: ["Systems engineer", "2006 – 2009"] },
];

/** Collapsed: the history is there, but it is not pushing the page down. */
export function ClosingAPanel() {
  const [expanded, setExpanded] = useState(false);
  return (
    <div class="pk">
      <Panel>
        <PanelHeader title="Organizations" />
        <PanelBody>
          <AffiliationRow
            media={<Avatar name="Digitorus" size="lg" />}
            title="Digitorus"
            terms={["Solution architect", "since Jun 2024"]}
          />
          {expanded &&
            OLDER.map((org) => (
              <AffiliationRow key={org.name} past media={<Avatar name={org.name} size="lg" />} title={org.name} terms={org.terms} />
            ))}
        </PanelBody>
        <ExpandFooter
          expanded={expanded}
          onToggle={() => {
            setExpanded(!expanded);
          }}
          hiddenCount={OLDER.length}
          noun="organizations"
        />
      </Panel>
    </div>
  );
}

/** Expanded, so the control reads "Show fewer". */
export function Opened() {
  return (
    <div class="pk">
      <Panel>
        <PanelHeader title="Organizations" />
        <PanelBody>
          {OLDER.map((org) => (
            <AffiliationRow key={org.name} past media={<Avatar name={org.name} size="lg" />} title={org.name} terms={org.terms} />
          ))}
        </PanelBody>
        <ExpandFooter expanded onToggle={() => undefined} hiddenCount={OLDER.length} noun="organizations" />
      </Panel>
    </div>
  );
}
