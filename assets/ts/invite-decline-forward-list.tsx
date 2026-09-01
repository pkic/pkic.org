/**
 * The "invite someone else" list on the decline page.
 *
 * Its own module because it is its own responsibility — parsing pasted
 * contacts, adding and removing rows, and keeping every control in the list
 * named — and because `invite-decline.tsx` is already at the length where one
 * more section stops being readable.
 *
 * The rows are built with Preact rather than string concatenation, but the
 * list itself is imperative: the surrounding page is a Hugo shortcode that
 * owns the markup around it, so this attaches to the elements already there.
 */
import { render } from "preact";
import { INVITE_FORWARD_LIMIT } from "../shared/schemas/registration";
import { q } from "./shared/form/helpers";
import { parseContactText, type ParsedContact } from "./shared/invite-parser";
// `pk-input` on the three fields ships with the entry stylesheet, because the
// public shortcodes this page is built from write the class themselves.

/** Reads the page's own cap, bounded by the contract's maximum. */
function forwardLimitFor(root: HTMLElement): number {
  const configured = parseInt(root.dataset.forwardMax ?? "", 10);
  if (!Number.isFinite(configured)) return INVITE_FORWARD_LIMIT;
  return Math.max(0, Math.min(configured, INVITE_FORWARD_LIMIT));
}

/**
 * Wires the forward disclosure, the paste box and the add/remove controls.
 *
 * Returns nothing: everything it owns lives in the DOM, and the submit
 * handler reads the rows back through `[data-forward-row]`.
 */
export function wireForwardList(root: HTMLElement): void {
  const maxForwards = forwardLimitFor(root);
  let forwardCount = 0;

  /**
   * Names every control in the list by its row's current position.
   *
   * The column captions above the list are `aria-hidden`, so without this the
   * three inputs in each row are announced as "edit text" three times over,
   * and their placeholders disappear the moment anything is typed. The names
   * are recomputed after every add and removal, because a fixed number would
   * go stale the first time a row in the middle is taken out.
   */
  function nameForwardRows(): void {
    root.querySelectorAll<HTMLElement>("[data-forward-row]").forEach((row, index) => {
      const position = index + 1;
      row.querySelectorAll<HTMLElement>("[data-fw-label]").forEach((control) => {
        const part = control.dataset.fwLabel ?? "";
        control.setAttribute(
          "aria-label",
          part === "remove" ? `Remove contact ${String(position)}` : `Contact ${String(position)}: ${part}`,
        );
      });
    });
  }

  function addForwardRow(prefill?: ParsedContact): void {
    if (forwardCount >= maxForwards) return;
    forwardCount++;

    const forwardList = q<HTMLElement>("[data-forward-list]", root);
    if (!forwardList) return;

    const row = document.createElement("div");
    row.className = "event-flow-invite-row";
    row.dataset.forwardRow = "";
    render(
      <>
        <input
          type="text"
          class="pk-input"
          placeholder="First name"
          data-fw-label="first name"
          data-fw="firstName"
          autocomplete="off"
          value={prefill?.firstName ?? ""}
        />
        <input
          type="text"
          class="pk-input"
          placeholder="Last name"
          data-fw-label="last name"
          data-fw="lastName"
          autocomplete="off"
          value={prefill?.lastName ?? ""}
        />
        <input
          type="email"
          class="pk-input"
          placeholder="Email *"
          data-fw-label="email address (required)"
          data-fw="email"
          autocomplete="off"
          value={prefill?.email ?? ""}
        />
        <button type="button" class="event-flow-invite-remove-btn" data-fw-label="remove" data-remove-row>
          &times;
        </button>
      </>,
      row,
    );

    row.querySelector("[data-remove-row]")?.addEventListener("click", () => {
      row.remove();
      forwardCount--;
      nameForwardRows();
      q<HTMLElement>("[data-add-forward]", root)?.removeAttribute("disabled");
    });

    forwardList.appendChild(row);
    nameForwardRows();

    if (forwardCount >= maxForwards) {
      q<HTMLElement>("[data-add-forward]", root)?.setAttribute("disabled", "");
    }

    if (!prefill) {
      q<HTMLInputElement>("[data-fw='firstName']", row)?.focus();
    }
  }

  const toggleBtn = q<HTMLElement>("[data-forward-toggle]", root);
  const forwardEntries = q<HTMLElement>("[data-forward-entries]", root);
  const arrowEl = q<HTMLElement>("[data-forward-arrow]", root);

  toggleBtn?.addEventListener("click", () => {
    const expanded = toggleBtn.getAttribute("aria-expanded") === "true";
    toggleBtn.setAttribute("aria-expanded", String(!expanded));
    if (arrowEl) arrowEl.textContent = !expanded ? "▼" : "▶";
    if (forwardEntries) forwardEntries.hidden = expanded;
    if (!expanded && forwardCount === 0) addForwardRow();
  });

  const pasteArea = q<HTMLTextAreaElement>("[data-decline-forward-paste]", root);
  pasteArea?.addEventListener("change", () => {
    const raw = pasteArea.value.trim();
    if (!raw) return;
    for (const entry of parseContactText(raw)) {
      if (forwardCount >= maxForwards) break;
      addForwardRow(entry);
    }
    pasteArea.value = "";
  });

  q<HTMLElement>("[data-add-forward]", root)?.addEventListener("click", () => addForwardRow());
}
