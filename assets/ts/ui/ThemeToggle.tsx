import { hydrate } from "preact";
import { useEffect, useState } from "preact/hooks";
import { applyThemeChoice, currentThemeChoice, type ThemeChoice } from "../theme";
import { IconMoon, IconSun, IconContrast } from "./MediaIcons";
import { Menu } from "./Menu";
import "./ThemeToggle.css";
import "./ThemeMenu.css";

const choices = [
  { id: "light", label: "Light", icon: <IconSun /> },
  { id: "dark", label: "Dark", icon: <IconMoon /> },
  { id: "system", label: "Auto", icon: <IconContrast /> },
] as const;

export function ThemeMenu() {
  // Match server markup before applying the browser preference after hydration.
  const [choice, setChoice] = useState<ThemeChoice>("system");
  useEffect(() => {
    setChoice(currentThemeChoice());
    const observer = new MutationObserver(() => setChoice(currentThemeChoice()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return (
    <Menu
      label={`Theme: ${choices.find((item) => item.id === choice)?.label}. Choose appearance`}
      align="end"
      variant="plain"
      items={choices.map((item) => ({
        ...item,
        checked: item.id === choice,
        onSelect: () => {
          applyThemeChoice(item.id);
          setChoice(item.id);
        },
      }))}
    >
      <IconContrast data-theme-icon="system" />
      <IconSun data-theme-icon="light" />
      <IconMoon data-theme-icon="dark" />
    </Menu>
  );
}

export function ThemeToggle() {
  return (
    <span class="pk-theme-control" data-theme-menu>
      <ThemeMenu />
    </span>
  );
}

/** Hydrate the shared menu in server-rendered site chrome once. */
export function installThemeToggles(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-theme-menu]").forEach((element) => {
    if (element.dataset.themeMounted) return;
    element.dataset.themeMounted = "true";
    hydrate(<ThemeMenu />, element);
  });
}
