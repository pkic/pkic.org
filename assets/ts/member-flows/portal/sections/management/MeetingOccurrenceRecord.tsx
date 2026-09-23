/**
 * One meeting occurrence as a page of its own (#126).
 *
 * It used to open inline under its row in the occurrences list, a settings
 * form unfolding between the rows with its tabs and buttons — the row
 * expansion every other record in the portal has already given up. An
 * occurrence is a record with facets: what it is, who was invited and what
 * they answered, which guests may enter, who came. So it has an address, a
 * header that says what it is and what can be done to it, and one routed
 * tab per facet.
 *
 * The commands — sending the group their links, cancelling, reinstating,
 * marking as held — are the record's, and live in its `…` menu; the
 * settings tab shows the facts and takes an explicit "Edit settings".
 */
import { useState } from "preact/hooks";
import {
  eventOccurrenceResponseSchema,
  eventOccurrenceInvitationsResponseSchema,
  type EventOccurrence,
  type GroupEventSeries,
} from "../../../../../shared/schemas/event-series";
import { formatDateTimeInZone } from "../../../../../shared/format-date";
import { Badge } from "../../../../components/Badge";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Tabs } from "../../../../components/Tabs";
import { useData } from "../../../../hooks/useData";
import { getJson, patchJson, postJson } from "../../../../shared/api-client";
import { Badge as ToneBadge } from "../../../../ui/Badge";
import { BreadcrumbBranch } from "../../../../ui/BreadcrumbScope";
import { Dialog } from "../../../../ui/Dialog";
import { Menu, type MenuItem } from "../../../../ui/Menu";
import { ProfileHeader } from "../../../../ui/ProfileHeader";
import { usePortalHashLocation } from "../../hash-location";
import { fmt, toast } from "../../ui";
import { MeetingAttendance } from "./MeetingAttendance";
import { MeetingGuests } from "./MeetingGuests";
import { MeetingInvitations } from "./MeetingInvitations";
import { MeetingOccurrenceSettings } from "./MeetingOccurrenceSettings";
import { downloadMeetingCalendar } from "./meeting-calendar-actions";

/** The record's facets, in the order a manager reads them. */
const OCCURRENCE_TABS = [
  { key: "settings", label: "Settings" },
  { key: "invitations", label: "Invitations" },
  { key: "guests", label: "Guests" },
  { key: "attendance", label: "Attendance" },
] as const;

type OccurrenceTab = (typeof OCCURRENCE_TABS)[number]["key"];

