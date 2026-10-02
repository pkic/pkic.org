import "./site/public-styles";
/**
 * Public-site entry: presentation and behaviour.
 *
 * The server renders these components before client JavaScript runs, so their
 * styles must be linked from the document head. Keeping them in a dedicated
 * entry preserves the small universal loader used by portal-only surfaces.
 *
 * The behaviour half is the site's own scripts. Hugo loaded them from its
 * templates — `navbar.js` from the navbar partial, `main.js` from the footer,
 * `wg-nav.js` from the working-group layout, the event scripts from the event
 * layouts — and the migration inherited the markup without ever loading them,
 * which is why the mega menus, the search panel, the section-nav disclosures,
 * the side menu, the member-wall effects and every event page were inert.
 *
 * Each one is imported only when the page it belongs to is on screen, so a
 * blog post does not download the agenda.
 */

/** Load a behaviour module when the markup it drives is present. */
async function whenPresent(selector: string, load: () => Promise<unknown>): Promise<void> {
  if (!document.querySelector(selector)) return;
  await load();
}

async function start(): Promise<void> {
  // Site chrome: the mega menus, the search panel and the collapsed menu.
  await import("../js/navbar.js");

  // Site-wide behaviour that `main.js` carried, minus its Bootstrap import:
  // this build has no Bootstrap to load.
  await Promise.all([
    import("../js/modules/global-ui.js"),
    import("../js/modules/sponsor-banner-marquee.js"),
    import("../js/modules/text-selection-edit-tooltip.js"),
  ]);
  const { initLocalTime } = await import("../js/modules/local-time.js");
  initLocalTime();

  await Promise.all([
    whenPresent("img.member-logo, img.member-profile-logo", async () => {
      const { initMemberLogoTreatment } = await import("./shared/member-logo-treatment");
      initMemberLogoTreatment();
    }),
    // The member logo wall's hover cards and sponsor zoom overlay.
    whenPresent(
      ".members-overview .members, .footer-member-wall, [data-sponsors-wall], [data-published-member-wall]",
      () => import("../js/modules/members-overview-effects.js"),
    ),
    // Working-group section nav: its disclosures and the page side menu.
    whenPresent("#wgSectionNav, .wg-sidebar", () => import("../js/wg-nav.js")),
    whenPresent("#agenda-container:not(.pk-content-agenda)", () => import("../js/event-agenda.js")),
    whenPresent("#session", () => import("../js/event-session.js")),
    whenPresent("#svg-container", () => import("../js/event-overlays.js")),
    whenPresent("#speaker-name", () => import("../js/event-speaker-card.js")),
    whenPresent("#registration-form, .session-card", () => import("../js/session-registration.js")),
    whenPresent("[data-countdown]", () => import("../js/modules/event-countdown.js")),
    whenPresent(".mermaid-wrap", async () => {
      await import("./site/diagrams");
    }),
    whenPresent("#memberSearch, .members-az-sidebar", () => import("../js/members.js")),
  ]);

  // Scroll reveal, which `main.js` also owned.
  for (const element of document.querySelectorAll("[data-reveal]")) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(element);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void start(), { once: true });
} else {
  void start();
}
