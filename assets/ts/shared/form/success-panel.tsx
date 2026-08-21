import { render, type ComponentChildren, type VNode } from "preact";

/** Replaces a submitted form with a rendered success panel and focuses it visually. */
export function replaceFormWithSuccess(
  root: HTMLElement,
  form: HTMLFormElement,
  content: ComponentChildren,
): HTMLElement {
  form.classList.add("d-none");
  const container = document.createElement("div");
  render(content as VNode, container);
  root.appendChild(container);
  requestAnimationFrame(() => container.scrollIntoView({ behavior: "smooth", block: "start" }));
  return container;
}
