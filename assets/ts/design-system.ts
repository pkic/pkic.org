/**
 * The design system's always-present CSS.
 *
 * Imported from the loader entry so the tokens and the base layer land in the
 * entry stylesheet, which every page links. Both are small and every surface
 * needs them; component styles do NOT come through here — each component
 * imports its own CSS so Vite emits it into that component's lazy chunk and
 * the browser fetches it only when the component is actually reached.
 */

import "../design/tokens.generated.css";
import "../design/base.css";
