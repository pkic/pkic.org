/**
 * CloseButton — the one control that closes a dialog, sheet, panel, drawer or overlay.
 *
 * Every window in the site and portal closes through this button, so it reads the
 * same everywhere: the shared cross icon in a 34px square, named for what it closes
 * ("Close speaker profile"). Over a photo or video it gets a solid backdrop so the
 * cross stays visible whatever the image behind it.
 */
import { Button, type ButtonProps } from "./Button";
import { IconRemove } from "./MediaIcons";
import { closeControlClasses } from "./button-classes";
import "./CloseButton.css";

export type CloseLabel = `Close ${string}`;

export interface CloseButtonProps extends Omit<
  ButtonProps,
  "children" | "icon" | "variant" | "size" | "aria-label" | "title"
> {
  /** What it closes, starting with "Close". */
  label: CloseLabel;
  /** Sits over an image, so it carries its own contrasting backdrop. */
  overMedia?: boolean;
}

export function CloseButton({ label, overMedia = false, class: className, ...rest }: CloseButtonProps) {
  return (
    <Button
      {...rest}
      variant="ghost"
      icon
      class={closeControlClasses(overMedia, className)}
      aria-label={label}
      title={label}
    >
      <IconRemove />
    </Button>
  );
}
