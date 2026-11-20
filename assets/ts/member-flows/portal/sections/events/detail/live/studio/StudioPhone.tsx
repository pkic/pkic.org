import type { ComponentChildren, JSX } from "preact";
import { useCallback, useEffect, useId, useRef, useState } from "preact/hooks";
import { useMediaQuery } from "../../../../../../../hooks/useMediaQuery";
import { useHashQueryParam } from "../../../../../../../hooks/useHashQueryParam";
import type { LiveRoomState } from "../../../../../../../live-session/live-room-state";
import { LiveOverlayPresentation } from "../../../../../../../live-session/LiveOverlayPresentation";
import { APP_ICONS, IconVenueExit, type AppIcon } from "../../../../../../../components/icons/app-navigation";
import { ActionTile, ActionTiles } from "../../../../../../../ui/ActionTile";
import { BottomSheet } from "../../../../../../../ui/BottomSheet";
import { Button } from "../../../../../../../ui/Button";
import { Dialog } from "../../../../../../../ui/Dialog";
import { IconDemo } from "../../../../../../../ui/MediaIcons";
import { Menu } from "../../../../../../../ui/Menu";
import { SectionHeading } from "../../../../../../../ui/SectionHeading";
import { splitHash } from "../../../../../../../ui/url-query";
import { usePressOutside } from "../../../../../../../ui/use-press-outside";
import { AppTabBar, isPlainPress } from "../../../../../shell/AppTabBar";
import type { ClockZone } from "../../../../../../../../shared/event-clock";
import { ClearIcon, ExpandIcon, LayoutIcon, StudioOutputScreen, type MonitorSources } from "./MonitorPanel";
import { previewSceneOf } from "./SceneChoices";
import { ScenePicker, ScenePopover } from "./ScenePicker";
import type { StudioPanelView } from "./StudioGrid";
import { SessionTiming, StudioNotice, type StudioNoticeContent } from "./StudioHeader";
import { liveSceneName } from "../live-layer-unseen";
import { clearHint } from "./StudioSwitcher";
import { STUDIO_PANEL_LABELS, studioOutputDetails, type StudioPanel, type StudioPanelType } from "./studio-layout";
import type { StudioChange } from "./useStudioLayout";
import "../live-tally.css";
import "./StudioPhone.css";

/** The views a phone shows one at a time: the quick actions first, then the panels. */
export const STUDIO_PHONE_VIEWS = [
  "home",
  "speakers",
  "graphics",
  "questions",
  "polls",
  "chat",
  "monitor",
  "screens",
  "time",
  "message",
] as const;
export type StudioPhoneView = (typeof STUDIO_PHONE_VIEWS)[number];
/** One panel as a phone shows it: a whole view, so its place and size on the desk's grid never matter. */
const phonePanel = (type: StudioPanelType): StudioPanel => ({
  id: `phone-${type}`,
  type,
  x: 0,
  y: 0,
  w: 12,
  h: 8,
  // The monitor starts on the two buses an operator switches between.
  ...(type === "monitor" ? { outputs: ["preview", "program"] } : {}),
});

/**
 * The phone's own panels, apart from the arrangement the desk saves: one per
 * view. A choice made in a panel, such as the outputs a monitor shows, lasts
 * while the studio is open.
 */
export function useStudioPhonePanels(): { panel: (type: StudioPanelType) => StudioPanel; change: StudioChange } {
  const [panels, setPanels] = useState<readonly StudioPanel[]>(() =>
    STUDIO_PHONE_VIEWS.flatMap((view) => (view === "home" ? [] : [phonePanel(view)])),
  );
  const panel = useCallback(
    (type: StudioPanelType) => panels.find((each) => each.type === type) ?? phonePanel(type),
    [panels],
  );
  const change = useCallback<StudioChange>((update) => setPanels((current) => update(current)), []);
  return { panel, change };
}

/** The views with a tab of their own; the rest sit behind More, so the bar keeps five tabs. */
const TABBED: readonly StudioPhoneView[] = ["home", "speakers", "graphics", "questions"];
const MORE = STUDIO_PHONE_VIEWS.filter((view) => !TABBED.includes(view));
/**
 * Each view's name and the tab bar's glyph for it. A view behind More may draw its tile with a glyph of its own,
 * where the app's glyph would look like another tile's.
 */
