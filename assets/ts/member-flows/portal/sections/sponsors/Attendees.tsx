/** Sponsor-capability view of consenting attendees in the unified portal. */
import { useCallback, useEffect, useState } from "preact/hooks";
import { ApiClientError, getJson } from "../../../../shared/api-client";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import type { CollectionLoader } from "../../../../hooks/useServerCollection";
import { Alert } from "../../../../ui/Alert";
import { IconDownload } from "../../../../components/icons";
import { ButtonLink } from "../../../../ui/Button";
import type { Column } from "../../../../components/Table";
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
const ATTENDEE_COLUMNS: Column<SponsorAttendee>[] = [
  // The design system's table gives slack to no column on its own; the
  // person is the row's subject, so a wide screen's slack lands there.
  { header: "Name", width: "primary", cell: (a) => fmtName(a) },
  // A bounded value: `fit` keeps the address on one line instead of letting
  // the primary column squeeze it into a one-character-per-line tower.
  { header: "Email", cell: (a) => a.email ?? "—" },
  { header: "Organization", cell: (a) => a.organizationName ?? "—" },
  { header: "Job title", cell: (a) => a.jobTitle ?? "—" },
  // A bounded vocabulary hugs its content instead of claiming slack.
  { header: "Attendance", width: "fit", cell: (a) => fmtAttendanceType(a.attendanceType) },
];

export function SponsorAttendees({
  capacity,
  onUnauthorized,
}: {
  capacity: SponsorCapacity;
  onUnauthorized: () => void;
}) {
  const [sessionExpired, setSessionExpired] = useState(false);
  const [ineligible, setIneligible] = useState(false);
  useEffect(() => setIneligible(false), [capacity.sponsorId, capacity.eventSlug]);
  const load = useCallback<CollectionLoader>(
    async (url, signal, schema) => {
      try {
        return await getJson(url, schema, { signal });
      } catch (error) {
        if (!signal.aborted && error instanceof ApiClientError) {
          if (error.status === 401) {
            setSessionExpired(true);
            onUnauthorized();
          }
          if (error.status === 403) setIneligible(true);
        }
        throw error;
      }
    },
    [onUnauthorized],
  );
  const endpoint = `/api/v1/sponsors/${encodeURIComponent(capacity.sponsorId)}/events/${encodeURIComponent(capacity.eventSlug)}/attendees`;
  const eventLabel = capacity.eventName ?? "your event";

  if (sessionExpired) return null;
  if (ineligible) {
    return (
      <div class="pk pk-stack content-width-md">
        <Alert tone="warn" title="This sponsorship no longer has attendee data access">
          Either your tier isn't configured for it, or the sponsorship is no longer active. Contact the PKI Consortium
          if you believe this is a mistake.
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
      </div>

      <p class="pk-small">
        Only attendees who consented to sharing their profile with event sponsors are listed below.
      </p>

      <ApiDataTable
        caption={`Consenting attendees for ${eventLabel}`}
        columns={ATTENDEE_COLUMNS}
        endpoint={endpoint}
        responseSchema={sponsorAttendeesListResponseSchema}
        resolve={(data) => data.attendees}
        resolvePage={(data) => data.page}
        initialSort="name"
        paginate
        load={load}
        rowKey={(attendee) => attendee.registrationId}
        toolbar={() => (
          <>
            {" "}
            {/* A download is a navigation to a representation of this list, so it
            is an anchor wearing the button's clothes rather than a button that
            fakes one. */}
            <ButtonLink
              icon
              aria-label="Download CSV"
              title="Download CSV"
              href={`/api/v1/sponsors/${encodeURIComponent(capacity.sponsorId)}/events/${encodeURIComponent(capacity.eventSlug)}/attendees?format=csv`}
              download={`attendees-${capacity.eventSlug}.csv`}
            >
              <IconDownload />
            </ButtonLink>
          </>
        )}
        empty={
          <EmptyState
            title="No consenting attendees found"
            body="Only registered attendees who agreed to share their profile are listed."
          />
        }
      />
    </div>
  );
}
