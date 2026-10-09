/**
 * The portal-wide tabs of the installed app's bottom bar: Home, Events,
 * Groups and Me. Each appears only when the same section rule that guards its
 * route lets this session open it, so the bar never offers a refusal.
 */
import { usePortalHashLocation } from "../hash-location";
import type { PortalSession } from "../types";
import type { AppTab } from "./AppTabBar";
import { portalActiveSection, portalSectionEnabled } from "./portal-navigation";

export function portalAppTabs(session: PortalSession | null): AppTab[] {
  const href = usePortalHashLocation.hrefs;
  const tabs: AppTab[] = [];
  if (portalSectionEnabled(session, "home"))
    tabs.push({ id: "home", label: "Home", href: href("/home"), icon: "home" });
  if (portalSectionEnabled(session, "events"))
    tabs.push({ id: "events", label: "Events", href: href("/events"), icon: "events" });
  if (portalSectionEnabled(session, "groups"))
    tabs.push({ id: "groups", label: "Groups", href: href("/groups"), icon: "groups" });
  // "Me" is the reader's own record — the "My profile" the account menu opens.
  if (session?.identity.id)
    tabs.push({ id: "me", label: "Me", href: href(`/users/${encodeURIComponent(session.identity.id)}`), icon: "me" });
  return tabs;
}

/** Which portal tab owns the location, if any. */
export function portalAppTabForLocation(session: PortalSession | null, location: string): string | undefined {
  const own = session?.identity.id ? `/users/${encodeURIComponent(session.identity.id)}` : null;
  if (location === "/account" || location.startsWith("/account/")) return "me";
  if (own && (location === own || location.startsWith(`${own}/`))) return "me";
  if (location === "/" || location === "") return undefined;
  const section = portalActiveSection(location);
  return ["home", "events", "groups"].includes(section) ? section : undefined;
}
