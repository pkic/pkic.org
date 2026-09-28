import { useEffect } from "preact/hooks";
import { expirePortalSession, expireStaffCapacity, portalSession } from "./state";

/** Remove expired authority without waiting for another request, including after browser suspension. */
export function useSessionExpiry(): void {
  const session = portalSession.value;
  useEffect(() => {
    if (!session) return;
    const sessionDeadline = Date.parse(session.expiresAt);
    const staffDeadline = session.staff?.expiresAt ? Date.parse(session.staff.expiresAt) : Number.POSITIVE_INFINITY;
    const deadline = Math.min(sessionDeadline, staffDeadline);
    let timer: ReturnType<typeof setTimeout>;
    function check() {
      clearTimeout(timer);
      if (portalSession.value !== session) return;
      const remaining = deadline - Date.now();
      if (!Number.isFinite(remaining)) {
        expirePortalSession();
      } else if (remaining <= 0) {
        if (staffDeadline < sessionDeadline) {
          expireStaffCapacity();
        } else {
          expirePortalSession();
        }
      } else {
        timer = setTimeout(check, Math.min(remaining, 60_000));
      }
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
