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
        if (!recordingAvailable) element.querySelector<HTMLIFrameElement>("iframe")?.removeAttribute("src");
      });
    }
  };
  update();
  const timer = window.setInterval(update, 30_000);
  return () => window.clearInterval(timer);
}
