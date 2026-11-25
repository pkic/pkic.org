/**
 * One ticket as organizers read it: what registrants see, who gets it, how
 * many registered with it, and the organizations decided for it. Editing is
 * its own page, opened from here.
 */
import type { EventTicketsConfiguration } from "../../../../../../../../shared/schemas/event-tickets";
import { formatNumber } from "../../../../../../../../shared/format-number";
import { ButtonLink } from "../../../../../../../ui/Button";
import { DescriptionList } from "../../../../../../../ui/DescriptionList";
import { Markdown } from "../../../../../../../ui/Markdown";
import { Panel, PanelBody, PanelHeader } from "../../../../../../../ui/Panel";
import { TicketOrganizationsPanel } from "./TicketOrganizationsPanel";

type TicketType = EventTicketsConfiguration["types"][number];

export function TicketTypeView({
  slug,
  configuration,
  type,
  editHref,
  onChanged,
}: {
  slug: string;
  configuration: EventTicketsConfiguration;
  type: TicketType;
  /** Left out for someone who cannot change tickets. */
  editHref?: string;
  onChanged: () => Promise<void>;
}) {
  // A decision chooses between tickets, so it needs two on offer; only those who can change tickets steer them.
  const decisions =
    editHref !== undefined && type.active && configuration.types.filter((ticket) => ticket.active).length >= 2;
  return (
    <div class="pk-stack">
      <Panel aria-label={`${type.name} ticket`}>
        <PanelHeader title={`${type.name} ticket`} breadcrumb>
          {editHref && (
            <ButtonLink variant="primary" href={editHref}>
              Edit ticket
            </ButtonLink>
          )}
        </PanelHeader>
        <PanelBody class="pk-stack">
          <DescriptionList
            items={[
              {
                term: "Description",
                value: type.descriptionMarkdown.trim() && (
                  <Markdown markdown={type.descriptionMarkdown} profile="text" />
                ),
              },
              { term: "Offered", value: type.active ? "Yes" : "No. Tickets already issued stay valid." },
              {
                term: "Organizations that qualify",
                value: type.classifierDescription || "Only given with a code or by an organizer.",
              },
              {
                term: "Certainty needed",
                value: type.classifierDescription && `${String(type.classifierThresholdPercent)}%`,
              },
              { term: "When nothing else decides", value: type.isDefault ? "This ticket is given" : "Another ticket" },
              {
                term: "Free ticket",
                value: type.freeRequiresWorkEmail ? "Needs a work email address" : "Any email address",
              },
              { term: "Key", value: type.key },
              {
                term: "Registrations",
                value: `${formatNumber(type.registered)} registered, ${formatNumber(type.paid)} paid, ${formatNumber(type.awaitingPayment)} awaiting payment, ${formatNumber(type.underReview)} under review`,
              },
            ]}
          />
        </PanelBody>
      </Panel>
      {decisions && (
        <TicketOrganizationsPanel
          slug={slug}
          configuration={configuration}
          ticketKey={type.key}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}
