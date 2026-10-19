import { useEffect, useRef } from "preact/hooks";
/** Move an opened editor into view and return focus to its trigger on close. */
export function useEditorFocus() {
  const form = useRef<HTMLFormElement | null>(null);
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const control = form.current?.querySelector<HTMLElement>('input:not([type="hidden"]),select,textarea');
    control?.scrollIntoView?.({ block: "center" });
    control?.focus({ preventScroll: true });
    return () => {
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return form;
}
