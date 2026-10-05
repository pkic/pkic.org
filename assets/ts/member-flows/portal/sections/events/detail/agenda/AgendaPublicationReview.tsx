import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { formatNumber } from "../../../../../../../shared/format-number";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { Button } from "../../../../../../ui/Button";
import { AgendaDeliveryStatus } from "./AgendaDeliveryStatus";

/** Approval is a dedicated record review, never a panel above the sessions list. */
export function AgendaPublicationReview({
  snapshot,
  canEdit,
  busy,
  onClose,
  onPreview,
  onApprove,
}: {
  snapshot: AgendaSnapshot;
  canEdit: boolean;
  busy: boolean;
  onClose: () => void;
  onPreview: () => void;
  onApprove: () => void;
}) {
  return (
    <Panel>
      <PanelHeader title="Review for publication">
        <Button onClick={onClose}>Back to agenda</Button>
      </PanelHeader>
      <PanelBody>
        <div class="pk-stack">
          <DescriptionList
            items={[
              { term: "Draft revision", value: formatNumber(snapshot.revision) },
              {
                term: "Approved revision",
                value: snapshot.publishedRevision === null ? "None" : formatNumber(snapshot.publishedRevision),
              },
              { term: "Time zone", value: snapshot.timeZone },
            ]}
          />
          <p>
            Review the public agenda before approval. Approval freezes this revision for a site build; the public
            website updates when publication is activated.
          </p>
          {snapshot.publishedRevision !== null && (
            <AgendaDeliveryStatus slug={snapshot.eventSlug} revision={snapshot.publishedRevision} />
          )}
          <div class="pk-cluster">
            <Button onClick={onPreview}>Public preview</Button>
          </div>
          {canEdit && (
            <div class="pk-cluster">
              <Button
                variant="primary"
                disabled={busy || snapshot.revision === snapshot.publishedRevision}
                onClick={onApprove}
              >
                Approve for publication
              </Button>
            </div>
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}
