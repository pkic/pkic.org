/**
 * The organizer's Organizations panel under event tickets: which ticket each
 * organization gets and who decided it, with sample decisions in place of the
 * server's. The names are examples.
 */
import type { EventTicketsConfiguration } from "../../../shared/schemas/event-tickets";
import type { EventTicketOrganization } from "../../../shared/schemas/event-ticket-organizations";
import { TicketOrganizationsPanel } from "../../member-flows/portal/sections/events/detail/settings/tickets/TicketOrganizationsPanel";

// The panel reads only the tickets from the configuration.
const CONFIGURATION = {
  types: [
    { id: "attendee", key: "attendee", name: "Attendee", active: true, isDefault: true, classifierDescription: "x" },
    { id: "vendor", key: "vendor", name: "Vendor", active: true, isDefault: false, classifierDescription: "x" },
  ],
} as unknown as EventTicketsConfiguration;

const UPDATED = "2026-11-20T09:30:00.000Z";
const ORGANIZATIONS: EventTicketOrganization[] = [
  {
    id: "b4f0c1de-0000-4000-8000-000000000001",
    organizationId: null,
    organizationName: "example bank",
    emailDomain: "examplebank.test",
    ticketKey: "attendee",
    decidedBy: "classifier",
    confidencePercent: 94,
    updatedAt: UPDATED,
  },
  {
    id: "b4f0c1de-0000-4000-8000-000000000002",
    organizationId: null,
    organizationName: "sample security",
    emailDomain: "samplesecurity.test",
    ticketKey: "vendor",
    decidedBy: "organizer",
    confidencePercent: null,
    updatedAt: UPDATED,
  },
  {
    id: "b4f0c1de-0000-4000-8000-000000000003",
    organizationId: null,
    organizationName: "placeholder university",
    emailDomain: "",
    ticketKey: "attendee",
    decidedBy: "classifier",
    confidencePercent: 88,
    updatedAt: UPDATED,
  },
];

export function TicketOrganizationsPreview() {
  return (
    <TicketOrganizationsPanel
      slug="example-event"
      configuration={CONFIGURATION}
      onChanged={async () => {}}
      loadOrganizations={async (_url, _signal, response) =>
        response.parse({
          organizations: ORGANIZATIONS,
          page: { limit: 25, offset: 0, total: ORGANIZATIONS.length, hasMore: false },
        })
      }
    />
  );
}
