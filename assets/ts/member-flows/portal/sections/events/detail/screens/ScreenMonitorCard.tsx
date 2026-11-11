/**
 * One screen in the Screens tab's multi-view: what it showed in its latest
 * screenshot and how long ago, where it is and what it is assigned, whether
 * it is online and anything wrong with it, and its last hour of connection
 * quality. Screen managers get its actions in the card's menu.
 */
import type { ComponentChildren } from "preact";
import { screenConnection, screenConnectionDisplay } from "../../../../../../../shared/event-screen-connection";
import { screenHealthDisplay } from "../../../../../../../shared/event-screen-health";
import { formatAge } from "../../../../../../../shared/format-date";
import { LIVE_SCREEN_OUTPUT_DETAILS } from "../../../../../../../shared/live-room-outputs";
import type { ScreenLiveStatus, ScreenQualitySample } from "../../../../../../../shared/schemas/event-screen-monitor";
import type { ScreenRecord } from "../../../../../../../shared/schemas/event-screens";
import {
  CollectionCardFooter,
  CollectionCardSurface,
  CollectionStatusLine,
  type CollectionStatus,
} from "../../../../../../ui/CollectionCard";
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

/** Online from its open connection, else from its last visit; then what it draws, when that needs a word. */
export function screenStatusItems(
  screen: ScreenRecord,
  status: ScreenLiveStatus | undefined,
  now: number,
): CollectionStatus[] {
  if (!status?.online) {
    const { label, tone } = screenConnectionDisplay(screenConnection(screen.session, now));
    return [{ label, tone: tone ?? undefined }];
  }
  const items: CollectionStatus[] = [{ label: "Online" }];
  if (status.health) {
    const { label, tone } = screenHealthDisplay(status.health);
    items.push({ label, tone: tone ?? undefined });
  }
  return items;
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
  now,
  actions,
}: {
  screen: ScreenRecord;
  status: ScreenLiveStatus | undefined;
  samples: readonly ScreenQualitySample[];
  screenshot: ScreenMonitorScreenshot | undefined;
  now: number;
  /** The screen's menu, for screen managers only. */
  actions?: ComponentChildren;
}) {
  const Heading = useSectionHeading(3);
  return (
    <CollectionCardSurface>
      <ScreenShot screen={screen} screenshot={screenshot} online={Boolean(status?.online)} now={now} />
      <div class="pk-screen-card__body">
        <Heading class="pk-screen-card__title">{screen.name}</Heading>
        <p class="pk-screen-card__meta">{screenPlacement(screen)}</p>
        <div class="pk-screen-card__status" role="group" aria-label="Screen status">
          <CollectionStatusLine items={screenStatusItems(screen, status, now)} />
        </div>
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
