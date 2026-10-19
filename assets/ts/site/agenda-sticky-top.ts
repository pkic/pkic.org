/**
 * The viewport offset below the site or portal chrome that stays pinned above an agenda: the site bar and a
 * sticky section navigation on public pages, or the portal top bar. Inside the expanded agenda dialog nothing
 * covers the agenda.
 */
export function agendaStickyTop(root: HTMLElement): number {
  if (root.closest("dialog[open]")) return 0;
  // The app chrome sets the site bar to 0px; only a missing value falls back to the bar's height.
  const navbarValue = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--pkic-navbar-height"),
  );
  const navbarHeight = Number.isFinite(navbarValue) ? navbarValue : 57;
  const sectionNav = root.closest("#portal-root")
    ? null
    : document.querySelector<HTMLElement>(".pk-section-navigation");
  const sectionHeight =
    sectionNav && getComputedStyle(sectionNav).position === "sticky" ? sectionNav.getBoundingClientRect().height : 0;
  const portalTopbar = root.closest("#portal-root")?.querySelector<HTMLElement>("#portal-topbar");
  const portalTopbarBottom =
    portalTopbar &&
    getComputedStyle(portalTopbar).display !== "none" &&
    ["sticky", "fixed"].includes(getComputedStyle(portalTopbar).position)
      ? portalTopbar.getBoundingClientRect().bottom
      : 0;
  return Math.max(navbarHeight + sectionHeight, portalTopbarBottom);
}
