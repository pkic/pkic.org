import { useEffect } from "preact/hooks";
import { expirePortalSession, portalSession } from "./state";

/** Clear private views without waiting for another request, including after browser suspension. */
export function useSessionExpiry(): void {
  const session = portalSession.value;
  useEffect(() => {
    if (!session) return;
    // Staff elevation can end before the underlying identity session. Require
    // sign-in again rather than leaving privileged content on screen.
    const deadlines = [session.expiresAt, session.staff?.expiresAt].filter((value) => value != null);
    const deadline = Math.min(...deadlines.map((value) => Date.parse(value)));
    let timer: ReturnType<typeof setTimeout>;
    function check() {
      clearTimeout(timer);
      if (portalSession.value !== session) return;
      const remaining = deadline - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) expirePortalSession();
      else timer = setTimeout(check, Math.min(remaining, 60_000));
    }
    check();
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [session]);
}
