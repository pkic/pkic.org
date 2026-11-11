import { SCREEN_POLICY } from "../../../../assets/shared/event-screen-policy";
import {
  SCREEN_MONITOR_LIMITS,
  screenLiveStatusSchema,
  type ScreenHealth,
  type ScreenLiveStatus,
} from "../../../../assets/shared/schemas/event-screen-monitor";

const PREFIX = "status:";
const KEEP_MS = SCREEN_POLICY.monitorKeepDays * 24 * 60 * 60 * 1000;

/**
 * Each screen's last known status, in the monitor's own storage: written on
 * every report and connection change, never in D1. A screen that stays
 * disconnected is forgotten after the keep window.
 */
export class ScreenMonitorStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  async all(): Promise<ScreenLiveStatus[]> {
    const stored = await this.storage.list<unknown>({ prefix: PREFIX, limit: SCREEN_MONITOR_LIMITS.screensPerEvent });
    return [...stored.values()].flatMap((value) => {
      const parsed = screenLiveStatusSchema.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    });
  }

  get(screenId: string): Promise<ScreenLiveStatus | undefined> {
    return this.storage.get<ScreenLiveStatus>(PREFIX + screenId);
  }

  /** Room for one more screen: it is known already, or the event is under its limit. */
  async admits(screenId: string): Promise<boolean> {
    if (await this.get(screenId)) return true;
    const stored = await this.storage.list({ prefix: PREFIX, limit: SCREEN_MONITOR_LIMITS.screensPerEvent });
    return stored.size < SCREEN_MONITOR_LIMITS.screensPerEvent;
  }

  private async put(status: ScreenLiveStatus): Promise<ScreenLiveStatus> {
    const parsed = screenLiveStatusSchema.parse(status);
    await this.storage.put(PREFIX + parsed.screenId, parsed);
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
      health: previous?.health ?? null,
    });
  }

  async reported(screenId: string, health: ScreenHealth, at: string): Promise<ScreenLiveStatus> {
    const previous = await this.get(screenId);
    return this.put({
      screenId,
      online: true,
      connectedAt: previous?.connectedAt ?? at,
      disconnectedAt: null,
      reportedAt: at,
      health,
    });
  }

  async disconnected(screenId: string, at: string): Promise<ScreenLiveStatus | null> {
    const previous = await this.get(screenId);
    if (!previous) return null;
    return this.put({ ...previous, online: false, disconnectedAt: at });
  }

  /** A screen no longer of this event, or revoked: nothing of it stays. */
  async forget(screenId: string): Promise<void> {
    await this.storage.delete(PREFIX + screenId);
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
