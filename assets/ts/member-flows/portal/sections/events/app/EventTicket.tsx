import { splitBadgePrintSvg } from "../../../../../../shared/badge-print-svg";
import { createPortal } from "preact/compat";
import { Dialog } from "../../../../../ui/Dialog";
import { useDialogQueryState } from "../../../../../hooks/useDialogQueryState";
/**
 * The attendee's ticket is their badge: the organizers' print renderer draws
 * the same front — template, sponsor artwork, role band, the QR code and the
 * readable code under it — at the printed badge's proportions.
 *
 * `PUT /api/v1/events/:slug/badges/current` returns the holder's own active
 * badge (issuing one for a confirmed registration that has none), so the code
 * on the phone is the code on the printed badge and the scanner admits both.
 */
import type { ComponentChildren } from "preact";
import { currentBadgeResponseSchema } from "../../../../../../shared/schemas/route-contracts-event-current-badge";
import { BadgeFace } from "../../../../../components/event-badges/BadgeFace";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../components/Spinner";
import { useData } from "../../../../../hooks/useData";
import { putJson } from "../../../../../shared/api-client";
import { EmptyState } from "../../../../../ui/EmptyState";
import { usePortalHashLocation } from "../../../hash-location";
import { eventRegistrationPath } from "../event-participant-paths";
import { EventCard } from "./EventCard";
import { eventRegistrationStanding, type ParticipantEventDetail } from "./event-app-model";
import { attendanceStanding, type AttendanceStanding } from "../../../../../shared/viewer-attendance";
import { formatDayList } from "../../../../../../shared/format-date";

export function EventTicket({ event }: { event: ParticipantEventDetail }) {
  // Only a registered reader reaches this page; the event home offers registration to everyone else.
  const standing = eventRegistrationStanding(event);
  if (!standing.registrationId)
    return <EmptyState title="You're registered" body="Your ticket appears here once it is ready." />;
  const details = <a href={usePortalHashLocation.hrefs(eventRegistrationPath(event.slug))}>Registration details</a>;
  if (standing.status !== "registered")
    return (
      <EventCard eyebrow="Registration" title="Confirm your email address">
        <p>Your badge and check-in code appear here once you do.</p>
        <div class="pk-cluster">{details}</div>
      </EventCard>
    );
  return <BadgeTicket event={event} details={details} />;
}

