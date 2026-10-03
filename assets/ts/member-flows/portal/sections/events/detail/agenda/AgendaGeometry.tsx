import { useEffect, useRef } from "preact/hooks";
import type { ContentAgendaDay } from "../../../../../../../shared/site-agenda";
import { agendaLayoutCss } from "../../../../../../../shared/agenda-layout-css";
import { agendaRows } from "../../../../../../site/agenda-layout";
export function AgendaGeometry({ day }: { day: ContentAgendaDay }) {
  const marker = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const sheet = new CSSStyleSheet();
    if (typeof sheet.replaceSync !== "function") {
      const root = marker.current?.closest(".pk-agenda-editor");
      root?.classList.add("pk-agenda-editor--natural");
      return () => root?.classList.remove("pk-agenda-editor--natural");
    }
    sheet.replaceSync(
      agendaLayoutCss(agendaRows(day, 80).map((row) => row.height)).replaceAll(
        ".pk-content-agenda:not(.is-compact)",
        ".pk-agenda-editor .pk-content-agenda",
      ),
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return () => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((value) => value !== sheet);
    };
  }, [day]);
  return <span hidden ref={marker} />;
}
