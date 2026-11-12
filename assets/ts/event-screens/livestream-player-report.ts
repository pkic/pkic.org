/**
 * The livestream player's state as the screen last reported it, for anything
 * on the page that forwards the screen's health. The player publishes; a
 * reader takes the latest report or subscribes to changes. The player's own
 * readings change all the time, so they are not published: the player
 * provides a reader, and the health report reads it when it is sent.
 */
import type { ScreenPlayback } from "../../shared/schemas/event-screen-monitor";
import type { LivestreamPlayerStatus } from "./livestream-health";

export interface LivestreamPlayerReport {
  status: LivestreamPlayerStatus;
  videoId: string;
  /** Playing without sound: the browser refused to start it with sound. */
  muted: boolean;
  /** When the status or the video last changed, as an ISO-8601 UTC instant. */
  changedAt: string;
}

let latest: LivestreamPlayerReport | null = null;
const listeners = new Set<(report: LivestreamPlayerReport | null) => void>();

export function livestreamPlayerReport(): LivestreamPlayerReport | null {
  return latest;
}

export function subscribeLivestreamPlayerReport(listener: (report: LivestreamPlayerReport | null) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Null once no player runs. Reports that change nothing are not repeated. */
export function publishLivestreamPlayerReport(report: LivestreamPlayerReport | null): void {
  if (
    report === latest ||
    (report &&
      latest &&
      report.status === latest.status &&
      report.videoId === latest.videoId &&
      report.changedAt === latest.changedAt)
  )
    return;
  latest = report;
  for (const listener of listeners) listener(report);
}

export type LivestreamPlaybackReader = () => ScreenPlayback | null;
let playback: LivestreamPlaybackReader | null = null;

/** The running player's readings; returns the function that withdraws them. */
export function provideLivestreamPlayback(reader: LivestreamPlaybackReader): () => void {
  playback = reader;
  return () => {
    if (playback === reader) playback = null;
  };
}

/** Null while no player runs, or when its readings fail. */
export const readLivestreamPlayback: LivestreamPlaybackReader = () => {
  try {
    return playback?.() ?? null;
  } catch {
    return null;
  }
};

const soundRequests = new Set<() => void>();

/** A click that allows sound happened: a muted player tries with sound again. */
export function requestLivestreamSound(): void {
  for (const listener of soundRequests) listener();
}

export function onLivestreamSoundRequest(listener: () => void): () => void {
  soundRequests.add(listener);
  return () => void soundRequests.delete(listener);
}
