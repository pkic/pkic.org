/**
 * Client-side module loader.
 *
 * Reads [data-module] attributes from the DOM and dynamically imports the
 * matching TypeScript module. Each module is self-executing (calls void main()
 * at module level), so importing it is sufficient to initialize it.
 *
 * Convention: data-module="<path-relative-to-assets/ts-without-.ts>"
 *   data-module="event-flows/registration-page"     → ./event-flows/registration-page
 *   data-module="shared/donation-form"              → ./shared/donation-form
 *
 * Built by scripts/build-frontend.mjs (Vite/Rolldown) from a single entry point
 * into hashed chunks and a manifest (data/asset-manifest.json). Each entry
 * below becomes a lazy-loaded chunk, fetched only when the corresponding
 * [data-module] element is present on the page.
 */

// Tokens and the base layer ship with the entry: every page needs them and
// they are small. Component CSS rides its own lazy chunk instead.
import "./design-system";

// Site chrome rather than a page module: the toggle is in every navbar, and a
// lazy chunk would mean a request on every page for forty lines — and a window
// in which the control is rendered but does not respond.
import { installThemeToggles } from "./theme";

// Each value is a function returning a dynamic import — esbuild turns each
// import() into a separate chunk. Only the chunk requested by the page is
// ever fetched by the browser.
const modules: Record<string, () => Promise<unknown>> = {
  "ui/preview/preview-page": () => import("./ui/preview/preview-page"),
  "invite-decline": () => import("./invite-decline"),
  "event-flows/registration-page": () => import("./event-flows/registration-page"),
  "event-flows/registration-confirm-page": () => import("./event-flows/registration-confirm-page"),
  "event-flows/registration-manage-page": () => import("./event-flows/registration-manage-page"),
  "event-flows/proposal-page": () => import("./event-flows/proposal-page"),
  "event-flows/proposal-manage-page": () => import("./event-flows/proposal-manage-page"),
  "event-flows/speaker-manage-page": () => import("./event-flows/speaker-manage-page"),
  "event-flows/speaker-presentation-page": () => import("./event-flows/speaker-presentation-page"),
  "modules/photo-grid": () => import("./modules/photo-grid"),
  "member-flows/join-form": () => import("./member-flows/join-form"),
  "member-flows/application-status-page": () => import("./member-flows/application-status-page"),
  "member-flows/sponsor-form": () => import("./member-flows/sponsor-form"),
  "member-flows/member-directory-page": () => import("./member-flows/member-directory-page"),
  "member-flows/member-detail-page": () => import("./member-flows/member-detail-page"),
  "member-flows/wg-chairs-widget": () => import("./member-flows/wg-chairs-widget"),
  "member-flows/leadership-widget": () => import("./member-flows/leadership-widget"),
  "member-flows/sponsors-wall": () => import("./member-flows/sponsors-wall"),
  "member-flows/votes-index-page": () => import("./member-flows/votes-index-page"),
  "member-flows/vote-detail-page": () => import("./member-flows/vote-detail-page"),
  "member-flows/event-sponsor-page": () => import("./member-flows/event-sponsor-page"),
  "member-flows/portal-page": () => import("./member-flows/portal-page"),
  "member-flows/meeting-join-page": () => import("./member-flows/meeting-join-page"),
  "shared/donation-form": () => import("./shared/donation/form"),
  "shared/donation-thank-you": () => import("./shared/donation/thank-you"),
};

async function loadModule(name: string): Promise<void> {
  const loader = modules[name];
  if (!loader) {
    console.warn(`[loader] unknown module: ${name}`);
    return;
  }
  await loader();
}

function init(): void {
  installThemeToggles();
  document.querySelectorAll<HTMLElement>("[data-module]").forEach((el) => {
    const name = el.dataset.module;
    if (name) void loadModule(name);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
