import { useCallback, useEffect, useState } from "preact/hooks";

/** Something open in the studio that Escape belongs to first: a dialog, a menu, an enlarged output. */
function somethingOpen(): boolean {
  return Boolean(document.querySelector("dialog[open], [role='menu']"));
}

/**
 * Full screen for the control room, drawn in the page: the studio covers the
 * portal's navigation and takes the whole window. It opens that way, as the
 * app it is; the session bar links back to the event, and the toolbar shows
 * the portal around it again on request. It deliberately does not
 * use the browser's Fullscreen API, which always leaves full screen on
 * Escape: on air, Escape must close the open dialog, menu or enlarged output
 * and nothing else. Leaving takes the button, or Escape while nothing is
 * open followed by a confirmation. Transient, so it never enters the address.
 */
export function useStudioFullscreen() {
  const [expanded, setExpanded] = useState(true);
  const [confirmingExit, setConfirmingExit] = useState(false);
  const exit = useCallback(() => {
    setConfirmingExit(false);
    setExpanded(false);
  }, []);
  // The page behind the control room does not scroll while it covers the window.
  useEffect(() => {
    document.documentElement.classList.toggle("pk-studio-open", expanded);
    return () => document.documentElement.classList.remove("pk-studio-open");
  }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || somethingOpen()) return;
      event.preventDefault();
      setConfirmingExit(true);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [expanded]);
  return {
    expanded,
    toggle: () => (expanded ? exit() : setExpanded(true)),
    /** Escape asked to leave; the studio confirms before it does. */
    confirmingExit,
    confirmExit: exit,
    stay: () => setConfirmingExit(false),
  };
}
