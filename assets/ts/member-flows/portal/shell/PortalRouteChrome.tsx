/**
 * What the portal's router renders around a section: the section frame, the
 * two navigation-only routes (redirect and capacity fallback), and the scroll
 * reset every route change owes the reader. Kept beside the route table in
 * PortalShell rather than inside it, so that file stays a readable list of
 * addresses.
 */
import { type ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { usePortalHashLocation } from "../hash-location";
import { EmptyState } from "../../../components/EmptyState";
import type { PortalSession } from "../types";
import { portalCapacityFallbackPath } from "./portal-navigation";

export function SectionWrapper({ title, children }: { title?: string; children: ComponentChildren }) {
  return (
    <div class="portal-section">
      {title && <h4 class="portal-section-title">{title}</h4>}
      {children}
    </div>
  );
}

export function PortalRouteFallback({ session }: { session: PortalSession | null }) {
  const [location, navigate] = usePortalHashLocation();
  const fallbackPath = portalCapacityFallbackPath(session, location);

  useEffect(() => {
    if (fallbackPath) navigate(fallbackPath);
  }, [fallbackPath, navigate]);

  if (fallbackPath) return null;
  // A section that does not exist is a dead end, so it says what to do next
  // rather than stating the fact and stopping.
  return (
    <div class="pk pk-section">
      <EmptyState title="Section not found." body="The link may be out of date, or the section may have moved." />
    </div>
  );
}

export function PortalRouteRedirect({ to }: { to: string }) {
  const [, navigate] = usePortalHashLocation();
  useEffect(() => navigate(to), [navigate, to]);
  return null;
}

// Hash navigation keeps the document's scroll position — and the browser's
// automatic scroll restoration re-applies remembered offsets to revisited
// hash entries — so moving from a scrolled list to another section would
// land the reader mid-page. The portal owns its scroll instead.
export function ScrollResetOnNavigate() {
  const [path] = usePortalHashLocation();
  useEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  }, []);
  useEffect(() => {
    // "instant" sidesteps the site's `scroll-behavior: smooth`, whose
    // animation the route swap cancels before it reaches the top.
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    document.getElementById("portal-main")?.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [path]);
  return null;
}
