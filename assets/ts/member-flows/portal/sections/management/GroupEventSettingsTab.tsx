/** The event's settings tab: its routed sections and the editor or view each one holds. */
import { useEffect, useState } from "preact/hooks";
import { lazy, Suspense } from "preact/compat";
import { eventClock } from "../../../../../shared/event-clock";
import type { GroupEvent } from "../../../../../shared/schemas/group-events";
import { EVENT_PROFILE_LABELS, EVENT_VISIBILITY_LABELS } from "../../../../../shared/schemas/event-series";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Tabs } from "../../../../components/Tabs";
import { ButtonLink } from "../../../../ui/Button";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { LinkList } from "../../../../ui/LinkList";
import { Menu } from "../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { portalHasGlobalPermission } from "../../shell/portal-navigation";
import { portalSession } from "../../state";
import { formatDateTimeInZone } from "../../ui";
import { hasEventAgendaPermission } from "../events/event-agenda-access";
import { LazySponsorTiersTab } from "../events/detail/settings/LazySponsorTiersTab";
import { groupEventPlace } from "./group-event-place";
import { GroupEventEditor } from "./GroupEventEditor";
import { GroupEventSessionTypes } from "./GroupEventSessionTypes";
import { GroupEventSettingsSection } from "./GroupEventSettingsSection";
import { LazyGroupEventConfiguration } from "./LazyGroupEventConfiguration";
import { ResourceSharingEditor } from "./ResourceSharingEditor";
import { canConfigureEventForms } from "./useEventFormPlacement";

const RawEvidenceRetentionPolicy = lazy(() =>
  import("../events/detail/settings/RawEvidenceRetentionPolicy").then((module) => ({
    default: module.RawEvidenceRetentionPolicy,
  })),
);
const EventRecordings = lazy(() =>
  import("../events/detail/settings/EventRecordings").then((module) => ({ default: module.EventRecordings })),
);
const EventLiveSettings = lazy(() =>
  import("../events/detail/settings/EventLiveSettings").then((module) => ({ default: module.EventLiveSettings })),
);
const GroupEventScheduling = lazy(() =>
  import("./GroupEventScheduling").then((module) => ({ default: module.GroupEventScheduling })),
);
const EventTeamSettings = lazy(() =>
  import("../events/detail/settings/EventTeamSettings").then((module) => ({ default: module.EventTeamSettings })),
);

function isStandaloneEvent(event: Pick<GroupEvent, "seriesId" | "profileKey">): boolean {
  return event.seriesId === null && event.profileKey !== "meeting" && event.profileKey !== "board_meeting";
}

