import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { useMediaQuery } from "../../../../../../../hooks/useMediaQuery";
import { useHashQueryParam } from "../../../../../../../hooks/useHashQueryParam";
import type { LiveRoomState } from "../../../../../../../live-session/live-room-state";
import { LiveOverlayPresentation } from "../../../../../../../live-session/LiveOverlayPresentation";
import { APP_ICONS, type AppIcon } from "../../../../../../../components/icons/app-navigation";
import { Button } from "../../../../../../../ui/Button";
import { Dialog } from "../../../../../../../ui/Dialog";
import { Menu } from "../../../../../../../ui/Menu";
import { SectionHeading } from "../../../../../../../ui/SectionHeading";
import type { ClockZone } from "../../../../../../../../shared/event-clock";
import { LIVE_OVERLAY_DEFAULT_LAYOUT } from "../../../../../../../../shared/schemas/live-overlay-layout";
import { ClearIcon, ExpandIcon, StudioOutputScreen, type MonitorSources } from "./MonitorPanel";
import type { StudioPanelView } from "./StudioGrid";
import { SessionTiming, StudioNotice, type StudioNoticeContent } from "./StudioHeader";
import { STUDIO_OUTPUT_DETAILS, STUDIO_PANEL_LABELS, type StudioPanelType } from "./studio-layout";
import "./StudioPhone.css";

/** The views a phone shows one at a time: the quick actions first, then the panels. */
export const STUDIO_PHONE_VIEWS = ["home", "speakers", "graphics", "questions", "monitor", "time", "message"] as const;
export type StudioPhoneView = (typeof STUDIO_PHONE_VIEWS)[number];
/** The views with a tab of their own; the rest sit behind More, so the bar keeps five tabs. */
const TABBED: readonly StudioPhoneView[] = ["home", "speakers", "graphics", "questions"];
const MORE = STUDIO_PHONE_VIEWS.filter((view) => !TABBED.includes(view));
const PHONE_TABS: Record<StudioPhoneView, { label: string; icon: AppIcon }> = {
  home: { label: "Home", icon: "home" },
  speakers: { label: STUDIO_PANEL_LABELS.speakers, icon: "speakers" },
  graphics: { label: STUDIO_PANEL_LABELS.graphics, icon: "graphics" },
  questions: { label: STUDIO_PANEL_LABELS.questions, icon: "questions" },
  monitor: { label: "Monitors", icon: "monitors" },
  time: { label: STUDIO_PANEL_LABELS.time, icon: "time" },
  message: { label: "Message", icon: "message" },
};

/** A tab's glyph over its short label; the label is the tab's name. */
function TabFace({ icon, label }: { icon: AppIcon; label: string }) {
  const Icon = APP_ICONS[icon];
  return (
    <>
      <Icon class="pk-studio-phone__tab-icon" width="22" height="22" />
      <span>{label}</span>
    </>
  );
}

/** Below this viewport width the studio is the one-handed phone layout. */
const PHONE_QUERY = "(max-width: 599px)";

/** Whether the studio runs as the phone layout; it follows the window as it turns or resizes. */
export function useStudioPhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}

/** How long a monitor's tools stay after a tap, unless a tap elsewhere hides them first. */
const THUMB_TOOLS_MS = 4000;

type PhoneOutput = "preview" | "program";

/**
 * Preview or Program as the picture alone. A tap shows the output's tag, Clear
 * and Full screen on the picture itself; they hide again on their own.
 */