export function MeetingOccurrenceRecord({
  groupId,
  series,
  occurrenceId,
  tab: requestedTab,
  onSeriesChanged,
}: {
  groupId: string;
  series: GroupEventSeries;
  occurrenceId: string;
  /** The URL-addressed facet; undefined or unavailable selects the first one the reader may open. */
  tab?: string;
  onSeriesChanged: () => void | Promise<void>;
}) {
  const [, navigate] = usePortalHashLocation();
  const base = `/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series/${encodeURIComponent(series.id)}`;
  const endpoint = `${base}/occurrences/${encodeURIComponent(occurrenceId)}`;
  const recordPath = `/groups/${encodeURIComponent(groupId)}/meetings/${encodeURIComponent(series.id)}/occurrences/${encodeURIComponent(occurrenceId)}`;
  const canManage = series.capabilities.includes("manage");
  const canManageAttendance = series.capabilities.includes("manage_attendance");
  const detail = useData(() => getOccurrence(endpoint), [endpoint]);
  const occurrence = detail.data;
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const tabs = OCCURRENCE_TABS.filter(({ key }) =>
    key === "attendance"
      ? canManageAttendance
      : key === "guests"
        ? canManage && series.guestPolicy !== "none"
        : canManage,
  );
  const tab: OccurrenceTab | undefined = tabs.some((item) => item.key === requestedTab)
    ? (requestedTab as OccurrenceTab)
    : tabs[0]?.key;

  function tabPath(key: string): string {
    return key === tabs[0]?.key ? recordPath : `${recordPath}/${key}`;
  }

  async function changed(): Promise<void> {
    await Promise.all([detail.reload(), onSeriesChanged()]);
  }

  /** One command against the occurrence's current revision, announced either way. */
  async function command(request: () => Promise<unknown>, done: string): Promise<void> {
    setBusy(true);
    try {
      await request();
      toast(done, "success");
      await changed();
    } catch (caught) {
      toast((caught as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  function setStatus(current: EventOccurrence, status: EventOccurrence["status"], done: string): Promise<void> {
    return command(
      () => patchJson(endpoint, { expectedUpdatedAt: current.updatedAt, status }, eventOccurrenceResponseSchema),
      done,
    );
  }

  async function sendJoinLinks(current: EventOccurrence): Promise<void> {
    const confirmed = await confirmAction({
      title: `Send every participant their link to ${series.eventName}?`,
      body:
        current.invitationsRound > 0
          ? "They have had one before, so this is a reminder — everybody in the group receives it again."
          : "Everybody currently participating in the group receives one, with the meeting as a calendar invitation.",
      consequences: [
        "Each link opens in the portal and records the person who signs in",
        "The calendar invitation asks for an answer, which is recorded under Invitations",
        "People who join the group later are not covered by this round",
      ],
      confirmLabel: "Send join links",
    });
    if (!confirmed) return;
    await command(
      async () => {
        const { invitations } = await postJson(`${endpoint}/invitations`, {}, eventOccurrenceInvitationsResponseSchema);
        toast(
          `Join links queued for ${String(invitations.recipientCount)} ${
            invitations.recipientCount === 1 ? "participant" : "participants"
          }`,
          "success",
        );
      },
      `Round ${String(current.invitationsRound + 1)} sent`,
    );
  }

  async function reinstate(current: EventOccurrence): Promise<void> {
    const confirmed = await confirmAction({
      title: "Put this occurrence back on the schedule?",
      consequences: [
        "Everyone who was invited receives the meeting on their calendar again",
        "Join links sent before are valid once more",
      ],
      confirmLabel: "Reinstate occurrence",
      tone: "primary",
    });
    if (!confirmed) return;
    await setStatus(current, "scheduled", "Occurrence reinstated");
  }

  async function complete(current: EventOccurrence): Promise<void> {
    const confirmed = await confirmAction({
      title: "Mark this occurrence as held?",
      consequences: ["No more join links can be sent for it", "Attendance already recorded is kept"],
      confirmLabel: "Mark as held",
      tone: "primary",
    });
    if (!confirmed) return;
    await setStatus(current, "completed", "Occurrence marked as held");
  }

  function commandsFor(current: EventOccurrence): MenuItem[] {
    const ended = current.endsAt <= new Date().toISOString();
    const scheduled = current.status === "scheduled";
    return [
      {
        id: "calendar",
        label: "Download calendar",
        onSelect: () => downloadMeetingCalendar(groupId, series.id, current.id),
      },
      ...(canManage
        ? [
            {
              id: "send-links",
              label: current.invitationsRound > 0 ? "Send join links again…" : "Send join links…",
              disabled: busy || !scheduled || ended,
              onSelect: () => void sendJoinLinks(current),
            },
            ...(scheduled
              ? [
                  { id: "complete", label: "Mark as held", disabled: busy, onSelect: () => void complete(current) },
                  {
                    id: "cancel",
                    label: "Cancel occurrence…",
                    danger: true,
                    disabled: busy,
                    separatorBefore: true,
                    onSelect: () => setCancelling(true),
                  },
                ]
              : []),
            ...(current.status === "cancelled"
              ? [
                  {
                    id: "reinstate",
                    label: "Reinstate occurrence…",
                    disabled: busy,
                    onSelect: () => void reinstate(current),
                  },
                ]
              : []),
          ]
        : []),
    ];
  }

  const title = occurrence ? formatDateTimeInZone(occurrence.startsAt, series.timezone) : "Occurrence";

  return (
    <BreadcrumbBranch items={[{ label: title, href: usePortalHashLocation.hrefs(recordPath) }]}>
      <div class="pk pk-stack">
        {detail.loading && !occurrence && <Spinner label="Loading the occurrence…" />}
        {detail.error && <ErrorAlert error={detail.error} />}
        {occurrence && (
          <>
            <ProfileHeader
              headingLevel={3}
              title={title}
              context={
                <>
                  <Badge status={occurrence.status} />
                  {occurrence.invitedCount > 0 && (
                    <ToneBadge tone="neutral" dot={false}>
                      {String(occurrence.invitedCount)} invited
                    </ToneBadge>
                  )}
                  {occurrence.rsvp.accepted > 0 && (
                    <ToneBadge tone="ok">{String(occurrence.rsvp.accepted)} accepted</ToneBadge>
                  )}
                  {occurrence.rsvp.declined > 0 && (
                    <ToneBadge tone="danger">{String(occurrence.rsvp.declined)} declined</ToneBadge>
                  )}
                </>
              }
              lede={
                <>
                  {series.eventName} · until {formatDateTimeInZone(occurrence.endsAt, series.timezone)}
                  {occurrence.location ? ` · ${occurrence.location}` : ""}
                </>
              }
              facts={[
                occurrence.invitationsSentAt
                  ? `Round ${String(occurrence.invitationsRound)} went out ${fmt(occurrence.invitationsSentAt)}`
                  : occurrence.invitedCount > 0
                    ? "Invited automatically when the occurrence was scheduled"
                    : "No join links have been sent for this meeting yet",
              ]}
              actions={<Menu label="Occurrence actions" align="end" items={commandsFor(occurrence)} />}
            />
            {canManage && cancelling && (
              <Dialog
                open
                destructive
                title="Cancel this occurrence?"
                description={`${title} is taken off the schedule.`}
                consequences={[
                  occurrence.invitedCount > 0
                    ? `${String(occurrence.invitedCount)} invited people receive a calendar cancellation`
                    : "Nobody has been invited, so nobody is written to",
                  "Join links sent for it stop admitting anyone",
                  "It can be reinstated from this menu later",
                ]}
                confirmLabel={busy ? "Cancelling…" : "Cancel occurrence"}
                cancelLabel="Keep occurrence"
                confirmDisabled={busy}
                onConfirm={() => {
                  void setStatus(occurrence, "cancelled", "Occurrence cancelled").then(() => setCancelling(false));
                }}
                onCancel={() => setCancelling(false)}
              />
            )}
            {tabs.length > 1 && (
              <Tabs
                items={[...tabs]}
                active={tab ?? ""}
                label="Occurrence sections"
                onChange={(key) => navigate(tabPath(key))}
                hrefFor={tabPath}
              />
            )}
            {tab === "settings" && (
              <section aria-label="Occurrence settings">
                <MeetingOccurrenceSettings
                  endpoint={endpoint}
                  occurrence={occurrence}
                  timeZone={series.timezone}
                  onChanged={changed}
                />
              </section>
            )}
            {tab === "invitations" && (
              <section aria-label="Occurrence invitations">
                <MeetingInvitations endpoint={endpoint} occurrence={occurrence} />
              </section>
            )}
            {tab === "guests" && (
              <section aria-label="Occurrence guests">
                <MeetingGuests
                  base={base}
                  occurrence={occurrence}
                  seriesInviteWindow={series.inviteWindow}
                  timeZone={series.timezone}
                />
              </section>
            )}
            {tab === "attendance" && (
              <section aria-label="Occurrence attendance">
                <MeetingAttendance base={base} occurrence={occurrence} />
              </section>
            )}
          </>
        )}
      </div>
    </BreadcrumbBranch>
  );
}

async function getOccurrence(endpoint: string): Promise<EventOccurrence> {
  const response = await getJson(endpoint, eventOccurrenceResponseSchema);
  return response.occurrence;
}
