import { formatNumber } from "../../../../../shared/format-number";
import type { Representation } from "../../../../../shared/schemas/representation";
import { Spinner } from "../../../../components/Spinner";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { StatCard } from "../../../../ui/StatCard";

/** The complete population, explicitly independent of the adjacent table's filters. */
export function RepresentationSummary({
  representation,
  description,
}: {
  representation: Representation | null;
  description: string;
}) {
  return (
    <Panel aria-label="Representation">
      <PanelHeader title="Representation" />
      <PanelBody class="pk-stack pk-stack--snug">
        <p class="pk-small pk-muted">{description}</p>
        {representation ? (
          <div class="pk-stat-row">
            <StatCard
              role="group"
              aria-label="People"
              label="People"
              value={formatNumber(representation.people.count)}
              density="compact"
            />
            <StatCard
              role="group"
              aria-label="Organizations"
              label="Organizations"
              value={formatNumber(representation.organizations.count)}
              density="compact"
            />
          </div>
        ) : (
          <Spinner label="Loading representation…" />
        )}
      </PanelBody>
    </Panel>
  );
}
