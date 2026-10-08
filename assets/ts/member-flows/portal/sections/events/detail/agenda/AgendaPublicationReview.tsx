import { agendaHistoricalPublicationReview } from "../../../../../../../shared/agenda-historical-publication-review";
import { Field } from "../../../../../../ui/Field";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { Checkbox } from "../../../../../../ui/Checkbox";
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
  acknowledgeArchiveRepresentation,
  onArchiveAcknowledgment,
  acknowledgmentField,
  onClose,
  onPreview,
}: {
  snapshot: AgendaSnapshot;
  canEdit: boolean;
  busy: boolean;
  acknowledgeArchiveRepresentation: boolean;
  onArchiveAcknowledgment: (value: boolean) => void;
  acknowledgmentField: FieldPresentation;
  onClose: () => void;
  onPreview: () => void;
}) {
  const { occurrenceIds, sourceOnlyCredits, titlesNotRecorded, creditsNotRecorded, endsNotRecorded } =
    agendaHistoricalPublicationReview(snapshot);
  const requiresArchiveReview = occurrenceIds.length > 0;
  return (
    <Panel>
      <PanelHeader title="Review for publication">
        <Button onClick={onClose}>Back to agenda</Button>
      </PanelHeader>
      <PanelBody>
        <div class="pk-stack">
          <DescriptionList
            items={[
              {
                term: "Draft revision",
                value: formatNumber(snapshot.revision),
              },
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
          {requiresArchiveReview && (
            <div class="pk-stack">
              <p>
                {formatNumber(sourceOnlyCredits)} speaker credits from the original agenda,{" "}
                {formatNumber(titlesNotRecorded)} titles not recorded, {formatNumber(creditsNotRecorded)} speaker names
                not recorded and {formatNumber(endsNotRecorded)} session end times not recorded. Publish these
                historical details as recorded. Slides and recordings need separate approval.
              </p>
              {canEdit && (
                <Field label="Historical speaker and timing review" {...acknowledgmentField}>
                  {(control) => (
                    <Checkbox
                      {...control}
                      name="acknowledgeArchiveRepresentation"
                      label="I reviewed the historical speaker and timing details, including missing information."
                      checked={acknowledgeArchiveRepresentation}
                      disabled={busy}
                      onChange={(event) => onArchiveAcknowledgment(event.currentTarget.checked)}
                    >
                      I reviewed the historical speaker and timing details, including missing information.
                    </Checkbox>
                  )}
                </Field>
              )}
            </div>
          )}
          {canEdit && (
            <div class="pk-cluster">
              <Button
                variant="primary"
                disabled={
                  busy ||
                  snapshot.revision === snapshot.publishedRevision ||
                  (requiresArchiveReview && !acknowledgeArchiveRepresentation)
                }
                type="submit"
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
