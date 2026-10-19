import { useEffect, useRef, useState } from "preact/hooks";
import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
import { TabList } from "../../../../../../ui/TabList";
import { Badge } from "../../../../../../ui/Badge";
import { formatNumber } from "../../../../../../../shared/format-number";
import { LIVE_CHAT_POLICY } from "../../../../../../../shared/live-chat-policy";
import type { LiveRoomClientMessage } from "../../../../../../../shared/schemas/live-session-room";
import type { LiveRoomState } from "../../../../../../live-session/live-room-state";
import { LiveChat } from "../../../../../../live-session/LiveChat";
import { LiveChatMessageRow } from "../../../../../../live-session/LiveChatMessageRow";
import { LiveAuthorProvider } from "../../../../../../live-session/LiveAuthor";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";

type Send = (message: LiveRoomClientMessage) => boolean;
const VIEWS = ["attendee", "operator", "reports"] as const;
type View = (typeof VIEWS)[number];

/** Activity stays secondary to broadcast controls and uses their existing room connection. */
export function LiveChatPanel({
  state,
  disabled,
  send,
  channel = "attendee",
  studio = false,
}: {
  state: LiveRoomState;
  channel?: "attendee" | "operator";
  studio?: boolean;
  disabled: boolean;
  send: Send;
}) {
  if (studio) return <LiveStudioChat state={state} disabled={disabled} send={send} />;
  return (
    <Panel class="pk-live-desk__chat-panel">
      <PanelHeader title={channel === "operator" ? "Operator chat" : "Attendee chat"} />
      <PanelBody>
        <LiveChat state={state} disabled={disabled} send={send} channel={channel} compact />
      </PanelBody>
    </Panel>
  );
}

/** Reported messages waiting for a moderator, newest report first, with the same row and menu as the chat. */
function LiveChatReports({ state, disabled, send }: { state: LiveRoomState; disabled: boolean; send: Send }) {
  const reports = state.chatReports ?? [];
  if (!reports.length)
    return <p class="pk-small pk-muted">No reports. Messages people report appear here for review.</p>;
  return (
    <LiveAuthorProvider authors={state.authors} send={send}>
      <div class="pk-live-chat-workspace pk-live-chat-workspace--compact">
        <div class="pk-live-chat" tabIndex={0} role="region" aria-label="Reported messages">
          <ol class="pk-live-chat__list">
            {reports.map((message) => (
              <LiveChatMessageRow
                key={message.id}
                message={message}
                viewer={state.viewer}
                send={send}
                disabled={disabled}
                timeZone={state.session.timeZone}
              />
            ))}
          </ol>
        </div>
        {reports.length >= LIVE_CHAT_POLICY.reportQueueLimit ? (
          <p class="pk-small pk-muted">
            Showing the latest {formatNumber(LIVE_CHAT_POLICY.reportQueueLimit)} reports. Review these to see more.
          </p>
        ) : null}
      </div>
    </LiveAuthorProvider>
  );
}

function LiveStudioChat({ state, disabled, send }: { state: LiveRoomState; disabled: boolean; send: Send }) {
  const [view, setView] = useHashQueryParam("chat", "attendee", VIEWS);
  const known = useRef(new Set(state.chat.map((message) => message.id)));
  const [unread, setUnread] = useState({ attendee: 0, operator: 0 });
  useEffect(() => {
    const incoming = state.chat.filter((message) => !known.current.has(message.id));
    state.chat.forEach((message) => known.current.add(message.id));
    setUnread((current) => {
      const next = { ...current, ...(view === "reports" ? {} : { [view]: 0 }) };
      incoming.forEach((message) => {
        if (message.channel !== view) next[message.channel] += 1;
      });
      return next.attendee === current.attendee && next.operator === current.operator ? current : next;
    });
  }, [state.chat, view]);
  const reports = state.chatReports?.length ?? 0;
  const label = (id: View) => (id === "attendee" ? "Attendees" : id === "operator" ? "Operators" : "Reports");
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
              {id === "reports" ? (
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
          {id === "reports" ? (
            <LiveChatReports state={state} disabled={disabled} send={send} />
          ) : (
            <LiveChat state={state} disabled={disabled} send={send} channel={id} visible={view === id} compact />
          )}
        </div>
      ))}
    </div>
  );
}
