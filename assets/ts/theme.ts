/**
 * The reader's light/dark choice.
 *
 * Three states, because that is what the token sheet reads: `data-theme` set
 * to `light` or `dark` is an explicit choice, and no attribute at all means
 * the operating system decides. A two-way switch would take the third away —
 * once you had chosen, you could never hand the decision back.
 *
 * The icon is the stylesheet's job (`ui/ThemeToggle.css`). This module owns
 * the choice: read it, cycle it, remember it, and say which state the control
 * is now in.
 */

import "./ui/ThemeToggle.css";

const STORAGE_KEY = "pk-theme";

type Theme = "light" | "dark";
type Choice = Theme | "system";

const NEXT: Record<Choice, Choice> = { system: "light", light: "dark", dark: "system" };

const DESCRIPTION: Record<Choice, string> = {
  system: "Theme: matching your system. Activate for the light theme.",
  light: "Theme: light. Activate for the dark theme.",
  dark: "Theme: dark. Activate to match your system.",
};

function currentChoice(): Choice {
  const value = document.documentElement.getAttribute("data-theme");
  return value === "light" || value === "dark" ? value : "system";
}

/**
 * Writes the choice to the document and to storage.
 *
 * Storage can throw — a private window, or a browser set to refuse site data —
 * and a theme that cannot be remembered is still worth applying for this page.
 */
function apply(choice: Choice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);

  try {
    if (choice === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Not remembering the choice is a smaller failure than not honouring it.
  }
}

function describe(button: HTMLElement, choice: Choice): void {
  const description = DESCRIPTION[choice];
  button.setAttribute("aria-label", description);
  button.setAttribute("title", description);
  const label = button.querySelector("[data-theme-label]");
  if (label) label.textContent = description;
}

export function installThemeToggle(button: HTMLElement): void {
  describe(button, currentChoice());
  button.addEventListener("click", () => {
    const next = NEXT[currentChoice()];
    apply(next);
    describe(button, next);
  });
}

/** Wires every toggle on the page. Called by the loader entry. */
export function installThemeToggles(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-theme-toggle]").forEach(installThemeToggle);
}
