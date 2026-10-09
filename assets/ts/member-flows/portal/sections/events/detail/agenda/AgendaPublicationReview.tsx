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
import { Badge } from "../../../../../../ui/Badge";
import { FormSection } from "../../../../../../ui/FormSection";

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
  const upToDate = snapshot.revision === snapshot.publishedRevision;
  const status =
    snapshot.publishedRevision === null
      ? {
          tone: "info" as const,
          label: "Not yet approved",
          detail: "Approve this draft to publish the agenda on the event website.",
        }
      : upToDate
        ? {
            tone: "ok" as const,
            label: "Approved",
            detail: "The approved revision matches the current draft. There is nothing new to approve.",
          }
        : {
            tone: "warn" as const,
            label: "Changes awaiting approval",
            detail: "The draft has changed since the approved revision. Approve it to update the website.",
          };
  return (
    <Panel>
      <PanelHeader title="Review for publication">
        <Button onClick={onClose}>Back to agenda</Button>
      </PanelHeader>
      <PanelBody>
        <div class="pk-stack">
          <p class="pk-cluster" role="status">
            <Badge tone={status.tone}>{status.label}</Badge>
            <span>{status.detail}</span>
          </p>
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
              ...(snapshot.publishedRevision !== null
                ? [
                    {
                      term: "Website",
                      value: <AgendaDeliveryStatus slug={snapshot.eventSlug} revision={snapshot.publishedRevision} />,
                    },
                  ]
                : []),
            ]}
          />
          <p class="pk-muted">
            Check the public preview first. Approval freezes this revision for a site build; the public website updates
            when publication is activated.
          </p>
          {requiresArchiveReview && (
            <FormSection
              title="Historical details"
              layout="stack"
              description={
                <>
                  {formatNumber(sourceOnlyCredits)} speaker credits from the original agenda,{" "}
                  {formatNumber(titlesNotRecorded)} titles not recorded, {formatNumber(creditsNotRecorded)} speaker
                  names not recorded and {formatNumber(endsNotRecorded)} session end times not recorded. Publish these
                  historical details as recorded. Slides and recordings need separate approval.
                </>
              }
            >
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
            </FormSection>
          )}
          <div class="pk-cluster">
            {canEdit && (
              <Button
                variant="primary"
                disabled={busy || upToDate || (requiresArchiveReview && !acknowledgeArchiveRepresentation)}
                loading={busy}
                type="submit"
              >
                Approve for publication
              </Button>
            )}
            <Button type="button" onClick={onPreview}>
              Public preview
            </Button>
          </div>
        </div>
      </PanelBody>
    </Panel>
  );
}
