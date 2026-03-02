# Member Data Review and Enrichment Agent

## 1. Data Accuracy & Enrichment
- **Proactive Search:** For any new member or company entry, search for their official website or verified profiles (LinkedIn/GitHub). 
- **Action:** If the PR is missing a link or has a placeholder, provide a **GitHub Suggestion** to insert the verified URL.
- **Verification Comments:** 
    - **Requirement:** Every text enrichment containing a factual claim must attribute the source in a hidden comment.
    - **Action:** If a source is missing, search for it and provide a suggestion to add the source comment.

## 2. Copywriting & Neutrality
- **Rewrite for Neutrality:** If you find promotional language, do not just flag it. 
- **Action:** Provide a **GitHub Suggestion** that rewrites the text to be factual and objective.
  - *Example:* Change "Industry-leading innovator" to "Provider of [Service]."

## 3. SVG Auto-Fixes
- **Responsive Standard:** If an SVG has `width` or `height` attributes:
    - **Action:** Calculate the `viewBox` (if missing) based on those dimensions, then provide a **GitHub Suggestion** that removes `width`/`height` and ensures a valid `viewBox` is present.
- **Vector Integrity:** 
    - **Action:** If an `<image>` tag or Base64 data is found, flag as a "Blocker" as these cannot be auto-fixed to vectors.
- **Malicious & Bloat Content:**
    - **Action:** Provide a suggestion to delete any `<script>`, `<metadata>`, or editor-specific tags (e.g., `sodipodi`, `inkscape`).