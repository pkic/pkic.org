import { formatClockInZone } from "../../shared/format-date";

let agendaNowSequence = 0;

/**
 * The reference's red "NOW" rule across the visible day, plus each day's visible width
 * (--agenda-visible-width) for content that stays centred while the grid scrolls. Position comes from an adopted
 * stylesheet (no inline styles) and follows the browser clock, not the build time.
 */
export function initializeAgendaNowLine(root: HTMLElement): () => void {
  if (typeof CSSStyleSheet !== "function" || !Array.isArray(document.adoptedStyleSheets)) return () => {};
  const sheet = new CSSStyleSheet();
  if (typeof sheet.replaceSync !== "function") return () => {};
  const id = String(++agendaNowSequence);
  root.dataset.agendaNowId = id;
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  const zone = root.dataset.agendaTimeZone;

  const update = () => {
    const now = Date.now();
    let css = "";
    for (const panel of root.querySelectorAll<HTMLElement>(".pk-content-agenda__day")) {
      // Break bars centre on the visible part of the grid; publish that width without inline styles.
      if (!panel.hidden && panel.clientWidth)
        css += `[data-agenda-now-id="${id}"] .pk-content-agenda__day[data-agenda-panel="${CSS.escape(panel.dataset.agendaPanel ?? "")}"]{--agenda-visible-width:${panel.clientWidth}px}`;
      let line = panel.querySelector<HTMLElement>(":scope > .pk-content-agenda__now");
      const rows = [...panel.querySelectorAll<HTMLElement>(".pk-content-agenda__slot")];
      const starts = rows.map((row) =>
        Date.parse(row.querySelector<HTMLTimeElement>('[data-agenda-clock="venue"] time')?.dateTime ?? ""),
      );
      const index = starts.findIndex(
        (start, position) => Number.isFinite(start) && start <= now && now < (starts[position + 1] ?? -Infinity),
      );
      if (index < 0 || panel.hidden) {
        if (line) line.hidden = true;
        continue;
      }
      if (!line) {
        line = document.createElement("div");
        line.className = "pk-content-agenda__now";
        line.setAttribute("aria-hidden", "true");
        line.appendChild(document.createElement("span"));
        panel.appendChild(line);
      }
      line.hidden = false;
      line.dataset.agendaNowPanel = panel.dataset.agendaPanel ?? "";
      const row = rows[index]!;
      const table = row.closest("table");
      const fraction = (now - starts[index]!) / (starts[index + 1]! - starts[index]!);
      const top = Math.round((table?.offsetTop ?? 0) + row.offsetTop + fraction * row.offsetHeight);
      line.firstElementChild!.textContent = `NOW ${zone ? formatClockInZone(new Date(now).toISOString(), zone) : ""}`;
      css += `[data-agenda-now-id="${id}"] .pk-content-agenda__now[data-agenda-now-panel="${CSS.escape(line.dataset.agendaNowPanel)}"]{top:${top}px;inline-size:${table?.scrollWidth ?? panel.scrollWidth}px}`;
    }
    sheet.replaceSync(css);
  };
  update();
  const timer = window.setInterval(update, 30_000);
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => update()) : undefined;
  resize?.observe(root);
  root.querySelectorAll<HTMLElement>(".pk-content-agenda__day").forEach((panel) => resize?.observe(panel));
  return () => {
    window.clearInterval(timer);
    resize?.disconnect();
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((candidate) => candidate !== sheet);
    root.querySelectorAll(".pk-content-agenda__now").forEach((line) => line.remove());
  };
}
