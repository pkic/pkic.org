import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ClockZone } from "../../../../../../../shared/event-clock";
import { liveCompositionInput } from "../../../../../../../shared/live-room-preview";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { EMPTY_LIVE_STAGE, type LiveRoomClientMessage } from "../../../../../../../shared/schemas/live-session-room";
import { formatNumber } from "../../../../../../../shared/format-number";
import { useBoundaryClock } from "../../../../../../hooks/useBoundaryClock";
import { liveRoomOpenFailure } from "../../../../../../live-session/live-room-copy";
import type { LiveRoomState } from "../../../../../../live-session/live-room-state";
import { useLiveRoom, type LiveSocketFactory } from "../../../../../../live-session/useLiveRoom";
import { Spinner } from "../../../../../../components/Spinner";
import { Alert } from "../../../../../../ui/Alert";
import { LiveChatPanel } from "./LiveChatPanel";

import { LivePollsCreateAction, LivePollsPanel } from "./LivePollsPanel";
import { LiveQuestionsPanel, openLiveQuestions } from "./LiveQuestionsPanel";
import { LiveLowerThirdSettings } from "./LiveLowerThirdSettings";
import { LiveAddPersonAction, LiveSpeakerCards } from "./LiveSpeakerCards";
import type { LiveTargets } from "./live-output-targets";
import { createLivePresence, livePresenceFocusAt, LivePresenceContext } from "./presence/live-presence";
import { LivePanelPresence } from "./presence/LivePresenceTag";
import { GraphicsPanel, nextInRoom } from "./studio/GraphicsPanel";
import { monitorPanelView } from "./studio/MonitorPanel";
import { SourcesPanel } from "./studio/SourcesPanel";
import { SpeakerMessagePanel } from "./studio/SpeakerMessagePanel";
import { StudioGrid, type StudioPanelView } from "./studio/StudioGrid";
import { StudioHeader, type StudioNoticeContent } from "./studio/StudioHeader";
import { StudioToolbar } from "./studio/StudioToolbar";
import { LiveAddTimerAction, TimePanel } from "./studio/TimePanel";
import {
  STUDIO_PANEL_LABELS,
  setStudioPanelLabeled,
  type StudioOutput,
  type StudioPanel,
} from "./studio/studio-layout";
import { StudioPhone, useStudioPhone } from "./studio/StudioPhone";
import { StudioPhoneHome } from "./studio/StudioPhoneHome";
import { useStudioFullscreen } from "./studio/useStudioFullscreen";
import { ProgramUndoToast, TransitionControl, useTakeShortcut } from "./studio/StudioSwitcher";
import { Dialog } from "../../../../../../ui/Dialog";
import { useStudioLayout } from "./studio/useStudioLayout";
import "./LiveSessionDesk.css";

/** Commands that change what the room puts on air, which first make this session the room's program. */
function changesBroadcast(message: LiveRoomClientMessage): boolean {
  return (
    message.type.startsWith("stage.") ||
    message.type === "preview.take" ||
    message.type === "program.clear" ||
    message.type === "program.restore" ||
    message.type === "aux.set" ||
    message.type === "speaker.message"
  );
}

/** The room as the shared Preview shows it; the room has already resolved its agenda-driven graphics. */
function previewProjection(state: LiveRoomState): LiveRoomState {
  return { ...state, stage: state.preview };
}

/**
 * The live control room for one session: a header with the Take, then the
 * operator's own arrangement of monitors and controls. Every operator of the
 * session shares Preview, Program and the room's other outputs, and sees
 * which control each of the others is on.
 */
