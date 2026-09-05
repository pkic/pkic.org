import { Panel, PanelBody, PanelHeader, StatCard } from "pkic-org-events-backend";

/**
 * StatCard is one number with its name and, when there is one, the movement
 * behind it. They arrive as a row across the top of a dashboard, so each cell
 * shows a row rather than a lone card.
 */

/** The head of the consortium dashboard: four numbers, read left to right. */
export function ConsortiumOverview() {
  return (
    <div class="pk">
      <div class="pk-grid pk-grid--tight">
        <StatCard label="Member organizations" value="132" trend="up" note="7 joined this quarter" />
        <StatCard label="Active working groups" value="9" note="2 chartered in 2026" />
        <StatCard label="Signed agreements" value="1,284" trend="up" note="41 countersigned this month" />
        <StatCard label="Applications awaiting review" value="6" trend="down" note="3 fewer than last week" />
      </div>
    </div>
  );
}

/**
 * The trend axis. Direction is carried by colour and by a word, because the
 * colour alone is not readable to everyone.
 */
export function TrendDirections() {
  return (
    <div class="pk">
      <div class="pk-grid pk-grid--tight">
        <StatCard label="Meeting attendance" value="87%" trend="up" note="6 points this quarter" />
        <StatCard label="Certificates expiring in 30 days" value="24" trend="down" note="11 fewer than last month" />
        <StatCard label="Executive council seats" value="11" trend="flat" note="no change since March" />
        <StatCard label="Charters in draft" value="2" />
      </div>
    </div>
  );
}

/**
 * The summary band of a record, inside the panel it belongs to. Each card
 * carries `href`, which makes the whole card a way into the rows behind its
 * number while the link's accessible name stays the label alone — not the
 * label, the value and the note run together.
 */
export function LinkedToTheRowsBehind() {
  return (
    <div class="pk">
      <Panel>
        <PanelHeader title="Post-Quantum Cryptography" />
        <PanelBody>
          <div class="pk-stack pk-stack--snug">
            <p class="pk-small pk-muted">Each card opens the rows behind its number.</p>
            <div class="pk-grid pk-grid--tight">
              <StatCard label="Delegates" value="18" href="#roster" trend="up" note="4 joined this quarter" />
              <StatCard
                label="Member organizations represented"
                value="12"
                href="#organizations"
                note="of 132 consortium members"
              />
              <StatCard label="Meetings held in 2026" value="14" href="#meetings" trend="flat" note="fortnightly" />
              <StatCard label="Open charter actions" value="3" href="#actions" note="oldest raised 2026-06-02" />
            </div>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}

/**
 * The glance density, three across a sidebar panel: the figure leads and the
 * label sits under it, where the dashboard card does the opposite.
 */
export function AtAGlance() {
  return (
    <div class="pk">
      <Panel>
        <PanelHeader title="At a glance" />
        <PanelBody>
          <div class="pk-grid pk-grid--tight">
            <StatCard density="compact" label="groups" value="4" />
            <StatCard density="compact" label="events" value="12" />
            <StatCard density="compact" label="attendance" value="86%" />
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
