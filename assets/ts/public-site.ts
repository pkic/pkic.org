import "./site/public-styles";
// Site chrome must be interactive when the deferred public entry finishes loading.
import "../js/navbar.js";
import "../js/modules/global-ui.js";
/**
 * Public-site entry: presentation and behavior.
 *
 * The server renders these components before client JavaScript runs, so their
 * styles must be linked from the document head. Keeping them in a dedicated
 * entry preserves the small universal loader used by portal-only surfaces.
 *
 * Page-specific behavior loads only when its markup is present.
 */

/** Load a behavior module when the markup it drives is present. */
async function whenPresent(selector: string, load: () => Promise<unknown>): Promise<void> {
  if (!document.querySelector(selector)) return;
  await load();
}

async function start(): Promise<void> {
  const { installPublicAccountMenu } = await import("./account-menu");
  void installPublicAccountMenu();

  await Promise.all([
    import("../js/modules/sponsor-banner-marquee.js"),
    whenPresent(
      "[data-content-contribution], .edit-on-github",
      () => import("../js/modules/text-selection-edit-tooltip.js"),
    ),
  ]);
  const { initLocalTime } = await import("../js/modules/local-time.js");
  initLocalTime();

  await Promise.all([
    // A logo or headshot that fails to load leaves the avatar's initials, as a mounted Avatar does.
    whenPresent("[data-avatar-fallback] img", async () => {
      const { observeStaticImageFallbacks } = await import("./site/static-image-fallbacks");
      observeStaticImageFallbacks(document.body);
    }),
    whenPresent("img.member-logo", async () => {
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
    whenPresent("[data-countdown]", () => import("../js/modules/event-countdown.js")),
    whenPresent(".mermaid-wrap", async () => {
      await import("./site/diagrams");
    }),
  ]);

  // Reveal sections as they enter the viewport.
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
