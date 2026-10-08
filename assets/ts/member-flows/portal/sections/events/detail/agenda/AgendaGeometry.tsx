import { useEffect, useRef } from "preact/hooks";
import type { ContentAgendaDay } from "../../../../../../../shared/site-agenda";
import { agendaLayoutCss } from "../../../../../../../shared/agenda-layout-css";
import { agendaRows } from "../../../../../../site/agenda-layout";
export function AgendaGeometry({ day }: { day: ContentAgendaDay }) {
  const marker = useRef<HTMLSpanElement | null>(null);
  const css = agendaLayoutCss(agendaRows(day, 0, true).map((row) => row.height))
    .replaceAll(".pk-content-agenda:not(.is-compact)", ".pk-agenda-editor .pk-content-agenda")
    .replace("@media(min-width:46.001rem)", "@media(min-width:0rem)");
  useEffect(() => {
    const sheet = new CSSStyleSheet();
    if (typeof sheet.replaceSync !== "function") {
      const root = marker.current?.closest(".pk-agenda-editor");
      root?.classList.add("pk-agenda-editor--natural");
      return () => root?.classList.remove("pk-agenda-editor--natural");
    }
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return () => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((value) => value !== sheet);
    };
  }, [css]);
  return <span hidden ref={marker} />;
}
