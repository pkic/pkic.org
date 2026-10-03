/** Pre-generated diagrams need only the browser's native accessible zoom dialog. */
for (const wrapper of document.querySelectorAll<HTMLElement>(".mermaid-wrap")) {
  const diagram = wrapper.querySelector<HTMLElement>("[data-rendered-diagram]");
  if (!diagram) continue;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "diagram-toggle";
  button.textContent = "Expand diagram";
  const dialog = document.createElement("dialog");
  dialog.className = "diagram-dialog";
  dialog.setAttribute("aria-label", "Expanded diagram");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "diagram-toggle";
  close.textContent = "Close diagram";
  close.addEventListener("click", () => dialog.close());
  const hint = document.createElement("p");
  hint.className = "diagram-hint";
  hint.textContent = "Scroll to explore the diagram. Use arrow keys when the diagram is focused.";
  const viewport = document.createElement("div");
  viewport.className = "diagram-viewport";
  viewport.tabIndex = 0;
  viewport.setAttribute("role", "region");
  viewport.setAttribute("aria-label", "Scrollable diagram");
  const svg = diagram.querySelector("svg");
  const width = svg?.getAttribute("width");
  const height = svg?.getAttribute("height");
  dialog.append(close, hint, viewport);
  document.body.append(dialog);
  dialog.addEventListener("close", () => {
    if (svg) {
      if (width === null || width === undefined) svg.removeAttribute("width");
      else svg.setAttribute("width", width);
      if (height === null || height === undefined) svg.removeAttribute("height");
      else svg.setAttribute("height", height);
    }
    wrapper.append(diagram);
    button.focus();
  });
  const open = () => {
    if (dialog.open) return;
    if (svg && svg.viewBox.baseVal.width > 0 && svg.viewBox.baseVal.height > 0) {
      svg.setAttribute("width", String(svg.viewBox.baseVal.width));
      svg.setAttribute("height", String(svg.viewBox.baseVal.height));
    }
    viewport.append(diagram);
    viewport.scrollTo(0, 0);
    dialog.showModal();
  };
  button.addEventListener("click", open);
  wrapper.prepend(button);
  wrapper.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a, button")) return;
    open();
  });
}
