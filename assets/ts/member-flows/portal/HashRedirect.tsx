import { useEffect } from "preact/hooks";
import { usePortalHashLocation } from "./hash-location";

/**
 * Sends the reader to `to` once this mounts. Navigating belongs in an
 * effect, not in render, so a route that has to bounce elsewhere — a create
 * page opened without the capability to create — renders this instead of
 * calling `navigate` while rendering.
 */
export function HashRedirect({ to }: { to: string }) {
  const [, navigate] = usePortalHashLocation();
  useEffect(() => navigate(to), [navigate, to]);
  return null;
}
