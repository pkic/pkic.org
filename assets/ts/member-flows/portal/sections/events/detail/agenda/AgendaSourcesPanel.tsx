import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { CloseButton } from "../../../../../../ui/CloseButton";
import "./AgendaSourcesPanel.css";
import { SectionHeading } from "../../../../../../ui/SectionHeading";

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
        <section ref={panel} id={id} class="pk-agenda-sources-panel" aria-label="Session sources">
          <header class="pk-agenda-sources-panel__header">
            <SectionHeading level={3}>Session sources</SectionHeading>
            <CloseButton label="Close session sources" onClick={close} />
          </header>
          {children}
        </section>
      )}
    </>
  );
}
