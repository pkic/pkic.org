import { useMailingListSync, MailingListSyncSettings } from "./MailingListSync";
import { BreadcrumbBranch } from "../../../../ui/BreadcrumbScope";
import { useState } from "preact/hooks";
import {
  mailingListResponseSchema,
  MAILING_LIST_POSTING_POLICY_LABELS,
  MAILING_LIST_MODERATION_POLICY_LABELS,
} from "../../../../../shared/schemas/mailing-lists";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Tabs } from "../../../../components/Tabs";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { Avatar } from "../../../../ui/Avatar";
import { ProfileHeader } from "../../../../ui/ProfileHeader";
import { Menu } from "../../../../ui/Menu";
import { usePortalHashLocation } from "../../hash-location";
import { GroupMailingListSettings, GroupMailingListStanding } from "./GroupMailingListSettings";
import { GroupMailingListSubscribers } from "./GroupMailingListSubscribers";
import { mailingListLifecycleActions } from "./mailing-list-lifecycle";
import { ResourceSharingEditor } from "./ResourceSharingEditor";

/**
 * The record's facets. Who is on the list comes first: that is what a manager
 * opens a list to see, and it is what the configuration below it is for.
 */
const RECORD_TABS = [
  { key: "subscribers", label: "Subscribers" },
  { key: "settings", label: "Settings" },
  { key: "sharing", label: "Sharing" },
] as const;

type MailingListRecordTab = (typeof RECORD_TABS)[number]["key"];

const DEFAULT_TAB: MailingListRecordTab = "subscribers";

/**
 * A mailing list's own page.
 *
 * Activating a row used to unfold the list's settings between the table's
 * rows (#37), which made the configuration the whole of what a list is and
 * left its subscribers nowhere. A list is a record: it has an address, a
 * header that says what it is and whether it is in service, its commands, and
 * one tab per facet — the people on it, how it is configured, and which other
 * groups were given it. The active tab is a URL segment, so a link to the
 * subscribers opens on the subscribers.
 */
export function GroupMailingListRecord({
  groupId,
  listId,
  initialTab,
  onLeave,
}: {
  groupId: string;
  listId: string;
  /** The URL-addressed tab segment, if any. Undefined or unrecognized selects Subscribers. */
  initialTab?: string;
  onLeave: () => void;
}) {
  const [, navigate] = usePortalHashLocation();
  const sync = useMailingListSync(groupId, listId);
  const [commandError, setCommandError] = useState<Error | null>(null);
  const detail = useData(
    () =>
      getJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/mailing-lists/${encodeURIComponent(listId)}`,
        mailingListResponseSchema,
      ),
    [groupId, listId],
  );
  // While another list loads, useData still holds the previous one; showing it
  // would put one list's name over another list's subscribers.
  const list = detail.data?.mailingList.id === listId ? detail.data.mailingList : null;
  const requested = initialTab as MailingListRecordTab | undefined;
  const tab: MailingListRecordTab = RECORD_TABS.some((item) => item.key === requested)
    ? (requested as MailingListRecordTab)
    : DEFAULT_TAB;

  function tabPath(key: string): string {
    const base = `/groups/${encodeURIComponent(groupId)}/mailing-lists/${encodeURIComponent(listId)}`;
    return key === DEFAULT_TAB ? base : `${base}/${key}`;
  }

  /*
   * The tabs navigate — each one is a URL — so they render as links carrying
   * `aria-current="page"` rather than as the ARIA tab pattern, and the regions
   * below are named sections whose names say which list they belong to.
   */
  return (
    <div class="pk pk-stack">
      {detail.loading && !list && <Spinner label="Loading mailing list…" />}
      {detail.error && <ErrorAlert error={detail.error} />}
      {commandError && <ErrorAlert error={commandError} />}
      {sync.error && <ErrorAlert error={sync.error} />}
      {sync.notice && <p role="status">{sync.notice}</p>}
      {list && (
        <BreadcrumbBranch
          items={[
            { label: list.label, href: usePortalHashLocation.hrefs(tabPath(DEFAULT_TAB)) },
            {
              label: RECORD_TABS.find((item) => item.key === tab)?.label ?? tab,
              href: usePortalHashLocation.hrefs(tabPath(tab)),
            },
          ]}
        >
          <div class="pk-record">
            <ProfileHeader
              headingLevel={3}
              title={list.label}
              media={
                <Avatar
                  name="@"
                  size="lg"
                  status={{ label: list.active ? "Active" : "Archived", tone: list.active ? "accent" : "neutral" }}
                />
              }
              lede={<span class="pk-mono pk-break">{list.email}</span>}
              facts={[
                list.purpose === "group" ? "Group list" : list.purpose.replaceAll("_", " "),
                MAILING_LIST_MODERATION_POLICY_LABELS[list.moderationPolicy],
                MAILING_LIST_POSTING_POLICY_LABELS[list.postingPolicy],
              ]}
              actions={
                <Menu
                  label={`Mailing list actions for ${list.label}`}
                  heading={list.label}
                  align="end"
                  items={[
                    {
                      id: "sync",
                      label: "Sync now",
                      disabled:
                        !sync.settings?.enabled ||
                        sync.busy ||
                        (sync.enabled !== null && sync.enabled !== sync.settings?.enabled),
                      onSelect: () => void sync.sync(),
                    },
                    ...mailingListLifecycleActions({
                      groupId,
                      list,
                      onChanged: async () => {
                        setCommandError(null);
                        await detail.reload();
                      },
                      // A deleted record has no page left to stand on.
                      onDeleted: onLeave,
                      onError: setCommandError,
                    }),
                  ]}
                />
              }
              navigation={
                <Tabs
                  items={RECORD_TABS.map(({ key, label }) => ({ key, label }))}
                  active={tab}
                  label={`${list.label} sections`}
                  onChange={(key) => navigate(tabPath(key))}
                  hrefFor={tabPath}
                />
              }
            >
              {tab === "subscribers" && (
                <section aria-label={`${list.label} subscribers`}>
                  <GroupMailingListSubscribers groupId={groupId} listId={list.id} />
                </section>
              )}
              {tab === "settings" && (
                <section aria-label={`${list.label} settings`}>
                  <GroupMailingListSettings key={list.id} groupId={groupId} list={list} onSaved={detail.reload} />
                  <MailingListSyncSettings sync={sync} />
                </section>
              )}
              {tab === "sharing" && (
                <section aria-label={`${list.label} sharing`}>
                  <ResourceSharingEditor
                    kind="mailingList"
                    groupId={groupId}
                    resourceId={list.id}
                    ownerGroupId={list.groupId}
                  />
                </section>
              )}
            </ProfileHeader>
            <aside class="pk-stack">
              <GroupMailingListStanding key={list.id} groupId={groupId} list={list} onSaved={detail.reload} />
            </aside>
          </div>
        </BreadcrumbBranch>
      )}
    </div>
  );
}
