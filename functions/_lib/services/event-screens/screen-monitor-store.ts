import { SCREEN_POLICY } from "../../../../assets/shared/event-screen-policy";
import { screenHealthState } from "../../../../assets/shared/event-screen-health";
import { addScreenQualityReading, screenQualityReading } from "../../../../assets/shared/event-screen-quality";
import {
  SCREEN_MONITOR_LIMITS,
  screenLiveStatusSchema,
  screenQualitySampleSchema,
  type ScreenHealth,
  type ScreenLiveStatus,
  type ScreenQualityHistory,
  type ScreenQualitySample,
} from "../../../../assets/shared/schemas/event-screen-monitor";

const STATUS = "status:";
const QUALITY = "quality:";
const SHOT = "shot:";
const KEEP_MS = SCREEN_POLICY.monitorKeepDays * 24 * 60 * 60 * 1000;
/** A screen's clock and the monitor's differ a little; a screenshot this early still counts as on time. */
const SHOT_GAP_MS = (SCREEN_POLICY.screenshotMinGapSeconds - 1) * 1000;

export interface StoredScreenshot {
  capturedAt: string;
  jpeg: Uint8Array;
}

function samples(value: unknown): ScreenQualitySample[] {
  const parsed = screenQualitySampleSchema.array().max(SCREEN_MONITOR_LIMITS.qualityMinutes).safeParse(value);
  return parsed.success ? parsed.data : [];
}

function screenshot(value: unknown): StoredScreenshot | null {
  if (value === null || typeof value !== "object") return null;
  const { capturedAt, jpeg } = value as Partial<StoredScreenshot>;
  return typeof capturedAt === "string" && jpeg instanceof Uint8Array ? { capturedAt, jpeg } : null;
}

/**
 * Each screen's last known status, its last hour of quality samples and its
 * latest screenshot, in the monitor's own storage: written on every report,
 * connection change and screenshot, never in D1. A screen that stays
 * disconnected is forgotten after the keep window, all three together.
 */
export class ScreenMonitorStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  async all(): Promise<ScreenLiveStatus[]> {
    const stored = await this.storage.list<unknown>({ prefix: STATUS, limit: SCREEN_MONITOR_LIMITS.screensPerEvent });
    return [...stored.values()].flatMap((value) => {
      const parsed = screenLiveStatusSchema.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    });
  }

  get(screenId: string): Promise<ScreenLiveStatus | undefined> {
    return this.storage.get<ScreenLiveStatus>(STATUS + screenId);
  }

  async quality(): Promise<ScreenQualityHistory[]> {
    const stored = await this.storage.list<unknown>({ prefix: QUALITY, limit: SCREEN_MONITOR_LIMITS.screensPerEvent });
    return [...stored.entries()].flatMap(([key, value]) => {
      const kept = samples(value);
      return kept.length ? [{ screenId: key.slice(QUALITY.length), samples: kept }] : [];
    });
  }

  async screenshots(): Promise<(StoredScreenshot & { screenId: string })[]> {
    const stored = await this.storage.list<unknown>({ prefix: SHOT, limit: SCREEN_MONITOR_LIMITS.screensPerEvent });
    return [...stored.entries()].flatMap(([key, value]) => {
      const shot = screenshot(value);
      return shot ? [{ screenId: key.slice(SHOT.length), ...shot }] : [];
    });
  }

  /** Room for one more screen: it is known already, or the event is under its limit. */
  async admits(screenId: string): Promise<boolean> {
    if (await this.get(screenId)) return true;
    const stored = await this.storage.list({ prefix: STATUS, limit: SCREEN_MONITOR_LIMITS.screensPerEvent });
    return stored.size < SCREEN_MONITOR_LIMITS.screensPerEvent;
  }

  private async put(status: ScreenLiveStatus): Promise<ScreenLiveStatus> {
    const parsed = screenLiveStatusSchema.parse(status);
    await this.storage.put(STATUS + parsed.screenId, parsed);
    return parsed;
  }

  async connected(screenId: string, at: string): Promise<ScreenLiveStatus> {
    const previous = await this.get(screenId);
    return this.put({
      screenId,
      online: true,
      connectedAt: at,
      disconnectedAt: null,
      reportedAt: previous?.reportedAt ?? null,
      stateSince: previous?.stateSince ?? null,
      health: previous?.health ?? null,
    });
  }

  /** The report becomes the screen's status and is folded into its minute, in one write. */
  async reported(
    screenId: string,
    health: ScreenHealth,
    at: string,
  ): Promise<{ status: ScreenLiveStatus; sample: ScreenQualitySample }> {
    const [previous, history] = await Promise.all([this.get(screenId), this.storage.get<unknown>(QUALITY + screenId)]);
    const status = screenLiveStatusSchema.parse({
      screenId,
      online: true,
      connectedAt: previous?.connectedAt ?? at,
      disconnectedAt: null,
      reportedAt: at,
      stateSince:
        previous?.health && previous.stateSince && screenHealthState(previous.health) === screenHealthState(health)
          ? previous.stateSince
          : at,
      health,
    });
    const quality = addScreenQualityReading(samples(history), screenQualityReading(health), Date.parse(at));
    await this.storage.put<unknown>({ [STATUS + screenId]: status, [QUALITY + screenId]: quality.samples });
    return { status, sample: quality.sample };
  }

  /**
   * Keeps the screen's latest screenshot in place of the one before. Null
   * when the screen sends faster than its device takes a new one.
   */
  async screenshot(screenId: string, jpeg: Uint8Array, at: string): Promise<StoredScreenshot | null> {
    const previous = screenshot(await this.storage.get<unknown>(SHOT + screenId));
    if (previous && Date.parse(at) - Date.parse(previous.capturedAt) < SHOT_GAP_MS) return null;
    const stored = { capturedAt: at, jpeg };
    await this.storage.put(SHOT + screenId, stored);
    return stored;
  }

  async disconnected(screenId: string, at: string): Promise<ScreenLiveStatus | null> {
    const previous = await this.get(screenId);
    if (!previous) return null;
    return this.put({ ...previous, online: false, disconnectedAt: at });
  }

  /** A screen no longer of this event, or revoked: nothing of it stays. */
  async forget(screenId: string): Promise<void> {
    await this.storage.delete([STATUS + screenId, QUALITY + screenId, SHOT + screenId]);
  }

  /** Drops screens disconnected past the keep window; returns when the next one falls due, if any. */
  async prune(now: number): Promise<number | null> {
    let next: number | null = null;
    for (const status of await this.all()) {
      if (status.online || !status.disconnectedAt) continue;
      const due = Date.parse(status.disconnectedAt) + KEEP_MS;
      if (due <= now) await this.forget(status.screenId);
      else next = next === null ? due : Math.min(next, due);
    }
    return next;
  }
}