function Thumbnail({
  label,
  tally,
  sources,
  clearDisabled,
  onClear,
}: {
  label: "Preview" | "Program";
  tally: PhoneOutput;
  sources: MonitorSources;
  clearDisabled: boolean;
  onClear: (output: PhoneOutput) => void;
}) {
  const [enlarged, setEnlarged] = useState(false);
  const [tools, setTools] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toolsId = useId();
  const projection = tally === "preview" ? sources.preview : sources.program;
  useEffect(() => {
    if (!tools) return;
    const hide = window.setTimeout(() => setTools(false), THUMB_TOOLS_MS);
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setTools(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      window.clearTimeout(hide);
      document.removeEventListener("pointerdown", outside);
    };
  }, [tools]);
  return (
    <>
      <div ref={root} class="pk-studio-phone__thumb" data-tally={tally}>
        <button
          type="button"
          class="pk-studio-phone__thumb-screen"
          aria-label={label}
          aria-expanded={tools}
          aria-controls={tools ? toolsId : undefined}
          onClick={() => setTools(!tools)}
        >
          {projection ? (
            <LiveOverlayPresentation view="program" projection={projection} roomId={sources.roomId} />
          ) : null}
        </button>
        {tools ? (
          <div id={toolsId} class="pk-studio-phone__thumb-tools">
            <abbr class="pk-studio-phone__thumb-tag" title={label}>
              {STUDIO_OUTPUT_DETAILS[tally].short}
            </abbr>
            <Button
              icon
              variant="ghost"
              disabled={clearDisabled}
              aria-label={`Clear ${label}`}
              title={
                tally === "program"
                  ? "Remove every graphic. You can undo it for a few seconds."
                  : "Remove every graphic"
              }
              onClick={() => onClear(tally)}
            >
              <ClearIcon />
            </Button>
            <Button
              icon
              variant="ghost"
              aria-label={`Full screen ${label}`}
              title="Full screen"
              onClick={() => {
                setTools(false);
                setEnlarged(true);
              }}
            >
              <ExpandIcon />
            </Button>
          </div>
        ) : null}
      </div>
      {enlarged ? (
        <Dialog
          open
          viewer
          class="pk-studio-monitor__viewer"
          title={label}
          closeLabel={`Close ${label}`}
          confirmLabel="Close"
          onConfirm={() => setEnlarged(false)}
          onCancel={() => setEnlarged(false)}
        >
          <div class="pk-studio-monitor__screen" data-tally={tally}>
            <StudioOutputScreen output={tally} layout={LIVE_OVERLAY_DEFAULT_LAYOUT} sources={sources} />
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

/**
 * The control room on a phone, run with one hand: a compact header that
 * stays put with the room, the session and its time on one row, then Preview,
 * the Transition and Program as pictures; one view at a time below, opening
 * on the quick actions; and a tab bar at the thumb, its last tab a menu of the
 * views without a tab of their own. The view in sight follows the address.
 */
export function StudioPhone({
  state,
  sources,
  clock,
  active,
  sessionStatus,
  roomControl,
  transition,
  clearDisabled,
  onClear,
  panel,
  home,
  notice,
}: {
  /** The quick actions of the first tab. */
  home: ComponentChildren;
  /** The room's status line, if anything needs saying. */
  notice: StudioNoticeContent | null;
  state: LiveRoomState;
  sources: MonitorSources;
  clock: ClockZone;
  active: boolean;
  sessionStatus?: ComponentChildren;
  roomControl?: ComponentChildren;
  /** The switcher's Transition, on the Preview thumbnail's edge beside Program. */
  transition: ComponentChildren;
  clearDisabled: boolean;
  /** Clears one output; Program's clear is the room's undoable one. */
  onClear: (output: PhoneOutput) => void;
  /** Draws one panel: its title, actions, menu and body. */
  panel: (type: StudioPanelType) => StudioPanelView;
}) {
  const [shown, show] = useHashQueryParam("panel", "home", STUDIO_PHONE_VIEWS);
  const view = shown === "home" ? null : panel(shown);
  const sessionTimer = state.timers.find((timer) => timer.kind === "session");
  return (
    <div class="pk-studio-phone">
      <header class="pk-studio-phone__bar">
        <div class="pk-studio-phone__session">
          {roomControl}
          <strong class="pk-studio-phone__title" title={state.session.title}>
            {state.session.title}
          </strong>
          <SessionTiming session={state.session} timer={sessionTimer} active={active} clock={clock} />
          {sessionStatus}
          <StudioNotice notice={notice} />
        </div>
        <div class="pk-studio-phone__switcher">
          <Thumbnail
            label="Preview"
            tally="preview"
            sources={sources}
            clearDisabled={clearDisabled}
            onClear={onClear}
          />
          {transition}
          <Thumbnail
            label="Program"
            tally="program"
            sources={sources}
            clearDisabled={clearDisabled}
            onClear={onClear}
          />
        </div>
      </header>
      {view ? (
        <section class="pk-studio-phone__panel" aria-label={view.title}>
          <div class="pk-studio-phone__panel-head">
            {view.heading ?? (
              <SectionHeading level={2} class="pk-studio-phone__panel-title">
                {view.title}
              </SectionHeading>
            )}
            {view.actions || view.menu?.length ? (
              <span class="pk-studio-phone__panel-actions">
                {view.menu?.length ? <Menu label={`${view.title} panel`} align="end" items={view.menu} /> : null}
                {view.actions}
              </span>
            ) : null}
          </div>
          <div class="pk-studio-phone__panel-body">{view.body}</div>
        </section>
      ) : (
        <section class="pk-studio-phone__panel" aria-label="Quick actions">
          {home}
        </section>
      )}
      {/* The studio's own bottom bar: the app's tab bar steps aside for it (AppTabBar.css). */}
      <nav class="pk-studio-phone__tabs" aria-label="Studio panels" data-app-bottom-bar="">
        {TABBED.map((type) => (
          <button
            key={type}
            type="button"
            class="pk-studio-phone__tab"
            aria-current={type === shown ? "page" : undefined}
            onClick={() => show(type)}
          >
            <TabFace {...PHONE_TABS[type]} />
          </button>
        ))}
        <Menu
          variant="plain"
          label={MORE.includes(shown) ? `More, showing ${PHONE_TABS[shown].label}` : "More"}
          triggerClass={`pk-studio-phone__tab${MORE.includes(shown) ? " pk-studio-phone__tab--current" : ""}`}
          align="end"
          items={MORE.map((type) => ({
            id: type,
            label: PHONE_TABS[type].label,
            checked: type === shown,
            onSelect: () => show(type),
          }))}
        >
          <TabFace icon="more" label="More" />
        </Menu>
      </nav>
    </div>
  );
}
