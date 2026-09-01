import { render, type ComponentChildren, type VNode } from "preact";

/** Replaces a submitted form with a rendered success panel and focuses it visually. */
export function replaceFormWithSuccess(
  root: HTMLElement,
  form: HTMLFormElement,
  content: ComponentChildren,
): HTMLElement {
  // The platform's own attribute, not a class: the form does not have to know
  // which stylesheet is loaded for this to work, and nothing has to stay in
  // step with it.
  form.hidden = true;
  const container = document.createElement("div");
  render(content as VNode, container);
  root.appendChild(container);
  requestAnimationFrame(() => container.scrollIntoView({ behavior: "smooth", block: "start" }));
  return container;
}
