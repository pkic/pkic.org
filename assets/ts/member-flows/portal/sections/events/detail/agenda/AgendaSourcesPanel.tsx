import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Button } from "../../../../../../ui/Button";
import "./AgendaSourcesPanel.css";

/** A nonmodal source drawer keeps the calendar available for placement. */
export function AgendaSourcesPanel({
  children,
  id,
  open,
  onClose,
}: {
  children: ComponentChildren;
  id: string;
  open: boolean;
  onClose: () => void;
}) {
  const trigger = useRef<HTMLElement>(null);
  const panel = useRef<HTMLElement>(null);
  function close() {
    onClose();
    trigger.current?.focus({ preventScroll: true });
  }
  useEffect(() => {
    if (!open) return;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) close();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open]);
  return (
    <>
      {open && (
        <aside ref={panel} id={id} class="pk-agenda-sources-panel" aria-label="Session sources">
          <header class="pk-agenda-sources-panel__header">
            <h2>Session sources</h2>
            <Button size="sm" onClick={close}>
              Close
            </Button>
          </header>
          {children}
        </aside>
      )}
    </>
  );
}
