import { formatNumber } from "../../shared/format-number";
import { formatClockInZone } from "../../shared/format-date";
import { agendaZoneAbbreviation } from "../../shared/agenda-time-display";

/** Stop media when a shared session dialog closes or its recording becomes unavailable. */
export function pauseAgendaSessionMedia(root: HTMLElement): void {
  root.querySelectorAll<HTMLVideoElement>("video").forEach((video) => video.pause());
  root.querySelectorAll<HTMLIFrameElement>("iframe[data-video-src]").forEach((iframe) => iframe.removeAttribute("src"));
}

/** Update static and portal cards from the current browser clock, never the publication build time. */
export function initializeAgendaSessionMedia(root: HTMLElement): () => void {
  const update = () => {
    const cards = root.matches("[data-agenda-media-session]")
      ? [root]
      : [...root.querySelectorAll<HTMLElement>("[data-agenda-media-session]")];
    const now = Date.now();
    for (const card of cards) {
      const start = Date.parse(card.dataset.agendaMediaStart ?? "");
      const end = Date.parse(card.dataset.agendaMediaEnd ?? "");
      const knownInterval = Number.isFinite(start) && Number.isFinite(end) && end > start;
      const before = Number.isFinite(start) ? now < start : true;
      const status = card.querySelector<HTMLElement>("[data-agenda-session-status]");
      if (status) {
        const live = knownInterval && now >= start && now < end;
        // The supplied design marks only the next fifteen minutes as upcoming.
        const upcoming = knownInterval && now < start && start - now <= 15 * 60_000;
        status.hidden = !live && !upcoming;
        status.dataset.agendaStatus = live ? "live" : "upcoming";
        const label = status.querySelector<HTMLElement>("[data-agenda-status-label]");
        const time = status.querySelector<HTMLElement>("[data-agenda-status-time]");
        if (label)
          label.textContent = live ? "Live now" : `Starts in ${formatNumber(Math.ceil((start - now) / 60_000))} min`;
        const zone = card.closest<HTMLElement>("[data-agenda-time-zone]")?.dataset.agendaTimeZone;
        if (time)
          time.textContent = live
            ? `${formatNumber(Math.ceil((end - now) / 60_000))} min left`
            : upcoming && zone
              ? `${formatClockInZone(new Date(start).toISOString(), zone)} ${agendaZoneAbbreviation(new Date(start).toISOString(), zone)}`
              : "";
        // Progress of a live session drives the thin bar along the bottom of the band.
        status.dataset.agendaProgress = live
          ? String(Math.min(100, Math.round(((now - start) / (end - start)) * 20) * 5))
          : "0";
      }
      card.dataset.agendaState =
        knownInterval && now >= end
          ? "past"
          : knownInterval && now >= start
            ? "live"
            : knownInterval && start - now <= 15 * 60_000
              ? "upcoming"
              : "";

      const during = knownInterval && now >= start && now < end;
      // Unknown archival end times do not suppress an existing approved recording.
      const recordingAvailable = !knownInterval || now >= end;
      card.querySelectorAll<HTMLElement>("[data-agenda-media-before]").forEach((element) => {
        element.hidden = !before;
      });
      card.querySelectorAll<HTMLElement>("[data-agenda-media-during]").forEach((element) => {
        element.hidden = !during;
      });
      const livePlanVisible = before || (during && !card.querySelector("[data-agenda-media-during]"));
      card.querySelectorAll<HTMLElement>("[data-agenda-media-live-plan]").forEach((element) => {
        element.hidden = !livePlanVisible;
      });
      card.querySelectorAll<HTMLElement>("[data-agenda-media-plans]").forEach((element) => {
        element.hidden = [...element.children].every((child) => child.hasAttribute("hidden"));
      });
      card.querySelectorAll<HTMLElement>("[data-agenda-media-recording]").forEach((element) => {
        element.hidden = !recordingAvailable;
        if (!recordingAvailable) pauseAgendaSessionMedia(element);
      });
    }
  };
  update();
  const timer = window.setInterval(update, 30_000);
  return () => window.clearInterval(timer);
}
