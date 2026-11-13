/**
 * One screen in the Screens tab's multi-view: what it showed in its latest
 * screenshot and how long ago, where it is and what it is assigned, one line
 * on its connection and anything wrong with it, and its last hour of
 * connection quality. A screen with a warning or a critical issue carries
 * its tone along the card's top edge. Screen managers get its actions in the
 * card's menu.
 */
import type { ComponentChildren } from "preact";
import { screenConnection, screenConnectionDisplay } from "../../../../../../../shared/event-screen-connection";
import { screenHealthDisplay, screenOwnRunHint } from "../../../../../../../shared/event-screen-health";
import {
  screenSoftwareBuild,
  screenSoftwareDetail,
  screenUpdatesDetail,
  type ScreenSoftwareBuild,
} from "../../../../../../../shared/event-screen-software";
import { screenIssueSeverity, type ScreenIssue } from "../../../../../../../shared/event-screen-issues";
import { formatAge } from "../../../../../../../shared/format-date";
import { LIVE_SCREEN_OUTPUT_DETAILS } from "../../../../../../../shared/live-room-outputs";
import type { ScreenLiveStatus, ScreenQualitySample } from "../../../../../../../shared/schemas/event-screen-monitor";
import type { ScreenRecord } from "../../../../../../../shared/schemas/event-screens";
import { Alert } from "../../../../../../ui/Alert";
import { Tooltip } from "../../../../../../ui/Tooltip";
import { CollectionCardFooter, CollectionCardSurface } from "../../../../../../ui/CollectionCard";
import { useSectionHeading } from "../../../../../../ui/HeadingOutline";
import type { ScreenMonitorScreenshot } from "./screen-monitor-view";
import { ScreenQualityTrend } from "./ScreenQualityTrend";
import "./ScreenMonitorCard.css";

type ScreenOwnRunHint = NonNullable<ReturnType<typeof screenOwnRunHint>>;

/** What the screen's device runs, shown on request in its status tooltip. */
interface ScreenDeviceDetails {
  software: ScreenSoftwareBuild | null;
  updates: string | null;
}

/** Where the screen is and what it is assigned: "Blue room · Livestream". */
export function screenPlacement(screen: ScreenRecord): string {
  const assignment = screen.assignment;
  return assignment
    ? `${assignment.roomName} · ${LIVE_SCREEN_OUTPUT_DETAILS[assignment.output].label}`
    : "Not assigned";
}

export type ScreenConditionTone = "ok" | "warning" | "critical" | "neutral";

/**
 * A screen's condition as one line: how it is connected, then its issues
 * (critical first) and what it draws, as plain words. The tone is its worst
 * issue; an offline screen is critical. A screen the monitor has not heard
 * from falls back to its last visit.
 */
export function screenCondition(
  screen: ScreenRecord,
  status: ScreenLiveStatus | undefined,
  issues: readonly ScreenIssue[],
  now: number,
  /** The monitor's last word, while the connection to it is lost: nothing it said counts as now. */
  lostSince: number | null = null,
  /** The monitor watches the event's screens; one it does not know about has no issue it tracks. */
  monitored = true,
): { tone: ScreenConditionTone; text: string; hint?: ScreenOwnRunHint; device?: ScreenDeviceDetails } {
  if (lostSince !== null && status)
    return { tone: "neutral", text: `Status unknown · last update ${formatAge(now - lostSince)}` };
  if (!status) {
    const { label, tone } = screenConnectionDisplay(screenConnection(screen.session, now));
    // While the monitor watches, only its issues carry a tone, so cards, the count and the filter agree.
    if (monitored) return { tone: "neutral", text: label };
    return { tone: tone === "risk" ? "critical" : tone === "warn" ? "warning" : "neutral", text: label };
  }
  const heardAt = status.reportedAt ?? status.disconnectedAt;
  // A browser screen says so where a device says it is online.
  const connection = status.online
    ? status.health?.kind === "browser"
      ? "Browser"
      : "Online"
    : heardAt
      ? `Last heard ${formatAge(now - Date.parse(heardAt))}`
      : "Offline";
  const details = issues.map((issue) => issue.label);
  if (status.online && status.health) {
    const { label } = screenHealthDisplay(status.health);
    // A fallback's issue already says what the badge says, with how long.
    const said = issues.some((issue) => issue.code === "cached-agenda");
    if (!said && !details.includes(label)) details.push(label);
  }
  const severity = screenIssueSeverity(issues);
  // A screen on its own still sends screenshots: say what reaches it and what does not.
  const hint = status.online && status.health ? screenOwnRunHint(status.health) : null;
  const software = screenSoftwareBuild(status.health);
  const updates = screenUpdatesDetail(status.health, now);
  return {
    ...(hint ? { hint } : {}),
    ...(software || updates ? { device: { software, updates } } : {}),
    tone: severity ?? (status.online ? "ok" : "critical"),
    text: details.length
      ? `${connection} · ${details.map((label, index) => (index ? label.charAt(0).toLowerCase() + label.slice(1) : label)).join(", ")}`
      : connection,
  };
}

/** The screen's device shows it now, by the monitor's word or, without one, its last visit. */
export function screenOnline(screen: ScreenRecord, status: ScreenLiveStatus | undefined, now: number): boolean {
  return status ? status.online : screenConnection(screen.session, now).kind === "online";
}

/**
 * A screen that shows nothing now: offline, signed out, or its approval
 * never collected. One waiting for its new sign-in is not, nor one whose
 * state is unknown while the connection to the monitor is lost.
 */
export function screenInactive(
  screen: ScreenRecord,
  status: ScreenLiveStatus | undefined,
  now: number,
  lostSince: number | null,
): boolean {
  if (lostSince !== null || screenOnline(screen, status, now)) return false;
  return status !== undefined || screenConnection(screen.session, now).kind !== "waiting";
}