export function GroupEventSettingsTab({
  event,
  groupId,
  settingsPath,
  detailId,
  detailTab,
  detailSegment,
  onUpdated,
}: {
  event: GroupEvent;
  groupId: string;
  /** The settings tab's own route; each section lives below it. */
  settingsPath: string;
  detailId?: string;
  detailTab?: string;
  detailSegment?: string;
  onUpdated?: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [detailId]);
  const canManage = event.capabilities.includes("manage");
  const standalone = isStandaloneEvent(event);
  return (
    <>
      <Tabs
        label="Settings sections"
        items={[
          ...(canManage
            ? [
                { key: "general", label: "General" },
                { key: "location", label: "Location" },
                { key: "links", label: "Links" },
                { key: "session-types", label: "Program" },
                { key: "registration", label: "Registration" },
                { key: "cfp", label: "CFP" },
                { key: "recordings", label: "Recordings" },
                { key: "retention", label: "Retention" },
                ...(event.ownerGroupId === groupId ? [{ key: "sharing", label: "Sharing" }] : []),
              ]
            : []),
          ...(canManage || hasEventAgendaPermission(event.id, "agenda:read") ? [{ key: "team", label: "Team" }] : []),
          ...(!canManage && hasEventAgendaPermission(event.id, "agenda:write")
            ? [{ key: "scheduling", label: "Scheduling" }]
            : []),
          ...(hasEventAgendaPermission(event.id, "agenda:live_moderate") ? [{ key: "live", label: "Studio" }] : []),
        ]}
        active={
          detailId === "scheduling" && canManage
            ? "session-types"
            : ["access", "terms", "attendance-days", "sponsors"].includes(detailId ?? "")
              ? "registration"
              : (detailId ??
                (canManage ? "general" : hasEventAgendaPermission(event.id, "agenda:live_moderate") ? "live" : "team"))
        }
        hrefFor={(key) => (key === "general" ? settingsPath : `${settingsPath}/${key}`)}
      />
      {canManage && ["session-types", "scheduling"].includes(detailId ?? "") && (
        <Tabs
          label="Program settings"
          items={[
            { key: "session-types", label: "Session types" },
            ...(hasEventAgendaPermission(event.id, "agenda:write") ? [{ key: "scheduling", label: "Scheduling" }] : []),
          ]}
          active={detailId ?? "session-types"}
          hrefFor={(key) => `${settingsPath}/${key}`}
        />
      )}
      {canManage && ["registration", "access", "terms", "attendance-days", "sponsors"].includes(detailId ?? "") && (
        <Tabs
          label="Registration settings"
          items={[
            { key: "registration", label: "Policy" },
            { key: "access", label: "Visibility and access" },
            { key: "terms", label: "Terms" },
            { key: "attendance-days", label: "Attendance days" },
            { key: "sponsors", label: "Sponsor tiers" },
          ]}
          active={detailId ?? "registration"}
          hrefFor={(key) => `${settingsPath}/${key}`}
        />
      )}
      {(detailId === "team" && (canManage || hasEventAgendaPermission(event.id, "agenda:read"))) ||
      (!canManage && !detailId && !hasEventAgendaPermission(event.id, "agenda:live_moderate")) ? (
        <Suspense fallback={<Spinner label="Loading team…" />}>
          <EventTeamSettings
            slug={event.slug}
            section={detailTab}
            personId={detailSegment}
            teamPath={`${settingsPath}/team`}
            timeZone={event.timezone}
            canManage={canManage}
            canEditStaffing={hasEventAgendaPermission(event.id, "agenda:write")}
            canReadStaffing={hasEventAgendaPermission(event.id, "agenda:read")}
          />
        </Suspense>
      ) : detailId === "recordings" && canManage ? (
        <Suspense fallback={<Spinner />}>
          <EventRecordings
            slug={event.slug}
            canLinkProviderMeetings={portalHasGlobalPermission(portalSession.value, "events:manage")}
            basePath={`${settingsPath}/recordings`}
            sourceId={detailTab}
          />
        </Suspense>
      ) : (detailId === "live" || (!canManage && !detailId)) &&
        hasEventAgendaPermission(event.id, "agenda:live_moderate") ? (
        <Suspense fallback={<Spinner label="Loading live settings…" />}>
          <EventLiveSettings slug={event.slug} />
        </Suspense>
      ) : detailId === "scheduling" ? (
        <Suspense fallback={<Spinner />}>
          <GroupEventScheduling slug={event.slug} canEdit={hasEventAgendaPermission(event.id, "agenda:write")} />
        </Suspense>
      ) : detailId === "session-types" && canManage ? (
        <GroupEventSessionTypes
          slug={event.slug}
          groupId={groupId}
          eventId={event.id}
          canEdit={canManage}
          onUpdated={onUpdated}
        />
      ) : detailId === "access" && canManage && !canConfigureEventForms(event) ? (
        <GroupEventSettingsSection
          slug={event.slug}
          section="registration"
          groupSettings={{ groupId, eventId: event.id, canEdit: canManage }}
          onUpdated={onUpdated}
        />
      ) : detailId === "cfp" && canManage && canConfigureEventForms(event) ? (
        <LazyGroupEventConfiguration event={event} groupId={groupId} onUpdated={onUpdated} section="proposals" />
      ) : detailId === "cfp" && canManage ? (
        <GroupEventSettingsSection
          slug={event.slug}
          onUpdated={onUpdated}
          groupSettings={{ groupId, eventId: event.id, canEdit: canManage }}
        />
      ) : ["registration", "terms", "attendance-days"].includes(detailId ?? "") && canManage ? (
        <LazyGroupEventConfiguration
          event={event}
          groupId={groupId}
          onUpdated={onUpdated}
          section={detailId === "terms" ? "terms" : detailId === "attendance-days" ? "attendance-days" : "registration"}
        />
      ) : detailId === "retention" && canManage ? (
        <Suspense fallback={<Spinner />}>
          <RawEvidenceRetentionPolicy event={event} />
        </Suspense>
      ) : detailId === "sponsors" && canManage ? (
        <LazySponsorTiersTab
          slug={event.slug}
          canWrite={canManage}
          endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(event.id)}/sponsors/tiers`}
        />
      ) : detailId === "sharing" && canManage && event.ownerGroupId === groupId ? (
        <ResourceSharingEditor kind="event" groupId={groupId} resourceId={event.id} ownerGroupId={event.ownerGroupId} />
      ) : canManage && !event.seriesId && (!detailId || detailId === "general" || detailId === "location") ? (
        <GroupEventSettingsSection
          slug={event.slug}
          section={detailId === "location" ? "location" : "general"}
          groupSettings={{ groupId, eventId: event.id, canEdit: canManage }}
          onUpdated={onUpdated}
        />
      ) : !canManage ? (
        <ErrorAlert error="Event settings are not available to your current identity." />
      ) : (
        <>
          <Panel aria-label={editing ? "Edit event" : "Event details"}>
            <PanelHeader
              title={editing ? "Edit event" : "Event details"}
              menu={
                !editing && standalone ? (
                  <Menu
                    label="Event actions"
                    align="end"
                    items={[{ id: "edit", label: "Edit event", onSelect: () => setEditing(true) }]}
                  />
                ) : undefined
              }
            >
              {event.seriesId && (
                <ButtonLink href={`#/groups/${encodeURIComponent(groupId)}/meetings`}>Manage meeting series</ButtonLink>
              )}
            </PanelHeader>
            <PanelBody>
              {editing ? (
                <GroupEventEditor
                  groupId={groupId}
                  event={event}
                  section={
                    detailId === "location"
                      ? "location"
                      : detailId === "links"
                        ? "links"
                        : detailId === "access"
                          ? "registration"
                          : "general"
                  }
                  onSaved={async () => {
                    setEditing(false);
                    await onUpdated?.();
                  }}
                  onCancel={() => setEditing(false)}
                />
              ) : (
                <DescriptionList
                  items={
                    detailId === "location"
                      ? [
                          { term: "Starts", value: formatDateTimeInZone(event.startsAt, eventClock(event)) },
                          { term: "Ends", value: formatDateTimeInZone(event.endsAt, eventClock(event)) },
                          { term: "Time zone", value: event.timezone },
                          { term: "Location", value: groupEventPlace(event) },
                        ]
                      : detailId === "access"
                        ? [
                            { term: "Visibility", value: EVENT_VISIBILITY_LABELS[event.visibility] },
                            { term: "Peer invitation limit", value: event.inviteLimitAttendee },
                          ]
                        : detailId === "links"
                          ? [
                              {
                                term: "Links",
                                value: event.links.length ? (
                                  <LinkList links={event.links} label="Event links" />
                                ) : undefined,
                              },
                            ]
                          : [
                              { term: "Name", value: event.name },
                              { term: "Slug", value: <span class="pk-mono">{event.slug}</span> },
                              {
                                term: "Profile",
                                value: EVENT_PROFILE_LABELS[event.profileKey ?? "conference"],
                              },
                            ]
                  }
                />
              )}
            </PanelBody>
          </Panel>
        </>
      )}
    </>
  );
}