const PHONE_TABS: Record<
  StudioPhoneView,
  { label: string; icon: AppIcon; tile?: (props: JSX.SVGAttributes<SVGSVGElement>) => JSX.Element }
> = {
  home: { label: "Home", icon: "home" },
  speakers: { label: STUDIO_PANEL_LABELS.speakers, icon: "speakers" },
  graphics: { label: STUDIO_PANEL_LABELS.graphics, icon: "graphics" },
  questions: { label: STUDIO_PANEL_LABELS.questions, icon: "questions" },
  polls: { label: STUDIO_PANEL_LABELS.polls, icon: "polls" },
  chat: { label: STUDIO_PANEL_LABELS.chat, icon: "chat" },
  monitor: { label: "Monitors", icon: "monitors" },
  // A screen showing a picture, apart from the monitors an operator watches.
  screens: { label: STUDIO_PANEL_LABELS.screens, icon: "monitors", tile: IconDemo },
  time: { label: STUDIO_PANEL_LABELS.time, icon: "time" },
  message: { label: "Message", icon: "message" },
};

/** The address of one view of this studio, so a tab is a link that also opens in a new tab. */
function viewHref(view: StudioPhoneView): string {
  const { path, params } = splitHash();
  if (view === "home") params.delete("panel");
  else params.set("panel", view);
  const query = params.toString();
  return `#${path}${query ? `?${query}` : ""}`;
}

