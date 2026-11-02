import { useEffect, useRef, useState } from "preact/hooks";
import type { z } from "zod";
import {
  personalAgendaResponseSchema,
  type personalAgendaSessionSchema,
} from "../../../../../../../shared/schemas/event-personal-agenda";
import { agendaTimeZones, formatAgendaInstant } from "../../../../../../../shared/agenda-time-display";
import { viewerTimeZone } from "../../../../../../../shared/timezone";
import { contractClock } from "../../../../../../../shared/event-clock";
import { useData } from "../../../../../../hooks/useData";
import { getJson } from "../../../../../../shared/api-client";
import { Spinner } from "../../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { IconScan } from "../../../../../../components/icons/app-navigation";
import { PageHeader } from "../../../../../../ui/PageHeader";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { ButtonLink } from "../../../../../../ui/Button";
import { availableScannerActions } from "../../../../../../../shared/event-scanner-permissions";
import { hasEventAgendaPermission } from "../../event-agenda-access";
import { usePortalHashLocation } from "../../../../hash-location";
import { toast } from "../../../../ui";
import { sessionAdmissionNote } from "../../../../../../../shared/event-participation-link";
import {
  SessionDetailsParticipation,
  SessionStarButton,
  type SessionStarControl,
} from "../../../../../../site/AgendaParticipationControls";
import { SessionActionBar, sessionHasParticipationActions } from "./SessionActionBar";
import { setSessionStar } from "./session-star";

type Session = z.infer<typeof personalAgendaSessionSchema>;
const CHECK_IN_LABEL = "Session check-in";

/** One occurrence's live personal participation, read from the canonical personal agenda. */
function useParticipationSession(slug: string, occurrenceId: string, refreshKey?: string) {
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/agenda/participation?occurrenceId=${encodeURIComponent(occurrenceId)}&limit=1`;
  return useData(() => getJson(endpoint, personalAgendaResponseSchema), [endpoint, refreshKey]);
}

/** Scanner staff open this session's check-in from its details; attendees never see it. */
export function SessionCheckInLink({
  slug,
  eventId,
  occurrenceId,
}: {
  slug: string;
  eventId?: string;
  occurrenceId: string;
}) {
  const permitted =
    eventId && availableScannerActions((permission) => hasEventAgendaPermission(eventId, permission)).length > 0;
  if (!permitted) return null;
  return (
    <ButtonLink
      icon
      variant="ghost"
      aria-label={CHECK_IN_LABEL}
      title={CHECK_IN_LABEL}
      href={usePortalHashLocation.hrefs(
        `/events/${encodeURIComponent(slug)}/scanner?${new URLSearchParams({ session: occurrenceId }).toString()}`,
      )}
    >
      <IconScan />
    </ButtonLink>
  );
}

/**
 * Live participation inside the shared agenda's session details, after the abstract and speakers.
 * The star and admission line sit in the details header, so an open session adds no section here.
 */
export function SessionParticipationManager({
  slug,
  occurrenceId,
  refreshKey,
  notice,
  onChanged,
}: {
  slug: string;
  occurrenceId: string;
  /** Changes when the viewer's marks change elsewhere, so this view rereads its row. */
  refreshKey?: string;
  /** Shown above the actions, for example when the approved session changed while it was open. */
  notice?: string;
  onChanged: (session: Session) => void;
}) {
  const loaded = useParticipationSession(slug, occurrenceId, refreshKey);
  const session = loaded.data?.sessions[0];
  const changed = useRef(onChanged);
  changed.current = onChanged;
  useEffect(() => {
    if (session?.id === occurrenceId) changed.current(session);
  }, [session, occurrenceId]);
  // The header star reads the agenda's own marks, so the body stays empty until the live state is known.
  if (loaded.loading) return null;
  if (!session || session.id !== occurrenceId)
    return (
      <SessionDetailsParticipation>
        <ErrorAlert error={loaded.error ?? "This session is no longer available in the published agenda."} />
      </SessionDetailsParticipation>
    );
  if (!loaded.error && !sessionHasParticipationActions(session, notice)) return null;
  return (
    <SessionDetailsParticipation>
      {loaded.error && <ErrorAlert error={loaded.error} />}
      <SessionActionBar
        slug={slug}
        session={session}
        notice={notice}
        onSaved={() => {
          void loaded.reload();
        }}
      />
    </SessionDetailsParticipation>
  );
}

/**
 * Dedicated view for an occurrence that is not on the shared public agenda, such as an invitation-only session.
 * It renders inside the participant event tabs, so the My agenda tab is the way back.
 */
export function SessionParticipation({
  slug,
  eventId,
  occurrenceId,
  showLocalTime = false,
}: {
  slug: string;
  eventId?: string;
  occurrenceId: string;
  showLocalTime?: boolean;
}) {
  const loaded = useParticipationSession(slug, occurrenceId);
  const session = loaded.data?.sessions[0];
  const [starring, setStarring] = useState(false);
  const starRunning = useRef(false);
  if (loaded.loading) return <Spinner label="Loading session participation…" />;
  if (!session || session.id !== occurrenceId)
    return (
      <div class="pk-stack">
        <PageHeader title="Session participation" />
        <ErrorAlert error={loaded.error ?? "This session is no longer available in the published agenda."} />
      </div>
    );
  const star: SessionStarControl = {
    starred: session.saved,
    busy: starring,
    onStar: () => {
      if (starRunning.current) return;
      starRunning.current = true;
      setStarring(true);
      void setSessionStar(slug, session.id, !session.saved)
        .then(() => loaded.reload())
        .catch((error: unknown) =>
          toast(error instanceof Error ? error.message : "Your star could not be updated. Please try again.", "error"),
        )
        .finally(() => {
          starRunning.current = false;
          setStarring(false);
        });
    },
  };
  const zones = agendaTimeZones(
    contractClock(session),
    viewerTimeZone(),
    // A held seat keeps its own mode; otherwise the person attends the way their day registration does.
    (["reserved", "approval_pending", "waitlisted"].includes(session.status ?? "") ? session.attendanceMode : null) ??
      session.availability?.attendanceMode ??
      session.attendanceMode,
    showLocalTime,
  );
  const timeValue = (value: string | null) =>
    value ? (
      <span class="pk-stack pk-stack--tight">
        <span>
          {zones.primary.label} · {formatAgendaInstant(value, zones.primary.zone)}
        </span>
        {zones.secondary && (
          <small class="pk-muted">
            {zones.secondary.label} · {formatAgendaInstant(value, zones.secondary.zone)}
          </small>
        )}
      </span>
    ) : (
      "Time to be announced"
    );
  return (
    <div class="pk-stack">
      <PageHeader
        title={session.title}
        eyebrow="Session participation"
        actions={
          <>
            {session.availability && session.availability.state !== "registration_required" && (
              <SessionStarButton title={session.title} star={star} />
            )}
            <SessionCheckInLink slug={slug} eventId={eventId} occurrenceId={session.id} />
          </>
        }
      />
      {loaded.error && <ErrorAlert error={loaded.error} />}
      <DescriptionList
        items={[
          { term: "Starts", value: timeValue(session.startAt) },
          { term: "Ends", value: timeValue(session.endAt) },
          { term: "Locations", value: session.rooms.map((room) => room.name).join(", ") || "No physical location" },
          { term: "Admission", value: sessionAdmissionNote(session.admissionPolicy, session.accessPolicy) },
        ]}
      />
      <SessionActionBar
        slug={slug}
        session={session}
        onSaved={() => {
          void loaded.reload();
        }}
      />
    </div>
  );
}
