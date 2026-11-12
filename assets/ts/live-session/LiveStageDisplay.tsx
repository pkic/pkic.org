import type { ComponentChildren } from "preact";
import { formatNumber } from "../../shared/format-number";
import type { LiveStageBanner, LiveStageMain, LiveStageTimer } from "../../shared/live-stage-display-plan";
import type { LiveRoomState } from "./live-room-state";
import { useNumericCssProperties } from "../hooks/useNumericCssProperties";
import { LiveStageContent } from "./LiveStageContent";
import { useLiveStageDisplayPlan, useLiveStageReactions } from "./useLiveStageDisplay";
import "./LiveStageDisplay.css";

/** One timer: its label over its value, sized by its role and fitted to its column by its length. */
function StageTimer({ timer }: { timer: LiveStageTimer }) {
  const geometry = useNumericCssProperties({ "--timer-chars": Math.max(4, [...timer.text].length) });
  return (
    <div class="pk-live-stage-display__timer" data-size={timer.size} data-numeric-css-properties={geometry}>
      {timer.label ? <p class="pk-live-stage-display__label">{timer.label}</p> : null}
      <p class="pk-live-stage-display__countdown" data-tone={timer.tone}>
        {timer.text}
      </p>
    </div>
  );
}

/** The main area: at most two items, side by side with a rule between them. */
function StageMain({ main }: { main: LiveStageMain }) {
  switch (main.kind) {
    case "empty":
      return null;
    case "overtime":
    case "break":
      return <StageTimer timer={main.timer} />;
    case "timers":
      return (
        <>
          {main.timers.map((timer) => (
            <StageTimer key={timer.timerId} timer={timer} />
          ))}
        </>
      );
    case "content":
      return (
        <>
          {main.timer ? <StageTimer timer={main.timer} /> : null}
          <LiveStageContent content={main.content} />
        </>
      );
  }
}

/** The reactions arriving now, in the top row's right end; empty while none arrive. */
function StageReactions({ state, enabled }: { state: LiveRoomState; enabled: boolean }) {
  const reactions = useLiveStageReactions(state.burst, enabled);
  return (
    <p class="pk-live-stage-display__reactions" aria-hidden="true">
      {reactions.map((reaction) => (
        <span key={reaction.id} class="pk-live-stage-display__reaction" title={reaction.label}>
          {reaction.emoji} ×{formatNumber(reaction.count)}
        </span>
      ))}
    </p>
  );
}

/**
 * The speaker-facing stage display: a confidence monitor read from two to
 * five meters, in fixed rows so nothing moves. The brand stripe; a top row
 * with the event's clock and the reactions as they arrive, which the banner
 * covers when there is one (`bannerShown`); the main area; and a footer
 * naming the session live now, or the next one near the end and in breaks.
 * The page that hosts it may add a status at the end of the footer.
 */
export function LiveStageDisplay({
  state,
  roomId,
  aside,
  bannerShown = true,
}: {
  /** The room as it is, not projected onto one output: the display weighs its own composition against Program. */
  state: LiveRoomState;
  roomId?: string;
  aside?: ComponentChildren;
  /** Whether the layout draws the banner over the top row. */
  bannerShown?: boolean;
}) {
  const plan = useLiveStageDisplayPlan(state, roomId);
  const covered = bannerShown && plan.banner !== null;
  const items = plan.main.kind === "timers" ? plan.main.timers.length : plan.main.kind === "content" ? 2 : 1;
  return (
    <div class="pk-live-stage-display" data-main={plan.main.kind} data-items={items}>
      <div class="pk-live-stage-display__stripe" />
      <div class="pk-live-stage-display__top" data-covered={covered ? "" : undefined}>
        <time class="pk-live-stage-display__clock">{plan.clock}</time>
        <StageReactions state={state} enabled={plan.reactions && !covered} />
      </div>
      <div class="pk-live-stage-display__main">
        <StageMain main={plan.main} />
      </div>
      <footer class="pk-live-stage-display__footer">
        <p class="pk-live-stage-display__title">
          <span class="pk-live-stage-display__marker" data-marker={plan.footer.marker}>
            {plan.footer.marker === "live" ? "Live" : "Next"}
          </span>
          {plan.footer.title}
        </p>
        <p class="pk-live-stage-display__speakers">
          <span class="pk-live-stage-display__speaker-names">{plan.footer.speakers}</span>
          {aside ? <span class="pk-live-stage-display__aside">{aside}</span> : null}
        </p>
      </footer>
    </div>
  );
}

/**
 * The banner over the stage display's top row: the operators' message to the
 * speaker, or the display's own near-end cue. A layer of its own, so a
 * layout can place it; it sets large while short and never below the
 * smallest size read from the stage, wrapping to two lines past that.
 */
export function LiveStageDisplayBanner({ state, roomId }: { state: LiveRoomState; roomId?: string }) {
  const { banner } = useLiveStageDisplayPlan(state, roomId);
  return <div class="pk-live-overlay__stage-message">{banner ? <StageBanner banner={banner} /> : null}</div>;
}

function StageBanner({ banner }: { banner: LiveStageBanner }) {
  return (
    <p
      class="pk-live-stage-display__message"
      data-source={banner.source}
      data-fit={banner.fit}
      data-flash={banner.flash ? "" : undefined}
    >
      <span class="pk-live-stage-display__message-text">{banner.text}</span>
    </p>
  );
}
