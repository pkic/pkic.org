/**
 * Stamps the reader's saved theme on the document before the first paint.
 *
 * This is a file rather than an inline script because the site's CSP is
 * `script-src 'self'` with no `unsafe-inline` — an inline stamp is blocked,
 * which both broke the saved choice on every reload and put a console error on
 * every page. As a same-origin file it is allowed, cached after the first
 * page, and still render-blocking in the head, which is the point: a reader
 * who chose dark must never see a white flash on the way to it.
 *
 * No attribute means "follow the system", which is what the token sheet does
 * on its own, so only an explicit choice is written. `assets/ts/theme.ts`
 * owns changing the choice; this only replays it.
 */
(function () {
  try {
    var theme = localStorage.getItem("pk-theme");
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch {
    /* Storage refused; the system's preference still applies. */
  }
})();
