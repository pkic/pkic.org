/** A collection's create command, with optional direct action and more choices. */
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import type { MenuItem } from "./Menu";
import { IconPlus } from "../components/icons";
import { Button, ButtonLink, type ButtonVariant } from "./Button";
import { Menu } from "./Menu";
import "./SplitButton.css";

export interface SplitButtonProps {
  label: string;
  items: readonly MenuItem[];
  icon?: ComponentChildren;
  variant?: Extract<ButtonVariant, "primary" | "secondary">;
  /** When omitted, the entire control opens the choices. */
  defaultAction?:
    | { label: string; onSelect: () => void; href?: never; disabled?: boolean; loading?: boolean }
    | { label: string; href: string; onSelect?: never; disabled?: boolean; loading?: never };
}

export function SplitButton({
  label,
  items,
  defaultAction,
  icon = <IconPlus />,
  variant = "primary",
}: SplitButtonProps) {
  const root = useRef<HTMLDivElement>(null);
  const wasFocused = Boolean(root.current?.contains(document.activeElement));
  useLayoutEffect(() => {
    if (wasFocused && !root.current?.contains(document.activeElement))
      root.current?.querySelector<HTMLElement>("a,button:not(:disabled)")?.focus({ preventScroll: true });
  });
  return (
    <div ref={root} class={`pk-split-button pk-split-button--${variant}`}>
      {defaultAction && "href" in defaultAction && defaultAction.href && !defaultAction.disabled ? (
        <ButtonLink
          variant={variant}
          icon
          class="pk-split-button__primary"
          href={defaultAction.href}
          aria-label={defaultAction.label}
          title={defaultAction.label}
        >
          {icon}
        </ButtonLink>
      ) : (
        defaultAction && (
          <Button
            variant={variant}
            icon
            class="pk-split-button__primary"
            aria-label={defaultAction.label}
            title={defaultAction.label}
            onClick={defaultAction.onSelect}
            disabled={defaultAction.disabled}
            loading={defaultAction.loading}
          >
            {!defaultAction.loading && icon}
          </Button>
        )
      )}
      <Menu label={label} align="end" variant="plain" items={items}>
        <span class="pk-split-button__menu-content" aria-hidden="true">
          {!defaultAction && icon}
          <span class="pk-split-button__caret" />
        </span>
      </Menu>
    </div>
  );
}
