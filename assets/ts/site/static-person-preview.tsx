import { render, type JSX } from "preact";
import { useLayoutEffect } from "preact/hooks";
import { usePersonCard, type Person } from "./PersonCard";

/** Attach the canonical hook to server-rendered controls without replacing their markup or click action. */
function StaticPersonPreview({
  anchor,
  person,
  toggle,
}: {
  anchor: HTMLElement;
  person: Person;
  toggle?: HTMLButtonElement;
}) {
  const preview = usePersonCard<HTMLElement>({ person });
  useLayoutEffect(() => {
    preview.anchorRef.current = toggle ?? anchor.querySelector<HTMLElement>("strong") ?? anchor;
    const events = new AbortController();
    anchor.addEventListener(
      "pointerenter",
      (event) => preview.hoverProps.onPointerEnter?.(event as JSX.TargetedPointerEvent<HTMLElement>),
      { signal: events.signal },
    );
    anchor.addEventListener(
      "pointerleave",
      (event) => preview.hoverProps.onPointerLeave?.(event as JSX.TargetedPointerEvent<HTMLElement>),
      { signal: events.signal },
    );
    anchor.addEventListener(
      "focusin",
      (event) => preview.hoverProps.onFocusIn?.(event as JSX.TargetedFocusEvent<HTMLElement>),
      { signal: events.signal },
    );
    anchor.addEventListener(
      "focusout",
      (event) => preview.hoverProps.onFocusOut?.(event as JSX.TargetedFocusEvent<HTMLElement>),
      { signal: events.signal },
    );
    if (toggle) {
      toggle.setAttribute("aria-expanded", String(preview.toggleProps["aria-expanded"] ?? false));
      const controls = preview.toggleProps["aria-controls"];
      if (controls) toggle.setAttribute("aria-controls", String(controls));
      else toggle.removeAttribute("aria-controls");
      toggle.addEventListener(
        "pointerdown",
        (event) => preview.toggleProps.onPointerDown?.(event as JSX.TargetedPointerEvent<HTMLButtonElement>),
        { signal: events.signal },
      );
      toggle.addEventListener(
        "click",
        (event) => preview.toggleProps.onClick?.(event as JSX.TargetedPointerEvent<HTMLButtonElement>),
        { signal: events.signal },
      );
    }
    return () => events.abort();
  }, [anchor, toggle, preview.hoverProps, preview.toggleProps]);
  return <>{preview.card}</>;
}

export function attachPersonPreview(anchor: HTMLElement, person: Person, toggle?: HTMLButtonElement): () => void {
  const host = document.createElement("span");
  host.className = "pk-person-preview-host";
  anchor.parentNode?.insertBefore(host, anchor.nextSibling);
  render(<StaticPersonPreview anchor={anchor} person={person} toggle={toggle} />, host);
  return () => {
    render(null, host);
    host.remove();
  };
}
