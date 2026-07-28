/**
 * Sponsor portal attendee list + CSV export (PRD §4.13 "Sponsor Portal —
 * Attendee Data Access", §11 UI-7). Talks to
 * GET /api/v1/sponsor-portal/events/:eventId/attendees (JSON list) and
 * links directly to .../attendees/export (CSV) — the export link is a
 * plain <a>, not a fetch+blob dance, since the session is an HttpOnly
 * cookie scoped to `/api/v1/sponsor-portal` that a normal browser
 * navigation already sends; the server's `Content-Disposition: attachment`
 * header does the rest.
 */
import { useEffect, useState } from "preact/hooks";
import { getJson, ApiClientError } from "../../shared/api-client";
import type { SponsorPortalAttendee, SponsorPortalSession } from "./types";

function fmtName(a: SponsorPortalAttendee): string {
  return [a.firstName, a.lastName].filter(Boolean).join(" ").trim() || "—";
}

function fmtAttendanceType(value: string | null): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function Attendees({ session, onUnauthorized }: { session: SponsorPortalSession; onUnauthorized: () => void }) {
  const [attendees, setAttendees] = useState<SponsorPortalAttendee[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ineligible, setIneligible] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      setIneligible(false);
      try {
        const data = await getJson<{ attendees: SponsorPortalAttendee[] }>(
          `/api/v1/sponsor-portal/events/${session.eventId}/attendees`,
        );
        if (!cancelled) setAttendees(data.attendees);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 401) {
          onUnauthorized();
          return;
        }
        if (err instanceof ApiClientError && err.status === 403) {
          setIneligible(true);
          return;
        }
        setError(err instanceof ApiClientError ? err.message : "Could not load attendees. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [session.eventId]);

  const eventLabel = session.eventName ?? "your event";

  if (ineligible) {
    return (
      <div class="container py-4" style="max-width: 720px;">
        <div class="alert alert-warning">
          This sponsorship no longer has attendee data access — either your tier isn't configured for it, or the
          sponsorship is no longer active. Contact your PKIC representative if you believe this is a mistake.
        </div>
      </div>
    );
  }

  return (
    <div class="container py-4" style="max-width: 960px;">
      <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
        <div>
          <h1 class="h4 mb-1">Attendees — {eventLabel}</h1>
          <p class="text-muted small mb-0">
            {session.tier} sponsor · {session.contactEmail}
          </p>
        </div>
        <div class="d-flex gap-2">
          <a
            class="btn btn-outline-success"
            href={`/api/v1/sponsor-portal/events/${session.eventId}/attendees/export`}
            download={`attendees-${session.eventId}.csv`}
          >
            Download CSV
          </a>
        </div>
      </div>

      <p class="text-muted small">
        Only attendees who consented to sharing their profile with event sponsors are listed below.
      </p>

      {loading && (
        <div class="d-flex align-items-center gap-2 text-muted py-4">
          <div class="spinner-border spinner-border-sm" role="status"></div>
          Loading attendees…
        </div>
      )}

      {error && <div class="alert alert-danger">✕ {error}</div>}

      {!loading && !error && attendees && (
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
    </div>
  );
}