export function LiveSessionDesk({
  slug,
  occurrenceId,
  createSocket,
  roomId = "",
  activeOccurrenceId,
  broadcast,
  sessionStatus,
  roomControl,
  clock,
  approvedAgenda,
  agendaNotice = null,
}: {
  /** How the session stands against the agenda, or why the desk could not act, for the session bar. */
  agendaNotice?: StudioNoticeContent | null;
  slug: string;
  occurrenceId: string;
  createSocket?: LiveSocketFactory;
  roomId?: string;
  activeOccurrenceId?: string | null;
  broadcast?: (message: LiveRoomClientMessage, send: () => boolean) => Promise<boolean>;
  /** Whether this session is on air, or the control that puts it there. */
  sessionStatus?: ComponentChildren;
  /** The room and session picker. */
  roomControl?: ComponentChildren;
  /** The event's clock; the session's own zone when the event's is not known. */
  clock?: ClockZone;
  approvedAgenda?: AgendaSnapshot;
}) {
  const sendPresence = useRef<(message: LiveRoomClientMessage) => boolean>(() => false);
  const presence = useMemo(() => createLivePresence((message) => sendPresence.current(message)), []);
  useEffect(() => () => presence.dispose(), [presence]);
  const room = useLiveRoom({ slug, occurrenceId, createSocket, onPresence: presence.receive });
  sendPresence.current = room.send;
  const otherProgram = Boolean(activeOccurrenceId && activeOccurrenceId !== occurrenceId);
  const onAir = useLiveRoom({
    slug,
    occurrenceId: activeOccurrenceId ?? occurrenceId,
    enabled: otherProgram,
    createSocket,
  });
  const live = room.status === "live";
  const now = useBoundaryClock(useCallback((at: number) => at + 30000, []));
  const layout = useStudioLayout();
  const fullscreen = useStudioFullscreen();
  const [broadcasting, setBroadcasting] = useState(false);
  const [lowerThirdSettings, setLowerThirdSettings] = useState(false);
  const runningBroadcast = useRef(false);
  const state = room.state;
  // Where the others were is unknown after a reconnect; they appear again as they move.
  useEffect(() => {
    if (!live) presence.clear();
  }, [live, presence]);

  /** Sends a command; the other operators briefly see who changed the control it came from. */
  const sendProgram = (message: LiveRoomClientMessage): boolean => {
    const sent = sendToRoom(message);
    if (sent && message.type !== "chat.send") presence.changed();
    return sent;
  };
  const sendToRoom = (message: LiveRoomClientMessage): boolean => {
    if (!changesBroadcast(message) || !broadcast) return room.send(message);
    if (runningBroadcast.current || !live) return false;
    runningBroadcast.current = true;
    setBroadcasting(true);
    void broadcast(message, () => room.send(message)).finally(() => {
      runningBroadcast.current = false;
      setBroadcasting(false);
    });
    return true;
  };
  useTakeShortcut(() => sendProgram({ type: "preview.take" }), live && !broadcasting);
  const phone = useStudioPhone();
  if (!state)
    return room.admissionRefusal ? (
      <Alert tone="danger">{liveRoomOpenFailure(room.admissionRefusal, "operator")}</Alert>
    ) : room.status === "offline" ? (
      <Alert tone="warn">{liveRoomOpenFailure(null, "operator")}</Alert>
    ) : (
      <Spinner label="Joining the live room…" />
    );
  const programActive = activeOccurrenceId === occurrenceId;
  const disabled = !live || broadcasting;
  const targets: LiveTargets = { state, programActive, disabled, sendProgram };
  const take = () => sendProgram({ type: "preview.take" });
  const agenda = approvedAgenda ?? null;
  const preview = previewProjection(state);
  const transition = <TransitionControl disabled={disabled} transitioning={broadcasting} onTransition={take} />;
  const clearProgram = () => sendProgram({ type: "program.clear" });
  const empty = liveCompositionInput(EMPTY_LIVE_STAGE);
  const switcher = {
    // Program's clear is the room's one undoable clear; Preview and the screens are set empty.
    clear: (output: StudioOutput) =>
      output === "program"
        ? clearProgram()
        : output === "preview"
          ? sendProgram({ type: "preview.set", composition: empty })
          : output === "livestream"
            ? undefined
            : sendProgram({ type: "aux.set", output, composition: empty }),
    disabled,
  };
  const sources = {
    preview,
    program: programActive ? state : otherProgram && onAir.status === "live" ? onAir.state : null,
    slug,
    roomId,
    startAt: state.session.startAt,
  };
  /** Each panel's view, with the other operators working in it named in its header. */
  const render = (panel: StudioPanel): StudioPanelView => {
    const view = renderPanel(panel);
    return {
      ...view,
      actions: (
        <>
          <LivePanelPresence panel={panel.type} />
          {view.actions}
        </>
      ),
    };
  };
  const renderPanel = (panel: StudioPanel): StudioPanelView => {
    const title = STUDIO_PANEL_LABELS[panel.type];
    switch (panel.type) {
      case "monitor":
        return monitorPanelView(panel, sources, layout.change, switcher);
      case "transition":
        // A small panel holding only the button; its name truncates in a narrow header, and the button can say it too.
        return {
          title,
          menu: [
            {
              id: "label",
              label: panel.labeled ? "Hide label" : "Show label",
              onSelect: () => layout.change((panels) => setStudioPanelLabeled(panels, panel.id, !panel.labeled)),
            },
          ],
          body: (
            <TransitionControl
              disabled={disabled}
              transitioning={broadcasting}
              labeled={panel.labeled}
              onTransition={take}
            />
          ),
        };
      case "speakers":
        return {
          title,
          actions: <LiveAddPersonAction targets={targets} slug={slug} />,
          menu: [
            {
              id: "lower-third",
              label: "Lower third settings",
              disabled,
              onSelect: () => setLowerThirdSettings(true),
            },
          ],
          body: (
            <>
              <LiveSpeakerCards targets={targets} />
              {lowerThirdSettings ? (
                <LiveLowerThirdSettings targets={targets} onClose={() => setLowerThirdSettings(false)} />
              ) : null}
            </>
          ),
        };
      case "graphics":
        return {
          title,
          body: (
            <GraphicsPanel
              targets={targets}
              slug={slug}
              approvedAgenda={agenda}
              occurrenceId={occurrenceId}
              roomId={roomId}
              now={now}
            />
          ),
        };
      case "questions":
        return {
          title,
          actions: (
            <span class="pk-studio-panel__meta">{formatNumber(openLiveQuestions(state.questions).length)} open</span>
          ),
          body: <LiveQuestionsPanel targets={targets} send={sendProgram} />,
        };
      case "time":
        return {
          title,
          actions: (
            <LiveAddTimerAction
              state={state}
              clock={clock ?? state.session.timeZone}
              send={sendProgram}
              disabled={disabled}
            />
          ),
          body: (
            <TimePanel
              targets={targets}
              state={state}
              clock={clock ?? state.session.timeZone}
              send={sendProgram}
              disabled={disabled}
              next={nextInRoom(agenda, occurrenceId, roomId, now)}
            />
          ),
        };
      case "message":
        return {
          title,
          body: <SpeakerMessagePanel message={state.speakerMessage} send={sendProgram} disabled={disabled} />,
        };
      case "polls":
        return {
          title,
          actions: <LivePollsCreateAction disabled={disabled} send={sendProgram} />,
          body: <LivePollsPanel targets={targets} send={sendProgram} />,
        };
      case "chat":
        return { title, body: <LiveChatPanel studio state={state} disabled={!live} send={sendProgram} /> };
      case "sources":
        return { title, body: <SourcesPanel slug={slug} roomId={roomId} layouts={state.overlayLayouts} /> };
    }
  };
  // Room status lives in the session bar's one status line; nothing is inserted above the panels.
  const notice: StudioNoticeContent | null = state.refusal
    ? { tone: "danger", text: state.refusal.message }
    : !live
      ? { tone: "warn", text: "Reconnecting to the live room. Controls are paused until it is back." }
      : agendaNotice;
  const reportFocus = (event: Event) => presence.focus(livePresenceFocusAt(event.target as Element | null));
  return (
    <LivePresenceContext.Provider value={presence}>
      <div
        class="pk-studio"
        data-phone={phone ? "" : undefined}
        data-expanded={fullscreen.expanded ? "true" : undefined}
        onPointerOver={reportFocus}
        onFocusIn={reportFocus}
        onPointerLeave={() => presence.focus(livePresenceFocusAt(document.activeElement))}
        onFocusOut={(event) => {
          if (!event.relatedTarget) presence.focus(null);
        }}
      >
        {phone ? (
          <StudioPhone
            state={state}
            sources={sources}
            clock={clock ?? state.session.timeZone}
            active={programActive}
            sessionStatus={sessionStatus}
            roomControl={roomControl}
            transition={transition}
            clearDisabled={disabled}
            onClear={switcher.clear}
            notice={notice}
            home={<StudioPhoneHome targets={targets} send={sendProgram} />}
            panel={(type) =>
              render({
                id: `phone-${type}`,
                type,
                x: 0,
                y: 0,
                w: 12,
                h: 8,
                ...(type === "monitor" ? { outputs: ["preview", "program"] as StudioOutput[] } : {}),
              })
            }
          />
        ) : null}
        <div class="pk-panel pk-studio__bar" hidden={phone}>
          <StudioHeader
            state={state}
            clock={clock ?? state.session.timeZone}
            roomControl={roomControl}
            sessionStatus={sessionStatus}
            active={programActive}
            notice={notice}
          />
          <StudioToolbar
            workspace={layout.workspace}
            selectWorkspace={layout.selectWorkspace}
            panels={layout.panels}
            change={layout.change}
            reset={layout.reset}
            expanded={fullscreen.expanded}
            toggleExpanded={fullscreen.toggle}
          />
        </div>
        {phone ? null : (
          <StudioGrid workspace={layout.workspace} panels={layout.panels} change={layout.change} render={render} />
        )}
        <ProgramUndoToast
          undo={state.programUndo}
          onUndo={(snapshotId) => sendProgram({ type: "program.restore", snapshotId })}
        />
        {fullscreen.confirmingExit ? (
          <Dialog
            open
            title="Leave full screen?"
            description="The studio goes back into the portal page. Nothing on air changes."
            confirmLabel="Leave full screen"
            cancelLabel="Stay in full screen"
            onConfirm={fullscreen.confirmExit}
            onCancel={fullscreen.stay}
          />
        ) : null}
      </div>
    </LivePresenceContext.Provider>
  );
}