function BadgeTicket({ event, details }: { event: ParticipantEventDetail; details: ComponentChildren }) {
  const [enlarged, showCode, closeCode] = useDialogQueryState("ticket-code");
  const ticket = useData(async () => {
    const current = await putJson(
      `/api/v1/events/${encodeURIComponent(event.slug)}/badges/current`,
      {},
      currentBadgeResponseSchema,
    );
    // A label withheld by contact retention prints blank, as it does on paper.
    return { ...current, badge: { ...current.badge, displayName: current.badge.displayName ?? "" } };
  }, [event.slug]);
  const qr = ticket.data ? splitBadgePrintSvg(ticket.data.badge.svg) : null;
  const viewer = "viewer" in event ? event.viewer : null;
  const standing = viewer ? attendanceStanding(viewer) : UNDATED_SEAT;
  const use = <TicketUse standing={standing}>{details}</TicketUse>;
  // Without a seat the explanation leads, so the code is not read as admission.
  return (
    <div class="pk-stack">
      {!standing.holdsInPersonSeat && use}
      {ticket.loading ? (
        <Spinner label="Loading your badge…" />
      ) : ticket.data ? (
        <BadgeFace
          badge={ticket.data.badge}
          printing={ticket.data.printing}
          title={`Your badge for ${event.name}`}
          onQrClick={showCode}
        />
      ) : (
        <ErrorAlert error={ticket.error ?? "Your badge is unavailable."} />
      )}
      {standing.holdsInPersonSeat && use}
      {ticket.data &&
        createPortal(
          <Dialog
            open={enlarged}
            title="Check-in code"
            confirmLabel="Close"
            closeLabel="Close check-in code"
            onCancel={() => void closeCode()}
            onConfirm={() => void closeCode()}
            viewer
            size="wide"
          >
            <img
              class="pk-badge-qr-expanded"
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr?.qr ?? ticket.data.badge.svg)}`}
              alt="Your check-in QR code"
            />
            {qr && <p class="pk-center pk-mono">{qr.code}</p>}
          </Dialog>,
          document.body,
        )}
    </div>
  );
}

/** With no day information, do not imply that the badge grants a venue place. */
const UNDATED_SEAT: AttendanceStanding = {
  inPerson: [],
  waitlisted: [],
  waitlistedInPerson: [],
  expired: [],
  virtual: [],
  onDemand: [],
  holdsInPersonSeat: false,
  online: false,
};

/**
 * What the code on the badge is for, on the days it applies to: the entrance
 * on confirmed in-person days only. A day on the waitlist or joined
 * online has no seat behind the code, so the card says so instead.
 */
function TicketUse({ standing, children }: { standing: AttendanceStanding; children: ComponentChildren }) {
  const online = standing.virtual.length ? `On ${formatDayList(standing.virtual)} you join online.` : "";
  if (standing.holdsInPersonSeat)
    return (
      <EventCard eyebrow="At the venue">
        <p>
          {standing.inPerson.length
            ? `Show this QR code at the entrance and at sessions on ${formatDayList(standing.inPerson)}, or read out the code under it.`
            : "Show this QR code at the entrance and at sessions, or read out the code under it."}{" "}
          Your printed badge carries the same code.
        </p>
        {(standing.waitlisted.length > 0 || standing.expired.length > 0 || online) && (
          <p>
            {standing.waitlisted.length ? `You're on the waitlist for ${formatDayList(standing.waitlisted)}. ` : ""}
            {standing.expired.length ? `Your offer expired for ${formatDayList(standing.expired)}. ` : ""}
            {online}
          </p>
        )}
        <div class="pk-cluster">{children}</div>
      </EventCard>
    );
  if (standing.expired.length)
    return (
      <EventCard eyebrow="Registration" title="Offer expired">
        <p>
          Your offer expired for {formatDayList(standing.expired)}. Update your registration to request a place again.
        </p>
        {standing.waitlisted.length > 0 && <p>You're on the waitlist for {formatDayList(standing.waitlisted)}.</p>}
        {online && <p>{online}</p>}
        <div class="pk-cluster">{children}</div>
      </EventCard>
    );
  if (standing.waitlistedInPerson.length)
    return (
      <EventCard eyebrow="Waitlist" title="No in-person seat yet">
        <p>
          {`You're on the waitlist for ${formatDayList(standing.waitlistedInPerson)}.`} This code gets you in once a
          seat is yours, and we email you when one is offered.
        </p>
        {online && <p>{online}</p>}
        <div class="pk-cluster">{children}</div>
      </EventCard>
    );
  if (standing.waitlisted.length)
    return (
      <EventCard eyebrow="Waitlist">
        <p>You're on the waitlist for {formatDayList(standing.waitlisted)}. We'll email you when a place is offered.</p>
        <div class="pk-cluster">{children}</div>
      </EventCard>
    );
  if (!standing.online && !standing.onDemand.length)
    return (
      <EventCard eyebrow="Registration">
        <p>Review your registration to see your attendance choices.</p>
        <div class="pk-cluster">{children}</div>
      </EventCard>
    );
  if (!standing.online)
    return (
      <EventCard eyebrow="On demand">
        <p>Your registration includes on-demand access. Review the event details for available recordings.</p>
        <div class="pk-cluster">{children}</div>
      </EventCard>
    );
  return (
    <EventCard eyebrow="Online">
      <p>You attend online, so you don't need this code to join. Sessions stream in the Virtual room.</p>
      <div class="pk-cluster">{children}</div>
    </EventCard>
  );
}
