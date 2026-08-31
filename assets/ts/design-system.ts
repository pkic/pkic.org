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
// Utilities ship with the entry too: they are a few hundred bytes, every
// surface uses them, and a page that had to lazy-load its layout primitives
// would reflow once they arrived.
import "../design/utilities.css";

// Public pages are server-rendered and linked from the head, so they cannot
// wait for a lazy chunk without flashing unstyled markup. The few primitives
// their HTML writes by class name therefore ship with the entry. Everything
// else stays in its own chunk — this list should stay short, and each addition
// should be because a Hugo layout writes the class, not because it is handy.
import "./ui/Button.css";
import "./ui/Badge.css";
