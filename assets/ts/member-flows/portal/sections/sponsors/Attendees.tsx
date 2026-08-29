/** Sponsor-capability view of consenting attendees in the unified portal. */
import { useEffect } from "preact/hooks";
import { ApiClientError } from "../../../../shared/api-client";
import { Pager } from "../../../../components/Pager";
import { useApiPage } from "../../../../hooks/useApiPage";
import type { SponsorAttendee, SponsorCapacity } from "../../../../../shared/schemas/sponsor-access";
import { sponsorAttendeesListResponseSchema } from "../../../../../shared/schemas/sponsor-access";

function fmtName(a: SponsorAttendee): string {
  return [a.firstName, a.lastName].filter(Boolean).join(" ").trim() || "—";
}

function fmtAttendanceType(value: string | null): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

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

  useEffect(() => {
    if (listing.error instanceof ApiClientError && listing.error.status === 401) onUnauthorized();
  }, [listing.error, onUnauthorized]);

  const eventLabel = capacity.eventName ?? "your event";

  if (ineligible) {
    return (
      <div class="container py-4 content-width-md">
        <div class="alert alert-warning">
          This sponsorship no longer has attendee data access — either your tier isn't configured for it, or the
          sponsorship is no longer active. Contact your PKIC representative if you believe this is a mistake.
        </div>
      </div>
    );
  }

  return (
    <div class="container py-4 content-width-xl">
      <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
        <div>
          <h1 class="h4 mb-1">Attendees — {eventLabel}</h1>
          <p class="text-muted small mb-0">
            {capacity.tier} sponsor · {capacity.contactEmail}
          </p>
        </div>
        <div class="d-flex gap-2">
          <a
            class="btn btn-outline-success"
            href={`/api/v1/sponsors/${encodeURIComponent(capacity.sponsorId)}/events/${encodeURIComponent(capacity.eventSlug)}/attendees?format=csv`}
            download={`attendees-${capacity.eventSlug}.csv`}
          >
            Download CSV
          </a>
        </div>
      </div>

      <p class="text-muted small">
        Only attendees who consented to sharing their profile with event sponsors are listed below.
      </p>

      {listing.loading && (
        <div class="d-flex align-items-center gap-2 text-muted py-4">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          Loading attendees…
        </div>
      )}

      {listing.error && !ineligible && !(listing.error instanceof ApiClientError && listing.error.status === 401) && (
        <div class="alert alert-danger">✕ {listing.error.message}</div>
      )}

      {!listing.loading && !listing.error && attendees && (
        <div class="table-responsive">
          <table class="table table-sm table-hover align-middle">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Organization</th>
                <th>Job title</th>
                <th>Attendance</th>
              </tr>
            </thead>
            <tbody>
              {attendees.length === 0 ? (
                <tr>
                  <td colSpan={5} class="text-muted text-center py-4">
                    No consenting attendees yet.
                  </td>
                </tr>
              ) : (
                attendees.map((a) => (
                  <tr key={a.registrationId}>
                    <td>{fmtName(a)}</td>
                    <td>{a.email ?? "—"}</td>
                    <td>{a.organizationName ?? "—"}</td>
                    <td>{a.jobTitle ?? "—"}</td>
                    <td>{fmtAttendanceType(a.attendanceType)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {listing.pagerProps && <Pager {...listing.pagerProps} />}
    </div>
  );
}
