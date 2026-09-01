import { fmt } from "../../ui";
import type { MembershipApplicationDetail } from "../../../../../shared/schemas/membership-application-management";
import { EmptyState } from "../../../../ui/EmptyState";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
// `pk-mono` is defined in Content.css, which ships in a lazy chunk, so the
// module that writes the class name has to import the stylesheet itself.
import "../../../../ui/Content.css";

export function ApplicationConcernsCard({ detail }: { detail: MembershipApplicationDetail }) {
  return (
    <div class="pk">
      <Panel aria-label="Consultation concerns">
        <PanelHeader title="Consultation concerns" />
        <PanelBody>
          {detail.concerns.length === 0 ? (
            // An empty list used to be a muted `<li>` reading "None submitted."
            // — a list item that is not an item. EmptyState says it in a
            // `role="status"` region instead, and the list disappears with it.
            <EmptyState title="No concerns submitted." />
          ) : (
            <ul class="pk-stack pk-stack--snug pk-small">
              {detail.concerns.map((concern) => (
                <li key={concern.id}>
                  {concern.concernText}
                  <div class="pk-mono pk-muted pk-small">{fmt(concern.createdAt)}</div>
                </li>
              ))}
            </ul>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
