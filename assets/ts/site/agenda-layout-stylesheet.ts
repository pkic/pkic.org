import { agendaLayoutCss } from "../../shared/agenda-layout-css";

const mountedAgendas = new Set<HTMLElement>();
let stylesheet: CSSStyleSheet | undefined;
let installedCss = "";

function refreshLayout(): void {
  const css = agendaLayoutCss(
    [...mountedAgendas].flatMap((root) =>
      [...root.querySelectorAll<HTMLElement>("[data-agenda-height]")].map((row) => Number(row.dataset.agendaHeight)),
    ),
  );
  if (css === installedCss) return;
  if (!css) {
    if (stylesheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== stylesheet);
    stylesheet = undefined;
  } else {
    if (!stylesheet) {
      stylesheet = new CSSStyleSheet();
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, stylesheet];
    }
    stylesheet.replaceSync(css);
  }
  installedCss = css;
}

/** Preview geometry follows mounted content; published pages already carry their complete stylesheet. */
export function observeAgendaLayout(root: HTMLElement): () => void {
  if (root.hasAttribute("data-agenda-public-fragments") && document.querySelector("link[data-agenda-layout]"))
    return () => {};
  mountedAgendas.add(root);
  refreshLayout();
  const observer = new MutationObserver(refreshLayout);
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-agenda-height"] });
  return () => {
    observer.disconnect();
    mountedAgendas.delete(root);
    refreshLayout();
  };
}
