/**
 * Stylesheet lint: the recommended correctness rules, plus the one rule review
 * kept catching by hand. `pkic/layout-units` keeps type, spacing, size, and
 * position in tokens or rem so they follow the reader's text size.
 */
export default {
  extends: ["stylelint-config-recommended"],
  plugins: ["./scripts/stylelint/layout-units.mjs"],
  rules: {
    "pkic/layout-units": true,
    // Order is set by cascade layers and deliberate overrides (a state after
    // its base, a context after the default); reordering to satisfy source
    // specificity would change which rule wins.
    "no-descending-specificity": null,
  },
  ignoreFiles: ["**/*.generated.css", "static/**", "node_modules/**", "dist/**", "public/**"],
  overrides: [
    {
      files: ["**/*.scss"],
      extends: ["stylelint-config-recommended-scss"],
      rules: {
        // A Sass @import pulls in a partial wherever it stands; the CSS rule
        // about @import coming first does not apply to it.
        "no-invalid-position-at-import-rule": null,
        // A bare `//` separates paragraphs inside a line-comment block.
        "scss/comment-no-empty": null,
      },
    },
    {
      // Fixed canvases measured in pixels, not text: the 1920 × 1080 broadcast
      // frames (scaled as a whole by their layout box), the 1200 × 630 social
      // card image, and printed pages.
      files: [
        "assets/ts/live-session/Live*Overlay.css",
        "assets/ts/live-session/LiveLowerThird.css",
        "assets/ts/live-session/LiveStageDisplay.css",
        "assets/ts/live-session/LiveGraphicTheme.css",
        "assets/scss/conference-overlays.scss",
        "assets/scss/og-card.scss",
        "assets/ts/site/AgendaPrint.css",
        "assets/ts/components/event-badges/BadgePrintPreview.css",
      ],
      rules: { "pkic/layout-units": null },
    },
  ],
};
