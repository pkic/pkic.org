import type { ComponentChildren } from "preact";
import { lazy, Suspense } from "preact/compat";
import { Tabs } from "../../../../../../components/Tabs";
import { Spinner } from "../../../../../../components/Spinner";
import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
import { useLiveBrowserSession } from "../../../../../../hooks/useLiveBrowserSession";
import { Alert } from "../../../../../../ui/Alert";
import { isAuthed, portalSession } from "../../../../state";
import { hasEventAgendaPermission } from "../../event-agenda-access";

const BadgeCredentials = lazy(() =>
  import("../badges/BadgeCredentials").then((module) => ({ default: module.BadgeCredentials })),
);
const AttendeeSessions = lazy(() =>
  import("./AttendeeSessions").then((module) => ({ default: module.AttendeeSessions })),
);
const AttendanceEvidence = lazy(() =>
  import("../agenda/AttendanceEvidence").then((module) => ({ default: module.AttendanceEvidence })),
);
const EventAttendanceDetails = lazy(() =>
  import("../agenda/EventAttendanceDetails").then((module) => ({ default: module.EventAttendanceDetails })),
);

/** The same attendee sections serve both record projections without widening either one. */
export function AttendeeParticipationSections(props: {
  slug?: string;
  eventId: string;
  registrationId: string;
  userId: string;
  canManage: boolean;
  badgesPath?: string;
  registration: ComponentChildren;
  history?: ComponentChildren;
}) {
  const session = portalSession.value;
  return (
    <AttendeeSections
      key={`${props.eventId}:${props.registrationId}:${props.userId}:${session?.sessionId ?? "anonymous"}`}
      {...props}
    />
  );
}

function AttendeeSections({
  slug,
  eventId,
  registrationId,
  userId,
  canManage,
  badgesPath,
  registration,
  history,
}: Parameters<typeof AttendeeParticipationSections>[0]) {
  const [section, setSection] = useHashQueryParam(`attendeeTab.${registrationId}`, "registration");
  const [checkinView, setCheckinView] = useHashQueryParam(`attendeeEvidence.${registrationId}`, "observations");
  const browser = useLiveBrowserSession();
  const session = portalSession.value;
  const activeSession = Boolean(
    isAuthed.value &&
    session &&
    Math.min(Date.parse(session.expiresAt), Date.parse(session.idleExpiresAt)) > Date.now(),
  );
  const manage = Boolean(slug && canManage && activeSession && hasEventAgendaPermission(eventId, "events:manage"));
  const canReadAttendance = Boolean(
    slug && activeSession && hasEventAgendaPermission(eventId, "agenda:attendance_read"),
  );
  const items = [
    { key: "registration", label: "Registration" },
    ...(manage
      ? [
          { key: "badge", label: "Badge" },
          { key: "sessions", label: "Sessions" },
        ]
      : []),
    ...(canReadAttendance ? [{ key: "checkins", label: "Check-ins" }] : []),
    ...(manage && history ? [{ key: "history", label: "History" }] : []),
  ];
  const selected = items.some((item) => item.key === section) ? section : "registration";
  return (
    <div class="pk-stack">
      <Tabs
        items={items.map((item) => ({ ...item, panelId: `attendee-section-panel-${item.key}` }))}
        active={selected}
        onChange={setSection}
        label="Attendee sections"
        idPrefix="attendee-section"
      />
      <div role="tabpanel" id={`attendee-section-panel-${selected}`} aria-labelledby={`attendee-section-${selected}`}>
        {selected === "registration" ? (
          registration
        ) : !browser.live ? (
          <Alert tone="info">Reconnect and keep this screen visible to view attendee records.</Alert>
        ) : (
          <Suspense fallback={<Spinner label="Loading attendee section…" />}>
            <div key={`${selected}:${browser.epoch}`}>
              {selected === "badge" && manage && slug && (
                <BadgeCredentials
                  slug={slug}
                  eventId={eventId}
                  userId={userId}
                  basePath={badgesPath ?? `/events/${encodeURIComponent(slug)}/badges`}
                />
              )}
              {selected === "sessions" && manage && slug && (
                <AttendeeSessions slug={slug} registrationId={registrationId} />
              )}
              {selected === "checkins" && canReadAttendance && slug && (
                <div class="pk-stack">
                  <Tabs
                    items={[
                      { key: "observations", label: "Observations" },
                      { key: "attempts", label: "Scan log" },
                    ]}
                    active={checkinView === "attempts" ? "attempts" : "observations"}
                    onChange={setCheckinView}
                    label="Attendee check-in records"
                  />
                  {checkinView === "attempts" ? (
                    <EventAttendanceDetails
                      base={`/api/v1/events/${encodeURIComponent(slug)}/attendance`}
                      params={{ userId }}
                      timeZone="UTC"
                      view="attempts"
                    />
                  ) : (
                    <AttendanceEvidence slug={slug} userId={userId} timeZone="UTC" onChanged={() => {}} />
                  )}
                  <p class="pk-muted pk-small">
                    Recorded days use the original capture context. A scan or admission decision is separate from an
                    attendance observation.
                  </p>
                </div>
              )}
              {selected === "history" && manage && history}
            </div>
          </Suspense>
        )}
      </div>
    </div>
  );
}
