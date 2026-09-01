import { statusLabel } from "../../../../components/Badge";
import { fmt } from "../../ui";
import type { MembershipApplicationDetail } from "../../../../../shared/schemas/membership-application-management";
import { EmptyState } from "../../../../ui/EmptyState";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
// `pk-mono` is defined in Content.css, which ships in a lazy chunk, so the
// module that writes the class name has to import the stylesheet itself.
import "../../../../ui/Content.css";

export function ApplicationTimelineCard({ detail }: { detail: MembershipApplicationDetail }) {
  return (
    <div class="pk">
      <Panel aria-label="Timeline">
        <PanelHeader title="Timeline" />
        <PanelBody>
          {detail.events.length === 0 ? (
            <EmptyState title="No stage changes yet." />
          ) : (
            <ul class="pk-stack pk-stack--tight pk-small">
              {detail.events.map((ev, i) => (
                <li key={i}>
                  <span class="pk-mono pk-muted pk-nowrap">{fmt(ev.createdAt)}</span>{" "}
                  {/* The stored vocabulary is turned into the product's own
                      words here, so "ec_review" is not what a reader is asked
                      to decode. The arrow is decorative; the two stage names
                      either side are what carries the change. */}
                  {ev.fromStage ? statusLabel(ev.fromStage) : "Not yet in a stage"}
                  <span aria-hidden="true"> → </span>
                  <span class="pk-sr-only">to</span> {statusLabel(ev.toStage)}
                  {ev.note && <span class="pk-muted"> ({ev.note})</span>}
                </li>
              ))}
            </ul>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
