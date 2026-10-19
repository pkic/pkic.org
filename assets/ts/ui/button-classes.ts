/**
 * The class names of a button look, kept apart from the Button component so a plain DOM
 * control (a script-built dialog) can wear the same look without bundling the component.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-quiet" | "link";
/**
 * The one size a caller may ask for: `lg`, for a hero or landing call to action.
 * Every other button is the default size, and a dense surface shrinks it by
 * setting `data-density="compact"` once on the surface rather than per button.
 */
export type ButtonSize = "lg";

export interface ButtonLook {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders square, for an icon-only control. Requires `aria-label`. */
  icon?: boolean;
}

/** The classes for a look; `extra` is whatever `class` the caller passed. */
export function buttonClasses({ variant = "secondary", size, icon = false }: ButtonLook, extra: unknown) {
  return [
    "pk-btn",
    `pk-btn--${variant}`,
    size ? `pk-btn--${size}` : null,
    icon ? "pk-btn--icon" : null,
    typeof extra === "string" ? extra : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/** The close control's own classes, added to the ghost icon button it is. */
export function closeControlClasses(overMedia: boolean, extra?: unknown) {
  return ["pk-close", overMedia ? "pk-close--over-media" : null, typeof extra === "string" ? extra : null]
    .filter(Boolean)
    .join(" ");
}

/** Every class of the shared close control, for a control built without the Button component. */
export function closeButtonClasses(overMedia: boolean) {
  return buttonClasses({ variant: "ghost", icon: true }, closeControlClasses(overMedia));
}
