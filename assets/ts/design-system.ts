/**
 * The design system's always-present CSS.
 *
 * Imported from the loader entry so the tokens and the base layer land in the
 * entry stylesheet, which every page links. Both are small and every surface
 * needs them. Interactive component styles normally remain in lazy chunks;
 * styles needed by server-rendered components are explicitly listed below.
 */

// The typeface the tokens name. Declared here so it is part of the loader
// entry stylesheet every page links, public and portal alike.
import "../design/fonts.css";
import "../design/tokens.generated.css";
import "../design/base.css";
// Utilities ship with the entry too: they are a few hundred bytes, every
// surface uses them, and a page that had to lazy-load its layout primitives
// would reflow once they arrived.
import "../design/utilities.css";

// Public pages are server-rendered and linked from the head, so they cannot
// wait for a lazy chunk without flashing unstyled markup. The few primitives
// their HTML writes by class name therefore ship with the entry. Everything
// else stays in its own chunk. This list should stay short, and each addition
// must be required by a component in the server-rendered document.
import "./ui/Button.css";
import "./ui/Badge.css";
// The public shortcodes are largely forms — join, registration, speaker and
// proposal management — so the field and control styles have to be available
// to server-rendered markup too. This one addition unblocks roughly 600 of the
// remaining Bootstrap references in layouts/.
import "./ui/Field.css";
// Every table an author writes in Markdown is server-rendered by the table
// render hook in `layouts/_default/_markup/`, which writes the same class
// names as `ui/DataTable`. Only the static skin is in this sheet — what a data
// table does with a pointer stays in that component's chunk.
import "./ui/Table.css";
// The list pages' pager is server-rendered from `partials/pagination.html`,
// which writes the same class names as `ui/Pager`. One stylesheet dresses
// both, so the public pager cannot drift from the portal's.
import "./ui/Pager.css";
// The theme toggle is in the navbar of every server-rendered page, and which
// icon it shows is decided by the stylesheet. Lazily loaded, all three icons
// would show until the chunk arrived.
import "./ui/ThemeToggle.css";
// Cards and inline messages are pervasive in the public shortcodes, so these
// two follow for the same reason. The budget in check-css-budget.mjs is what
// keeps this list from growing on convenience alone.
import "./ui/Panel.css";
import "./ui/Alert.css";
// Portraits are server-rendered too: blog authors and agenda speakers are drawn
// with `ui/Avatar`, the one component that draws initials for a missing photo.
import "./ui/Avatar.css";
