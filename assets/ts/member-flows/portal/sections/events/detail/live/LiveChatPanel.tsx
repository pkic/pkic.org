import { useEffect, useRef, useState } from "preact/hooks";
import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
import { TabList } from "../../../../../../ui/TabList";
import { Badge } from "../../../../../../ui/Badge";
import { formatNumber } from "../../../../../../../shared/format-number";
import { LIVE_CHAT_POLICY } from "../../../../../../../shared/live-chat-policy";
import type { LiveChatMessage, LiveRoomClientMessage } from "../../../../../../../shared/schemas/live-session-room";
import type { LiveChatView } from "../../../../../../live-session/location-chat-state";
import { LiveChat } from "../../../../../../live-session/LiveChat";
import { LiveChatMessageRow } from "../../../../../../live-session/LiveChatMessageRow";
import { LiveAuthorProvider } from "../../../../../../live-session/LiveAuthor";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import "./LiveSessionDesk.css";

type Send = (message: LiveRoomClientMessage) => boolean;
const VIEWS = ["attendee", "operator", "review"] as const;
type View = (typeof VIEWS)[number];

/** Activity stays secondary to broadcast controls and uses their existing room connection. */
export function LiveChatPanel({
  state,
  disabled,
  send,
  channel = "attendee",
  studio = false,
  sessionOn,
}: {
  state: LiveChatView;
  /** The session the location is on now, null between sessions; undefined where the view does not know it. */
  sessionOn?: string | null;
  channel?: "attendee" | "operator";
  studio?: boolean;
  disabled: boolean;
  send: Send;
}) {
  if (studio) return <LiveStudioChat state={state} disabled={disabled} send={send} sessionOn={sessionOn} />;
  return (
    <Panel class="pk-live-desk__chat-panel">
      <PanelHeader title={channel === "operator" ? "Operator chat" : "Attendee chat"} />
      <PanelBody>
        <LiveChat state={state} disabled={disabled} send={send} channel={channel} sessionOn={sessionOn} compact />
      </PanelBody>
    </Panel>
  );
}

const REVIEW_FILTERS = ["all", "removed", "classifier", "reported"] as const;
type ReviewFilter = (typeof REVIEW_FILTERS)[number];
const REVIEW_LABELS: Record<ReviewFilter, string> = {
  all: "All",
  removed: "Removed",
  classifier: "Classifier",
  reported: "Reported",
};

/** Attendees no longer see it: the check removed it, or enough people reported it. */
const removedNow = (message: LiveChatMessage) => message.moderation?.held === true;
const REVIEW_MATCH: Record<ReviewFilter, (message: LiveChatMessage) => boolean> = {
  all: () => true,
  removed: removedNow,
  classifier: (message) => message.moderation?.classifier !== undefined,
  reported: (message) => (message.moderation?.reports ?? 0) > 0,
};

/**
 * Messages waiting for a moderator: the ones the check removed or flagged and the ones people reported.
 * Removed ones lead, since their authors wait on a decision; Keep and Hide lead each row's menu.
 */
interface StudioChatProps {
  state: LiveChatView;
  disabled: boolean;
  send: Send;
  sessionOn: string | null | undefined;
}

function LiveChatReview({ state, disabled, send, sessionOn }: StudioChatProps) {
  const [filter, setFilter] = useHashQueryParam("review", "all", REVIEW_FILTERS);
  const queue = state.chatReports ?? [];
  if (!queue.length)
    return (
      <p class="pk-small pk-muted">Nothing to review. Messages the classifier flags or people report appear here.</p>
    );
  const shown = queue.filter(REVIEW_MATCH[filter]).sort((a, b) => Number(removedNow(b)) - Number(removedNow(a)));
  return (
    <LiveAuthorProvider authors={state.authors} send={send}>
      <div class="pk-live-chat-workspace pk-live-chat-workspace--compact">
        <TabList
          label="Show"
          idPrefix="studio-review"
          activeId={filter}
          onSelect={(id) => setFilter(id as ReviewFilter)}
          items={REVIEW_FILTERS.map((id) => {
            const count = queue.filter(REVIEW_MATCH[id]).length;
            return {
              id,
              panelId: "studio-review-list",
              label: id === "all" || !count ? REVIEW_LABELS[id] : `${REVIEW_LABELS[id]} · ${formatNumber(count)}`,
            };
          })}
        />
        <div class="pk-live-chat" tabIndex={0} role="tabpanel" id="studio-review-list" aria-label="Messages to review">
          {shown.length ? (
            <ol class="pk-live-chat__list">
              {shown.map((message) => (
                <LiveChatMessageRow
                  key={message.id}
                  message={message}
                  viewer={state.viewer}
                  send={send}
                  disabled={disabled}
                  timeZone={state.scope.timeZone}
                  sessionOn={sessionOn}
                  review
                />
              ))}
            </ol>
          ) : (
            <p class="pk-small pk-muted">Nothing here.</p>
          )}
        </div>
        {queue.length >= LIVE_CHAT_POLICY.reportQueueLimit ? (
          <p class="pk-small pk-muted">
            Showing the latest {formatNumber(LIVE_CHAT_POLICY.reportQueueLimit)}. Decide on these to see more.
          </p>
        ) : null}
      </div>
    </LiveAuthorProvider>
  );
}

function LiveStudioChat({ state, disabled, send, sessionOn }: StudioChatProps) {
  const [view, setView] = useHashQueryParam("chat", "attendee", VIEWS);
  const known = useRef(new Set(state.chat.map((message) => message.id)));
  const [unread, setUnread] = useState({ attendee: 0, operator: 0 });
  useEffect(() => {
    const incoming = state.chat.filter((message) => !known.current.has(message.id));
    state.chat.forEach((message) => known.current.add(message.id));
    setUnread((current) => {
      const next = { ...current, ...(view === "review" ? {} : { [view]: 0 }) };
      incoming.forEach((message) => {
        if (message.channel !== view) next[message.channel] += 1;
      });
      return next.attendee === current.attendee && next.operator === current.operator ? current : next;
    });
  }, [state.chat, view]);
  const reports = state.chatReports?.length ?? 0;
  const label = (id: View) => (id === "attendee" ? "Attendees" : id === "operator" ? "Operators" : "Review");
  return (
    <div class="pk-live-desk__chat-panel">
      <TabList
        label="Studio chat"
        idPrefix="studio-chat"
        activeId={view}
        onSelect={(id) => setView(id as View)}
        items={VIEWS.map((id) => ({
          id,
          panelId: `studio-chat-panel-${id}`,
          label: (
            <>
              {label(id)}
              {id === "review" ? (
                reports > 0 ? (
                  <Badge tone="warn">{formatNumber(reports)}</Badge>
                ) : null
              ) : unread[id] > 0 ? (
                <Badge tone="accent">New</Badge>
              ) : null}
            </>
          ),
        }))}
      />
      {VIEWS.map((id) => (
        <div
          key={id}
          id={`studio-chat-panel-${id}`}
          role="tabpanel"
          aria-labelledby={`studio-chat-${id}`}
          hidden={view !== id}
          class="pk-live-desk__chat-tabpanel"
        >
          {id === "review" ? (
            <LiveChatReview state={state} disabled={disabled} send={send} sessionOn={sessionOn} />
          ) : (
            <LiveChat
              state={state}
              disabled={disabled}
              send={send}
              channel={id}
              visible={view === id}
              sessionOn={sessionOn}
              compact
            />
          )}
        </div>
      ))}
    </div>
  );
}
