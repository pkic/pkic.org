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
import { screenHealthDisplay } from "../../../../../../../shared/event-screen-health";
import { screenIssueSeverity, type ScreenIssue } from "../../../../../../../shared/event-screen-issues";
import { formatAge } from "../../../../../../../shared/format-date";
import { LIVE_SCREEN_OUTPUT_DETAILS } from "../../../../../../../shared/live-room-outputs";
import type { ScreenLiveStatus, ScreenQualitySample } from "../../../../../../../shared/schemas/event-screen-monitor";
import type { ScreenRecord } from "../../../../../../../shared/schemas/event-screens";
import { Alert } from "../../../../../../ui/Alert";
import { CollectionCardFooter, CollectionCardSurface } from "../../../../../../ui/CollectionCard";
import { useSectionHeading } from "../../../../../../ui/HeadingOutline";
import type { ScreenMonitorScreenshot } from "./screen-monitor-view";
import { ScreenQualityTrend } from "./ScreenQualityTrend";
import "./ScreenMonitorCard.css";

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
): { tone: ScreenConditionTone; text: string } {
  if (lostSince !== null && status)
    return { tone: "neutral", text: `Status unknown · last update ${formatAge(now - lostSince)}` };
  if (!status) {
    const { label, tone } = screenConnectionDisplay(screenConnection(screen.session, now));
    return { tone: tone === "risk" ? "critical" : tone === "warn" ? "warning" : "neutral", text: label };
  }
  const heardAt = status.reportedAt ?? status.disconnectedAt;
  const connection = status.online
    ? "Online"
    : heardAt
      ? `Last heard ${formatAge(now - Date.parse(heardAt))}`
      : "Offline";
  const details = issues.map((issue) => issue.label);
  if (status.online && status.health) {
    const { label } = screenHealthDisplay(status.health);
    if (!details.includes(label)) details.push(label);
  }
  const severity = screenIssueSeverity(issues);
  return {
    tone: severity ?? (status.online ? "ok" : "critical"),
    text: details.length
      ? `${connection} · ${details.map((label, index) => (index ? label.charAt(0).toLowerCase() + label.slice(1) : label)).join(", ")}`
      : connection,
  };
}

const TONE_WORDS: Record<ScreenConditionTone, string> = {
  ok: "",
  neutral: "",
  warning: "Warning: ",
  critical: "Critical: ",
};

/** The condition line: a dot in its tone, then the words, cut to one line with the whole line on hover. */
export function ScreenConditionLine({ condition }: { condition: ReturnType<typeof screenCondition> }) {
  return (
    <p class="pk-screen-condition" data-tone={condition.tone} title={condition.text}>
      <span class="pk-screen-condition__dot" aria-hidden="true" />
      <span class="pk-screen-condition__text">
        {TONE_WORDS[condition.tone] && <span class="pk-sr-only">{TONE_WORDS[condition.tone]}</span>}
        {condition.text}
      </span>
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
  actions,
}: {
  screen: ScreenRecord;
  status: ScreenLiveStatus | undefined;
  issues: readonly ScreenIssue[];
  lostSince?: number | null;
  samples: readonly ScreenQualitySample[];
  screenshot: ScreenMonitorScreenshot | undefined;
  now: number;
  /** The screen's menu, for screen managers only. */
  actions?: ComponentChildren;
}) {
  const Heading = useSectionHeading(3);
  const condition = screenCondition(screen, status, issues, now, lostSince);
  return (
    <CollectionCardSurface
      class={
        condition.tone === "warning" || condition.tone === "critical" ? `pk-screen-card--${condition.tone}` : undefined
      }
    >
      <ScreenShot screen={screen} screenshot={screenshot} online={Boolean(status?.online)} now={now} />
      <div class="pk-screen-card__body">
        <Heading class="pk-screen-card__title">{screen.name}</Heading>
        <p class="pk-screen-card__meta">{screenPlacement(screen)}</p>
        <ScreenConditionLine condition={condition} />
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
