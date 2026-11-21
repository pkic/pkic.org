/**
 * Which hints a tooltip layer answers for, and how a control's `title`
 * becomes its hint.
 *
 * A layer's surface is its root element plus whatever is laid over it while
 * it is on screen: a dialog or a popover, wherever that stands in the
 * document. A confirmation opens from a host near the application root and a
 * tour is portaled to the body, so "inside the root" alone left exactly
 * those with the browser's own title. Nothing else on the page is touched.
 */

/** What lies over a surface without standing in it. */
const OVERLAY = "dialog, [popover]";

/** A control answers for itself. */
const CONTROL = "a[href], button, input, select, textarea";

/** The surfaces with a layer, oldest first. */
const surfaces: HTMLElement[] = [];

/** Registers a surface for as long as its layer is mounted. */
export function claimSurface(root: HTMLElement): () => void {
  surfaces.push(root);
  return () => void surfaces.splice(surfaces.indexOf(root), 1);
}

/**
 * Whether this surface answers for an element: one inside its root, or one
 * in an overlay outside every surface, which the oldest layer takes so two
 * layers never both answer.
 */
export function covers(root: HTMLElement, element: Element): boolean {
  if (root.contains(element)) return true;
  if (surfaces[0] !== root || !element.closest(OVERLAY)) return false;
  return !surfaces.some((other) => other.contains(element));
}

/** The hinted element a pointer or focus target stands for on this surface, or null. */
export function hinted(root: HTMLElement, target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>("[title], [data-tooltip]");
  if (!element || element.matches("iframe") || !covers(root, element)) return null;
  // A region's hint is about the region: not about a control inside it, nor about a dialog or menu that only
  // stands inside it in the document.
  const inner = target.closest(`${CONTROL}, ${OVERLAY}`);
  if (inner && inner !== element && element.contains(inner)) return null;
  return element;
}

/** A hint as a screen reader says it: its lines as sentences. */
const spoken = (lines: readonly string[]) =>
  lines.map((line, index) => (index < lines.length - 1 && !/[.!?:…]$/.test(line) ? `${line}.` : line)).join(" ");

function write(element: HTMLElement, attribute: string, value: string) {
  if (value) element.setAttribute(attribute, value);
  else element.removeAttribute(attribute);
}

/** The name the control already has without its title, when that can be read off it. */
function ownName(element: HTMLElement): string | null {
  if (element.hasAttribute("aria-labelledby")) return "";
  if (element.hasAttribute("aria-label") && !("tooltipNames" in element.dataset))
    return element.getAttribute("aria-label");
  return element.textContent?.trim() || null;
}

/**
 * Moves the element's title into its hint, so the browser's own title never
 * shows, and keeps what assistive technology hears right and said once. A
 * control the title alone named takes the hint's first line as its name. A
 * hint describes the control only as far as it says more than the name: all
 * of it, what follows a first line that repeats the name, or nothing. Runs
 * again whenever the control writes a new title, so the hint always says the
 * current state.
 */
export function takeTitle(element: HTMLElement) {
  const title = element.getAttribute("title");
  if (title === null || element.matches("iframe")) return;
  element.removeAttribute("title");
  element.dataset.tooltip = title;
  const [lead = "", ...more] = title.split("\n");
  const name = ownName(element);
  let describes: "all" | "more" | "none";
  if (name === null) {
    element.dataset.tooltipNames = "";
    write(element, "aria-label", lead);
    describes = more.length ? "more" : "none";
  } else if (name.includes(title) || name.includes(spoken([lead, ...more]))) describes = "none";
  else describes = name === lead ? (more.length ? "more" : "none") : "all";
  // A description the control wrote itself stays; the layer then adds none.
  if (!("tooltipDescribes" in element.dataset) && element.hasAttribute("aria-description")) return;
  element.dataset.tooltipDescribes = title ? describes : "none";
  write(
    element,
    "aria-description",
    !title || describes === "none" ? "" : spoken(describes === "all" ? [lead, ...more] : more),
  );
}

/** Takes every title this surface answers for in a subtree, the node itself included. */
export function takeTitles(root: HTMLElement, node: Node) {
  if (!(node instanceof Element)) return;
  const take = (element: Element) => {
    if (element instanceof HTMLElement && covers(root, element)) takeTitle(element);
  };
  if (node.hasAttribute("title")) take(node);
  node.querySelectorAll("[title]").forEach(take);
}

/** Takes the titles in the surface's root and in every overlay now open over it. */
export function takeSurfaceTitles(root: HTMLElement) {
  takeTitles(root, root);
  document.querySelectorAll(OVERLAY).forEach((overlay) => takeTitles(root, overlay));
}

/**
 * Whether a hint says something the control does not show already. A hint
 * that only repeats the element's own text, as a clamped cell or a long
 * title writes it, is worth showing only while that text is cut off.
 */
export function worthShowing(element: HTMLElement, hint: string): boolean {
  if (hint !== element.textContent?.trim()) return true;
  const box = element.clientWidth ? element : element.parentElement;
  return Boolean(box && (box.scrollWidth > box.clientWidth + 1 || box.scrollHeight > box.clientHeight + 1));
}

/**
 * Points the control at the part of the tooltip on show that describes it,
 * so the description is the tooltip while it shows and is never said twice.
 */
export function describeBy(element: HTMLElement, tooltipId: string) {
  // A description the control points at itself stays its description.
  if (element.hasAttribute("aria-describedby") && !element.getAttribute("aria-describedby")?.startsWith(tooltipId))
    return;
  const describes = element.dataset.tooltipDescribes;
  if (describes === "all") element.setAttribute("aria-describedby", tooltipId);
  else if (describes === "more") element.setAttribute("aria-describedby", `${tooltipId}-more`);
}