const TONE_WORDS: Record<ScreenConditionTone, string> = {
  ok: "",
  neutral: "",
  warning: "Warning: ",
  critical: "Critical: ",
};

/**
 * The whole condition line, then what still reaches a screen running on its
 * own, then what its device runs.
 */
function ScreenConditionHelp({
  condition,
  newestSoftware,
}: {
  condition: ReturnType<typeof screenCondition>;
  newestSoftware: string | null;
}) {
  const { hint, device } = condition;
  const software = device?.software ? screenSoftwareDetail(device.software, newestSoftware) : null;
  return (
    <dl class="pk-screen-status-help">
      {/* The whole line first: the card cuts it at two lines. */}
      <dt>Status</dt>
      <dd>{condition.text}</dd>
      {hint && (
        <>
          <dt>Still works</dt>
          <dd>{hint.works}</dd>
          <dt>Not reaching it</dt>
          <dd>{hint.stopped}</dd>
          <dt>Next</dt>
          <dd>{hint.next}</dd>
        </>
      )}
      {software && (
        <>
          <dt>Screen software</dt>
          <dd>{software.text}</dd>
        </>
      )}
      {device?.updates && (
        <>
          <dt>Updates</dt>
          <dd>{device.updates}</dd>
        </>
      )}
    </dl>
  );
}

/**
 * The condition line: a dot in its tone, then the words, cut at two lines
 * with the whole line on hover. When there is more to say (what still
 * reaches a screen running on its own, what its device runs) the words open
 * a tooltip on hover, focus or tap.
 */
export function ScreenConditionLine({
  condition,
  newestSoftware = null,
}: {
  condition: ReturnType<typeof screenCondition>;
  /** The newest build among the event's screens, the reference for an older one. */
  newestSoftware?: string | null;
}) {
  const more = Boolean(condition.hint || condition.device);
  const words = (
    <span class={more ? "pk-screen-condition__text pk-screen-condition__text--hint" : "pk-screen-condition__text"}>
      {TONE_WORDS[condition.tone] && <span class="pk-sr-only">{TONE_WORDS[condition.tone]}</span>}
      {condition.text}
    </span>
  );
  return (
    <p class="pk-screen-condition" data-tone={condition.tone} title={more ? undefined : condition.text}>
      <span class="pk-screen-condition__dot" aria-hidden="true" />
      {more ? (
        <Tooltip
          label={`${TONE_WORDS[condition.tone]}${condition.text}`}
          content={<ScreenConditionHelp condition={condition} newestSoftware={newestSoftware} />}
        >
          {words}
        </Tooltip>
      ) : (
        words
      )}
    </p>
  );
}

/** The latest screenshot, or where one will be; an offline screen's last one is dimmed. */
export function ScreenShot({
  screen,
  screenshot,
  online,
  now,
}: {
  screen: ScreenRecord;
  screenshot: ScreenMonitorScreenshot | undefined;
  online: boolean;
  now: number;
}) {
  return (
    <div class="pk-screen-shot" data-offline={!online || undefined}>
      {screenshot ? (
        <img src={screenshot.src} alt={`What ${screen.name} showed`} width="480" height="270" decoding="async" />
      ) : (
        <span class="pk-screen-shot__none">No screenshot yet</span>
      )}
      {screenshot && <span class="pk-screen-shot__age">{formatAge(now - Date.parse(screenshot.capturedAt))}</span>}
    </div>
  );
}

export function ScreenMonitorCard({
  screen,
  status,
  samples,
  screenshot,
  issues,
  now,
  lostSince = null,
  newestSoftware = null,
  actions,
}: {
  screen: ScreenRecord;
  status: ScreenLiveStatus | undefined;
  issues: readonly ScreenIssue[];
  lostSince?: number | null;
  /** The newest build among the event's screens. */
  newestSoftware?: string | null;
  samples: readonly ScreenQualitySample[];
  screenshot: ScreenMonitorScreenshot | undefined;
  now: number;
  /** The screen's menu, for screen managers only. */
  actions?: ComponentChildren;
}) {
  const Heading = useSectionHeading(3);
  const condition = screenCondition(screen, status, issues, now, lostSince);
  const tone =
    condition.tone === "warning" || condition.tone === "critical" ? `pk-screen-card--${condition.tone}` : undefined;
  const inactive = screenInactive(screen, status, now, lostSince) ? "pk-screen-card--inactive" : undefined;
  return (
    <CollectionCardSurface class={[tone, inactive].filter(Boolean).join(" ") || undefined}>
      <ScreenShot screen={screen} screenshot={screenshot} online={Boolean(status?.online)} now={now} />
      <div class="pk-screen-card__body">
        <Heading class="pk-screen-card__title">{screen.name}</Heading>
        <p class="pk-screen-card__meta">{screenPlacement(screen)}</p>
        <ScreenConditionLine condition={condition} newestSoftware={newestSoftware} />
        <ScreenQualityTrend
          screenName={screen.name}
          samples={samples}
          livestream={screen.assignment?.output === "livestream"}
          now={now}
        />
      </div>
      <CollectionCardFooter fact={screen.id} actions={actions} />
    </CollectionCardSurface>
  );
}

/** Said where the screens are listed while the connection to the monitor is lost. */
export function ScreenMonitorLost({ lostSince, now }: { lostSince: number | null; now: number }) {
  if (lostSince === null) return null;
  return (
    <Alert tone="warn">
      Connection to the screen monitor lost. Reconnecting… Last update {formatAge(now - lostSince)}.
    </Alert>
  );
}
