import { useState } from "react";

import { Badge, TabList } from "pkic-org-events-backend";

/**
 * TabList swaps panels that are already on the page, so it is only truthful
 * with its panels: each cell renders the tab set together with the panel the
 * selected tab controls, wired through `panelId` / `idPrefix`.
 */

const sections = [
  { id: "scope", label: "Scope", panelId: "charter-scope" },
  { id: "deliverables", label: "Deliverables", panelId: "charter-deliverables" },
  { id: "participation", label: "Participation", panelId: "charter-participation" },
];

const panels: Record<string, { heading: string; body: string }> = {
  scope: {
    heading: "Scope",
    body: "Migration guidance for certificate authorities adopting ML-DSA and ML-KEM, including hybrid certificate profiles and the interoperability tests that qualify an implementation.",
  },
  deliverables: {
    heading: "Deliverables",
    body: "A migration playbook for relying parties, a test corpus of hybrid certificates, and two interoperability reports per year.",
  },
  participation: {
    heading: "Participation",
    body: "Open to any member organization. Each participating organization names one voting representative; alternates attend without a vote.",
  },
};

function CharterSections({ initial }: { initial: string }) {
  const [active, setActive] = useState(initial);
  const panel = panels[active];

  return (
    <div class="pk pk-stack pk-stack--tight">
      <TabList
        items={sections}
        activeId={active}
        onSelect={setActive}
        label="Charter sections"
        idPrefix="charter-tab"
      />
      <div
        id={sections.find((section) => section.id === active)?.panelId}
        role="tabpanel"
        aria-labelledby={`charter-tab-${active}`}
        tabIndex={0}
        class="pk-stack pk-stack--tight"
      >
        <span class="pk-strong">{panel.heading}</span>
        <p class="pk-small pk-muted">{panel.body}</p>
      </div>
    </div>
  );
}

export function CharterSectionsFirstSelected() {
  return <CharterSections initial="scope" />;
}

export function CharterSectionsLaterPanel() {
  return <CharterSections initial="participation" />;
}

export function InsideARecordPanel() {
  const [active, setActive] = useState("attending");
  const rosters: Record<string, readonly string[]> = {
    attending: ["Tomas Riedel — Entrust", "Amara Osei — DigiCert", "Lena Vogt — SwissSign"],
    apologies: ["Marco Ferri — Actalis"],
    unanswered: ["Priya Raman — eMudhra", "Jonas Nyberg — Telia"],
  };

  return (
    <div class="pk pk-stack pk-stack--tight">
      <div class="pk-cluster pk-cluster--between">
        <span class="pk-strong">Plenary, 18 June 2026</span>
        <Badge tone="info">Quorum met</Badge>
      </div>
      <TabList
        items={[
          { id: "attending", label: "Attending", panelId: "roster-attending" },
          { id: "apologies", label: "Apologies", panelId: "roster-apologies" },
          { id: "unanswered", label: "No response", panelId: "roster-unanswered" },
        ]}
        activeId={active}
        onSelect={setActive}
        label="Meeting roster"
        idPrefix="roster-tab"
      />
      <ul id={`roster-${active}`} role="tabpanel" aria-labelledby={`roster-tab-${active}`} tabIndex={0}>
        {rosters[active].map((person) => (
          <li key={person} class="pk-small">
            {person}
          </li>
        ))}
      </ul>
    </div>
  );
}
