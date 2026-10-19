/** Canonical theme preference shared by the public site and portal. */
const STORAGE_KEY = "pk-theme";
export type ThemeChoice = "light" | "dark" | "system";

export function currentThemeChoice(): ThemeChoice {
  const value = typeof document === "undefined" ? null : document.documentElement.getAttribute("data-theme");
  return value === "light" || value === "dark" ? value : "system";
}

export function applyThemeChoice(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    if (choice === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Applying a theme still works when the browser refuses storage.
  }
}