/** The view a phone shows, which the address holds as `panel`. */
export function useStudioPhoneView(): [StudioPhoneView, (view: StudioPhoneView) => void] {
  return useHashQueryParam("panel", "home", STUDIO_PHONE_VIEWS);
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
 * Preview or Program as the picture, with its tag and its scene's name under
 * it. A tap on the picture shows its tools on the picture itself: Preview's
 * scenes to load another, Clear and Full screen. They hide again on their
 * own.
 */
function Thumbnail({
  label,
  tally,
  sources,
  disabled,
  onClear,
  onScene,
}: {
  label: "Preview" | "Program";
  tally: PhoneOutput;
  sources: MonitorSources;
  disabled: boolean;
  onClear: (output: PhoneOutput) => void;
  onScene: (scene: string) => void;
}) {
  const [enlarged, setEnlarged] = useState(false);
  const [tools, setTools] = useState(false);
  const [scenes, setScenes] = useState(false);
  const closeScenes = useCallback(() => setScenes(false), []);
  const root = useRef<HTMLDivElement>(null);
  usePressOutside(scenes, root, closeScenes);
  const previewScene = previewSceneOf(sources.preview).current.name;
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
            <LiveOverlayPresentation
              view="program"
              projection={projection}
              roomId={sources.roomId}
              eventSlug={sources.slug}
            />
          ) : null}
        </button>
        {tools ? (
          <div id={toolsId} class="pk-studio-phone__thumb-tools">
            {tally === "preview" ? (
              <Button
                icon
                variant="ghost"
                disabled={disabled}
                aria-label={`Scene in Preview: ${previewScene}`}
                title={`Scene in Preview: ${previewScene}\nChoose another to load it into Preview. Transition puts it on Program.`}
                aria-haspopup="dialog"
                onClick={() => {
                  setTools(false);
                  setScenes(true);
                }}
              >
                <LayoutIcon />
              </Button>
            ) : null}
            <Button
              icon
              variant="ghost"
              disabled={disabled}
              aria-label={`Clear ${label}`}
              title={clearHint(tally, label, liveSceneName(sources.preview, null))}
              onClick={() => onClear(tally)}
            >
              <ClearIcon />
            </Button>
            <Button
              icon
              variant="ghost"
              aria-label={`Full screen ${label}`}
              title={`Full screen ${label}\nShow this monitor large.`}
              onClick={() => {
                setTools(false);
                setEnlarged(true);
              }}
            >
              <ExpandIcon />
            </Button>
          </div>
        ) : null}
        <div class="pk-studio-phone__thumb-scene">
          <abbr
            class="pk-studio-phone__thumb-tag"
            title={`${studioOutputDetails([], tally).short} · ${label}\n${studioOutputDetails([], tally).purpose}`}
          >
            {studioOutputDetails([], tally).short}
          </abbr>
          {tally === "preview" ? (
            <span class="pk-studio-monitor__purpose">{previewScene}</span>
          ) : (
            <ScenePicker output={tally} sources={sources} disabled={disabled} onScene={onScene} />
          )}
        </div>
        {scenes && !disabled ? (
          <ScenePopover sources={sources} anchorRef={root} onScene={onScene} onClose={closeScenes} />
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
            {/* The scene the output is in, as its thumbnail draws it. */}
            <StudioOutputScreen output={tally} layout={null} sources={sources} />
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
 * on the quick actions; and the app's tab bar at the thumb, its last tab the
 * More sheet with the views that have no tab of their own, as on an event's
 * pages. The view in sight follows the address.
 */
export function StudioPhone({
  state,
  sources,
  clock,
  active,
  sessionStatus,
  roomControl,
  transition,
  disabled,
  onClear,
  onScene,
  panel,
  home,
  notice,
  eventPath,
}: {
  /** The event's own page, which the More sheet links back to. */
  eventPath?: string;
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
  /** The room takes no changes now: Clear and the scenes wait. */
  disabled: boolean;
  /** Clears one output; Program's clear is the room's undoable one. */
  onClear: (output: PhoneOutput) => void;
  /** Loads a scene into Preview. */
  onScene: (scene: string) => void;
  /** Draws one panel: its title, actions, menu and body. */
  panel: (type: StudioPanelType) => StudioPanelView;
}) {
  const [shown, show] = useStudioPhoneView();
  const view = shown === "home" ? null : panel(shown);
  const sessionTimer = state.timers.find((timer) => timer.kind === "session");
  const [more, setMore] = useState(false);
  const sheetId = `${useId()}-more`;
  const closeMore = useCallback(() => setMore(false), []);
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
            disabled={disabled}
            onClear={onClear}
            onScene={onScene}
          />
          {transition}
          <Thumbnail
            label="Program"
            tally="program"
            sources={sources}
            disabled={disabled}
            onClear={onClear}
            onScene={onScene}
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
                {view.menu?.length ? (
                  <Menu
                    label={`${view.title} panel`}
                    title={`${view.title} panel\nThis panel's settings.`}
                    align="end"
                    items={view.menu}
                  />
                ) : null}
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
      <AppTabBar
        scope="event"
        label="Studio panels"
        items={TABBED.map((type) => ({
          id: type,
          label: PHONE_TABS[type].label,
          icon: PHONE_TABS[type].icon,
          href: viewHref(type),
          onSelect: () => show(type),
        }))}
        activeId={MORE.includes(shown) ? "more" : shown}
        menu={{
          id: "more",
          label: "More",
          icon: "more",
          controls: sheetId,
          expanded: more,
          onOpen: () => setMore(true),
        }}
      />
      <BottomSheet id={sheetId} open={more} title="More" closeLabel="Close more options" onClose={closeMore}>
        {/* Rendered only while open, so the page holds one copy of each view's link. */}
        {more ? (
          <ActionTiles label="More studio panels">
            {MORE.map((type) => {
              const Icon = PHONE_TABS[type].tile ?? APP_ICONS[PHONE_TABS[type].icon];
              return (
                <li key={type}>
                  <ActionTile
                    href={viewHref(type)}
                    aria-current={type === shown ? "page" : undefined}
                    icon={<Icon width="26" height="26" />}
                    label={PHONE_TABS[type].label}
                    onClick={(event: MouseEvent) => {
                      if (isPlainPress(event)) {
                        event.preventDefault();
                        show(type);
                      }
                      closeMore();
                    }}
                  />
                </li>
              );
            })}
            {eventPath ? (
              <li>
                <ActionTile
                  href={`#${eventPath}`}
                  icon={<IconVenueExit width="26" height="26" />}
                  label="Back to the event"
                  onClick={closeMore}
                />
              </li>
            ) : null}
          </ActionTiles>
        ) : null}
      </BottomSheet>
    </div>
  );
}
