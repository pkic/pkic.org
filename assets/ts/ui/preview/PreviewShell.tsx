/**
 * The preview's chrome: the four controls that rewrite the tokens live.
 *
 * These are the system's own knobs, not the preview's — theme, density, radius
 * and accent are properties of the token layer, so changing one here changes
 * every specimen at once. If a component needs its own copy of any of them,
 * that component is wrong.
 *
 * The controls write to the document element rather than to a context, because
 * that is exactly how a real surface will set them: the portal will stamp
 * `data-theme` and `data-density` on the shell and set `--pk-accent` from the
 * group record.
 */

import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

import { accentNeighbour, palette, type AccentHue } from "../../../design/palette.ts";

import "./PreviewShell.css";

type Theme = "light" | "dark";
type Density = "comfortable" | "compact";
type Radius = "sharp" | "default" | "round";

const ACCENTS = Object.keys(accentNeighbour) as AccentHue[];

export interface PreviewSection {
  id: string;
  title: string;
  /** One line on what the section is for. Not decoration — it says why. */
  note?: string;
  render: () => ComponentChildren;
}

export function PreviewShell({ sections }: { sections: readonly PreviewSection[] }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [density, setDensity] = useState<Density>("comfortable");
  const [radius, setRadius] = useState<Radius>("default");
  const [accent, setAccent] = useState<AccentHue>("green");

  // Start on whatever the viewer's environment already resolves to, so the
  // first impression matches the surface they actually work in.
  useEffect(() => {
    // Guarded rather than assumed: matchMedia is absent in jsdom and in any
    // server-side render, and the phase plan requires primitives to survive
    // both. Defaulting to light is the safe answer when nothing can be asked.
    const query = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    setTheme(query?.matches ? "dark" : "light");
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-density", density);
    root.setAttribute("data-radius", radius);
    root.style.setProperty("--pk-accent", palette[accent]);
    root.style.setProperty("--pk-accent-2", palette[accentNeighbour[accent]]);
  }, [theme, density, radius, accent]);

  return (
    <div class="pk-preview">
      <header class="pk-preview__bar">
        <p class="pk-preview__brand">
          PKIC <span>design system</span>
        </p>

        <Segmented
          label="Theme"
          value={theme}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          onSelect={setTheme}
        />
        <Segmented
          label="Density"
          value={density}
          options={[
            { value: "comfortable", label: "Comfortable" },
            { value: "compact", label: "Compact" },
          ]}
          onSelect={setDensity}
        />
        <Segmented
          label="Radius"
          value={radius}
          options={[
            { value: "sharp", label: "Sharp" },
            { value: "default", label: "Default" },
            { value: "round", label: "Round" },
          ]}
          onSelect={setRadius}
        />

        <div class="pk-preview__control">
          <span class="pk-preview__label">Accent</span>
          <div class="pk-preview__hues" role="group" aria-label="Accent">
            {ACCENTS.map((hue) => (
              <button
                key={hue}
                type="button"
                class={`pk-preview__hue pk-preview__hue--${hue}`}
                aria-pressed={hue === accent}
                aria-label={hue}
                onClick={() => setAccent(hue)}
              />
            ))}
          </div>
        </div>
      </header>

      <nav class="pk-preview__toc" aria-label="Sections">
        {sections.map((section) => (
          <a key={section.id} href={`#${section.id}`}>
            {section.title}
          </a>
        ))}
      </nav>

      <main class="pk-preview__main">
        {sections.map((section) => (
          <section key={section.id} id={section.id} class="pk-preview__section">
            <h2>{section.title}</h2>
            {section.note && <p class="pk-preview__note">{section.note}</p>}
            <div class="pk-preview__specimens">{section.render()}</div>
          </section>
        ))}
      </main>
    </div>
  );
}

function Segmented<Value extends string>({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: Value;
  options: ReadonlyArray<{ value: Value; label: string }>;
  onSelect: (next: Value) => void;
}) {
  return (
    <div class="pk-preview__control">
      <span class="pk-preview__label">{label}</span>
      <div class="pk-preview__segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === value}
            onClick={() => onSelect(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
