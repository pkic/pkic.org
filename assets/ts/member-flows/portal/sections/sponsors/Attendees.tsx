/** Sponsor-capability view of consenting attendees in the unified portal. */
import { useEffect } from "preact/hooks";
import { ApiClientError } from "../../../../shared/api-client";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Pager } from "../../../../components/Pager";
import { useApiPage } from "../../../../hooks/useApiPage";
import { Alert } from "../../../../ui/Alert";
import { DataTable, type DataTableColumn } from "../../../../ui/DataTable";
import { EmptyState } from "../../../../ui/EmptyState";
import type { SponsorAttendee, SponsorCapacity } from "../../../../../shared/schemas/sponsor-access";
import { sponsorAttendeesListResponseSchema } from "../../../../../shared/schemas/sponsor-access";

function fmtName(a: SponsorAttendee): string {
  return [a.firstName, a.lastName].filter(Boolean).join(" ").trim() || "—";
}

function fmtAttendanceType(value: string | null): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Declared once outside the component: the columns depend on nothing the
 * render decides, so rebuilding them on every listing update only makes the
 * table re-derive an identical shape.
 */
const ATTENDEE_COLUMNS: ReadonlyArray<DataTableColumn<SponsorAttendee>> = [
  // The design system's table gives slack to no column on its own; the
  // person is the row's subject, so a wide screen's slack lands there.
  { id: "name", header: "Name", width: "primary", cell: (a) => fmtName(a) },
  { id: "email", header: "Email", cell: (a) => a.email ?? "—", cellClass: "pk-break" },
  { id: "organizationName", header: "Organization", cell: (a) => a.organizationName ?? "—" },
  { id: "jobTitle", header: "Job title", cell: (a) => a.jobTitle ?? "—" },
  // A bounded vocabulary hugs its content instead of claiming slack.
  { id: "attendanceType", header: "Attendance", width: "fit", cell: (a) => fmtAttendanceType(a.attendanceType) },
];

export function SponsorAttendees({
  capacity,
  onUnauthorized,
}: {
  capacity: SponsorCapacity;
  onUnauthorized: () => void;
}) {
  const listing = useApiPage(
    `/api/v1/sponsors/${encodeURIComponent(capacity.sponsorId)}/events/${encodeURIComponent(capacity.eventSlug)}/attendees`,
    { sort: "name" },
    sponsorAttendeesListResponseSchema,
    (data) => data.attendees,
  );
  const attendees = listing.data?.attendees ?? null;
  const ineligible = listing.error instanceof ApiClientError && listing.error.status === 403;
  const sessionExpired = listing.error instanceof ApiClientError && listing.error.status === 401;

  useEffect(() => {
    if (listing.error instanceof ApiClientError && listing.error.status === 401) onUnauthorized();
  }, [listing.error, onUnauthorized]);

  const eventLabel = capacity.eventName ?? "your event";

  if (ineligible) {
    return (
      <div class="pk pk-stack content-width-md">
        <Alert tone="warn" title="This sponsorship no longer has attendee data access">
          Either your tier isn't configured for it, or the sponsorship is no longer active. Contact your PKIC
          representative if you believe this is a mistake.
        </Alert>
      </div>
    );
  }

  return (
    // Full width: a list fills the measure it is given, and the shell owns
    // the page's <h1> — the tab strip already names this view, so the strip
    // below it carries the context line and the list's own actions.
    <div class="pk pk-stack">
      <div class="pk-cluster pk-cluster--between pk-cluster--start">
        <p class="pk-small">
          {eventLabel} · {capacity.tier} sponsor · {capacity.contactEmail}
        </p>
        {/* A download is a navigation to a representation of this list, so it
            is an anchor wearing the button's clothes rather than a button that
            fakes one. */}
        <a
          class="pk-btn pk-btn--secondary"
          href={`/api/v1/sponsors/${encodeURIComponent(capacity.sponsorId)}/events/${encodeURIComponent(capacity.eventSlug)}/attendees?format=csv`}
          download={`attendees-${capacity.eventSlug}.csv`}
        >
          Download CSV
        </a>
      </div>

      <p class="pk-small">
        Only attendees who consented to sharing their profile with event sponsors are listed below.
      </p>

      {listing.error && !sessionExpired ? (
        <ErrorAlert error={listing.error} />
      ) : (
        <DataTable
          caption={`Consenting attendees for ${eventLabel}`}
          columns={ATTENDEE_COLUMNS}
          rows={attendees ?? []}
          rowKey={(a) => a.registrationId}
          loading={listing.loading}
          empty={
            <EmptyState
              title="No consenting attendees yet"
              body="Registered attendees appear here once they agree to share their profile with event sponsors."
            />
          }
        />
      )}
      {listing.pagerProps && <Pager {...listing.pagerProps} />}
    </div>
  );
}
